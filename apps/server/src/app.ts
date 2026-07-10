import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import {
  CompositionTriggerSchema,
  CurrentCompositionSchema,
  InteractionEventSchema,
  ServerEventSchema,
  SessionIdSchema,
  StrictUserProfileSchema,
  UserQueryTextSchema,
} from "@genui-canvas/contracts";
import { composeTurn, type ComposerDeps, type TurnRequest } from "./composer.js";
import { summarizeTrace } from "./trace/summarize.js";
import type { TraceStore } from "./trace/store.js";

export interface AppDeps extends ComposerDeps {
  traceStore: TraceStore;
  corsOrigins?: readonly string[];
}

const DEFAULT_CORS_ORIGINS = ["http://localhost:5180", "http://localhost:5181"] as const;
const MAX_API_BODY_BYTES = 64 * 1024;
const TurnBodySchema = z.object({
  sessionId: SessionIdSchema,
  trigger: CompositionTriggerSchema,
  profile: StrictUserProfileSchema,
  currentComposition: CurrentCompositionSchema,
  query: UserQueryTextSchema.optional(),
}).strict();

/**
 * HTTP surface. /api/turn runs a composition point and streams the resulting
 * A2UI messages over SSE; /api/events records fine-grained manipulations to the
 * interaction trace. Deps are injected so tests drive it with a real gateway +
 * rule-based provider.
 */
export function createApp(deps: AppDeps) {
  const app = new Hono();
  const sessions = new Map<
    string,
    {
      seq: number;
      lastEvent?: z.infer<typeof InteractionEventSchema>;
      eventIds: Set<string>;
    }
  >();
  const envCorsOrigins = process.env.GENUI_CORS_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const corsOrigins =
    deps.corsOrigins ??
    (envCorsOrigins && envCorsOrigins.length > 0 ? envCorsOrigins : DEFAULT_CORS_ORIGINS);

  // The SPA is served from a different origin (Vite :5180) than this API
  // (:8787), so the browser needs CORS to talk to it. Local BYOK tool — a
  // allowlist is configurable for deployments without falling back to '*'.
  app.use("/api/*", cors({ origin: [...corsOrigins] }));
  app.use(
    "/api/events",
    bodyLimit({
      maxSize: MAX_API_BODY_BYTES,
      onError: (c) => c.json({ ok: false, error: "Request body too large" }, 413),
    }),
  );
  app.use(
    "/api/turn",
    bodyLimit({
      maxSize: MAX_API_BODY_BYTES,
      onError: (c) => c.json({ ok: false, error: "Request body too large" }, 413),
    }),
  );

  app.post("/api/session", (c) => {
    const sessionId = randomUUID();
    sessions.set(sessionId, { seq: 0, eventIds: new Set() });
    return c.json({ sessionId });
  });

  app.post("/api/events", async (c) => {
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "Invalid request body" }, 400);
    }
    const parsed = InteractionEventSchema.safeParse(json);
    if (!parsed.success) {
      return c.json({ ok: false, errors: parsed.error.issues.map((i) => i.message) }, 400);
    }
    const session = sessions.get(parsed.data.sessionId);
    if (!session) {
      return c.json({ ok: false, error: "Session not found" }, 404);
    }
    // A client may have successfully sent an event but lost only the HTTP
    // response. Replaying that exact immutable event is safe; a different
    // event reusing the sequence remains a conflict.
    if (
      parsed.data.seq === session.seq - 1 &&
      session.lastEvent !== undefined &&
      isDeepStrictEqual(parsed.data, session.lastEvent)
    ) {
      return c.json({ ok: true, replayed: true });
    }
    if (session.eventIds.has(parsed.data.eventId)) {
      return c.json({ ok: false, error: "Event identity conflict" }, 409);
    }
    if (parsed.data.seq !== session.seq) {
      return c.json({ ok: false, error: "Event sequence conflict" }, 409);
    }
    deps.traceStore.append(parsed.data);
    session.seq += 1;
    session.lastEvent = parsed.data;
    session.eventIds.add(parsed.data.eventId);
    return c.json({ ok: true });
  });

  app.post("/api/turn", async (c) => {
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "Invalid request body" }, 400);
    }
    const parsed = TurnBodySchema.safeParse(json);
    if (!parsed.success) {
      return c.json({ ok: false, error: "Invalid request body" }, 400);
    }
    const body = parsed.data;
    if (!sessions.has(body.sessionId)) {
      return c.json({ ok: false, error: "Session not found" }, 404);
    }
    // Close the loop server-side: the trace summary is always computed from the
    // issued session's recorded trace and is never trusted from the client.
    const turn: TurnRequest = {
      ...body,
      traceSummary: summarizeTrace(deps.traceStore.read(body.sessionId)),
    };
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({
        event: "status",
        data: JSON.stringify({ kind: "status", message: "게이트웨이에서 후보를 검색하고 구성 중" }),
      });
      try {
        const result = await composeTurn(deps, turn);
        if (result.ok) {
          const metadataByCardId = new Map(
            result.cardMetadata.map((metadata) => [metadata.cardId, metadata]),
          );
          const compositionEvent = ServerEventSchema.parse({
            kind: "composition",
            compositionId: randomUUID(),
            messages: result.messages,
            cards: result.spec.cards.map((card) => ({
              cardId: card.cardId,
              entityId: card.entityRef?.entityId,
              componentType: card.componentType,
              ...metadataByCardId.get(card.cardId),
            })),
          });
          await stream.writeSSE({
            event: "composition",
            data: JSON.stringify(compositionEvent),
          });
        } else {
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify({ kind: "error", message: "구성을 검증하지 못했습니다" }),
          });
        }
      } catch {
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({ kind: "error", message: "구성 중 오류가 발생했습니다" }),
        });
      }
    });
  });

  return app;
}
