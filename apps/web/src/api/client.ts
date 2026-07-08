import type { InteractionEvent, ServerEvent } from "@genui-canvas/contracts";
import { parseSSE } from "./sse.js";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8787";

export interface TurnBody {
  sessionId: string;
  trigger: { type: "query.submit"; text: string } | { type: "persona.switch"; personaId: string };
  profile: Record<string, unknown>;
  currentComposition: {
    cards: Array<{ cardId: string; entityId?: string; componentType: string; state: string }>;
  };
  traceSummary: { entityEngagement: []; recentEvents: []; turnCount: number };
  query?: string;
}

export async function createSession(): Promise<string> {
  const res = await fetch(`${API_BASE}/api/session`, { method: "POST" });
  const body = (await res.json()) as { sessionId: string };
  return body.sessionId;
}

export async function postEvent(event: InteractionEvent): Promise<void> {
  await fetch(`${API_BASE}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
  });
}

export async function postTurn(body: TurnBody): Promise<ServerEvent[]> {
  const res = await fetch(`${API_BASE}/api/turn`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseSSE(await res.text());
}
