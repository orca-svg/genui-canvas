import { ServerEventSchema, type ServerEvent } from "@genui-canvas/contracts";

/**
 * Parse a full SSE response body into typed ServerEvents. Our /api/turn stream
 * completes per turn, so reading the whole body and parsing is sufficient (no
 * incremental streaming in v1).
 */
export function parseSSE(text: string): ServerEvent[] {
  const events: ServerEvent[] = [];
  for (const block of text.replace(/\r\n/g, "\n").split("\n\n")) {
    const lines = block.split("\n");
    const eventName = lines.find((line) => line.startsWith("event:"))?.slice("event:".length).trim();
    const dataLine = lines
      .find((line) => line.startsWith("data:"));
    if (!dataLine) continue;
    const json = dataLine.slice("data:".length).trim();
    if (!json) continue;
    try {
      const parsed = ServerEventSchema.safeParse(JSON.parse(json));
      if (parsed.success && (!eventName || eventName === parsed.data.kind)) {
        events.push(parsed.data);
      }
    } catch {
      // skip malformed frame
    }
  }
  return events;
}
