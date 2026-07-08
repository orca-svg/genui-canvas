import { ServerEventSchema, type ServerEvent } from "@genui-canvas/contracts";

/**
 * Parse a full SSE response body into typed ServerEvents. Our /api/turn stream
 * completes per turn, so reading the whole body and parsing is sufficient (no
 * incremental streaming in v1).
 */
export function parseSSE(text: string): ServerEvent[] {
  const events: ServerEvent[] = [];
  for (const block of text.split("\n\n")) {
    const dataLine = block
      .split("\n")
      .find((line) => line.startsWith("data:"));
    if (!dataLine) continue;
    const json = dataLine.slice("data:".length).trim();
    if (!json) continue;
    try {
      const parsed = ServerEventSchema.safeParse(JSON.parse(json));
      if (parsed.success) events.push(parsed.data);
    } catch {
      // skip malformed frame
    }
  }
  return events;
}
