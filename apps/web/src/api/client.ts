import {
  SessionIdSchema,
  type CatalogComponentType,
  type InteractionEvent,
  type ServerEvent,
} from "@genui-canvas/contracts";
import { parseSSE } from "./sse.js";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8787";
const SESSION_TIMEOUT_MS = 10_000;
const EVENT_TIMEOUT_MS = 10_000;
const TURN_TIMEOUT_MS = 30_000;

function assertOk(response: Response, action: string): void {
  if (!response.ok) {
    throw new Error(`${action} failed with HTTP ${response.status}`);
  }
}

export interface TurnBody {
  sessionId: string;
  trigger: { type: "query.submit"; text: string } | { type: "persona.switch"; personaId: string };
  profile: Record<string, unknown>;
  currentComposition: {
    cards: Array<{
      cardId: string;
      entityId?: string;
      componentType: CatalogComponentType;
      pinned: boolean;
      hidden: boolean;
      expanded: boolean;
    }>;
  };
  query?: string;
}

export interface SessionHandle {
  sessionId: string;
  /** Sequence the client must use for its first trace event (server records session.start first). */
  nextSeq: number;
}

export async function createSession(): Promise<SessionHandle> {
  const res = await fetch(`${API_BASE}/api/session`, {
    method: "POST",
    signal: AbortSignal.timeout(SESSION_TIMEOUT_MS),
  });
  assertOk(res, "create session");
  const body = (await res.json()) as { sessionId?: unknown; nextSeq?: unknown };
  const nextSeq =
    typeof body.nextSeq === "number" && Number.isInteger(body.nextSeq) && body.nextSeq >= 0
      ? body.nextSeq
      : 0;
  return { sessionId: SessionIdSchema.parse(body.sessionId), nextSeq };
}

/**
 * The server holds a different next sequence than the event carried — e.g. it
 * recorded `tool.called` for a turn whose response never reached the client.
 * `nextSeq` is the number the server expects; the caller rebuilds and resends.
 */
export class SequenceConflictError extends Error {
  constructor(readonly nextSeq: number) {
    super(`record event failed with HTTP 409: sequence conflict, server expects ${nextSeq}`);
    this.name = "SequenceConflictError";
  }
}

async function sequenceConflictNextSeq(res: Response): Promise<number | undefined> {
  try {
    const body = (await res.json()) as { error?: unknown; nextSeq?: unknown };
    return body.error === "Event sequence conflict" &&
      typeof body.nextSeq === "number" &&
      Number.isInteger(body.nextSeq) &&
      body.nextSeq >= 0
      ? body.nextSeq
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Record one trace event, retrying the identical body once after a network or
 * 5xx failure. A sequence conflict is not retried here: it throws
 * `SequenceConflictError` so the caller can rebuild the event with the
 * server's sequence.
 */
export async function postEvent(event: InteractionEvent): Promise<void> {
  const body = JSON.stringify(event);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/api/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(EVENT_TIMEOUT_MS),
      });
    } catch (error) {
      if (attempt === 1) throw error;
      continue;
    }
    if (res.ok) return;
    if (res.status === 409) {
      const nextSeq = await sequenceConflictNextSeq(res);
      if (nextSeq !== undefined) throw new SequenceConflictError(nextSeq);
    }
    if (res.status < 500 || attempt === 1) assertOk(res, "record event");
  }
}

export async function postTurn(body: TurnBody): Promise<ServerEvent[]> {
  const res = await fetch(`${API_BASE}/api/turn`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TURN_TIMEOUT_MS),
  });
  assertOk(res, "compose turn");
  const events = parseSSE(await res.text());
  const terminal = events.filter(
    (event) => event.kind === "composition" || event.kind === "error",
  );
  if (terminal.length !== 1) {
    throw new Error("compose turn returned no single validated terminal event");
  }
  return events;
}
