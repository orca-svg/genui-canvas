import { describe, it, expect } from "vitest";
import { parseSSE } from "./sse.js";

describe("parseSSE", () => {
  it("parses a status frame and a composition frame", () => {
    const body =
      'event: status\ndata: {"kind":"status","message":"검색 중"}\n\n' +
      'event: composition\ndata: {"kind":"composition","compositionId":"c1","messages":[{"version":"v0.9","createSurface":{"surfaceId":"s1"}}],"cards":[{"cardId":"s1","componentType":"BenefitCard","entityId":"a"}]}\n\n';
    const events = parseSSE(body);
    expect(events).toHaveLength(2);
    expect(events[0]?.kind).toBe("status");
    const composition = events[1];
    expect(composition?.kind).toBe("composition");
    if (composition?.kind === "composition") {
      expect(composition.messages).toHaveLength(1);
      expect(composition.cards[0]?.entityId).toBe("a");
    }
  });

  it("ignores malformed frames", () => {
    expect(parseSSE("event: x\ndata: not-json\n\n")).toEqual([]);
    expect(parseSSE("")).toEqual([]);
  });
});
