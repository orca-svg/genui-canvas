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

export async function createSession(): Promise<string> {
  const res = await fetch(`${API_BASE}/api/session`, {
    method: "POST",
    signal: AbortSignal.timeout(SESSION_TIMEOUT_MS),
  });
  assertOk(res, "create session");
  const body = (await res.json()) as { sessionId?: unknown };
  return SessionIdSchema.parse(body.sessionId);
}

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
