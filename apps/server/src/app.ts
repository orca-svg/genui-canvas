import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { InteractionEventSchema } from "@genui-canvas/contracts";
import { composeTurn, type ComposerDeps, type TurnRequest } from "./composer.js";
import { summarizeTrace } from "./trace/summarize.js";
import type { TraceStore } from "./trace/store.js";

export interface AppDeps extends ComposerDeps {
  traceStore: TraceStore;
}

/**
 * HTTP surface. /api/turn runs a composition point and streams the resulting
 * A2UI messages over SSE; /api/events records fine-grained manipulations to the
 * interaction trace. Deps are injected so tests drive it with a real gateway +
 * rule-based provider.
 */
export function createApp(deps: AppDeps) {
  const app = new Hono();
  const sessions = new Map<string, { seq: number }>();

  app.post("/api/session", (c) => {
    const sessionId = randomUUID();
    sessions.set(sessionId, { seq: 0 });
    return c.json({ sessionId });
  });

  app.post("/api/events", async (c) => {
    const parsed = InteractionEventSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ ok: false, errors: parsed.error.issues.map((i) => i.message) }, 400);
    }
    deps.traceStore.append(parsed.data);
    return c.json({ ok: true });
  });

  app.post("/api/turn", async (c) => {
    const body = (await c.req.json()) as TurnRequest & { sessionId?: string };
    // Close the loop server-side: when a session is given, the trace summary is
    // computed from the recorded interaction trace, not trusted from the client.
    const turn: TurnRequest = body.sessionId
      ? { ...body, traceSummary: summarizeTrace(deps.traceStore.read(body.sessionId)) }
      : body;
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({
        event: "status",
        data: JSON.stringify({ kind: "status", message: "게이트웨이에서 후보를 검색하고 구성 중" }),
      });
      try {
        const result = await composeTurn(deps, turn);
        if (result.ok) {
          await stream.writeSSE({
            event: "composition",
            data: JSON.stringify({
              kind: "composition",
              compositionId: randomUUID(),
              messages: result.messages,
            }),
          });
        } else {
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify({ kind: "error", message: result.errors.join("; ") }),
          });
        }
      } catch (error) {
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({ kind: "error", message: String(error) }),
        });
      }
    });
  });

  return app;
}
