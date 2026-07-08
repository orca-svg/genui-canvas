import { describe, it, expect } from "vitest";
import { createInteractionEvent, type InteractionEvent } from "@genui-canvas/contracts";
import { summarizeTrace } from "./summarize.js";

let seq = 0;
function ev(
  type: InteractionEvent["type"],
  entityId?: string,
  extra: Partial<Parameters<typeof createInteractionEvent>[0]> = {},
): InteractionEvent {
  return createInteractionEvent({
    sessionId: "s1",
    seq: seq++,
    actor: "user",
    type,
    target: entityId ? { cardId: `card-${entityId}`, entityId } : undefined,
    context: { compositionId: "comp1", visibleCardIds: [] },
    ...extra,
  });
}

describe("summarizeTrace", () => {
  it("returns an empty summary for no events", () => {
    const s = summarizeTrace([]);
    expect(s.entityEngagement).toEqual([]);
    expect(s.turnCount).toBe(0);
    expect(s.recentEvents).toEqual([]);
  });

  it("reflects pin, hide, and expand signals per entity", () => {
    const s = summarizeTrace([
      ev("query.submit"),
      ev("card.pin", "a"),
      ev("card.hide", "b"),
      ev("card.expand", "a"),
      ev("card.expand", "a"),
    ]);
    const a = s.entityEngagement.find((e) => e.entityId === "a");
    const b = s.entityEngagement.find((e) => e.entityId === "b");
    expect(a?.pinned).toBe(true);
    expect(a?.expandCount).toBe(2);
    expect(b?.hidden).toBe(true);
    expect(s.turnCount).toBe(1);
  });

  it("treats unpin/unhide as reverting the flag", () => {
    const s = summarizeTrace([ev("card.pin", "a"), ev("card.unpin", "a")]);
    expect(s.entityEngagement.find((e) => e.entityId === "a")?.pinned).toBe(false);
  });

  it("caps entityEngagement and recentEvents for a bounded token budget", () => {
    const events: InteractionEvent[] = [];
    for (let i = 0; i < 40; i++) events.push(ev("card.expand", `e${i}`));
    const s = summarizeTrace(events, { maxEntities: 12 });
    expect(s.entityEngagement.length).toBeLessThanOrEqual(12);
    expect(s.recentEvents.length).toBeLessThanOrEqual(10);
  });

  it("is deterministic", () => {
    const build = () => [ev("card.pin", "a"), ev("card.reorder", "b"), ev("card.hide", "c")];
    // reset seq so both runs are identical
    seq = 100;
    const a = summarizeTrace(build());
    seq = 100;
    const b = summarizeTrace(build());
    expect(a).toEqual(b);
  });

  it("determ layer: manipulated trace differs from a no-manipulation trace only in the acted signals", () => {
    seq = 0;
    const control = summarizeTrace([ev("query.submit")]);
    seq = 0;
    const manipulated = summarizeTrace([
      ev("query.submit"),
      ev("card.pin", "b"),
      ev("card.hide", "c"),
    ]);
    expect(control.entityEngagement).toEqual([]);
    expect(manipulated.entityEngagement.find((e) => e.entityId === "b")?.pinned).toBe(true);
    expect(manipulated.entityEngagement.find((e) => e.entityId === "c")?.hidden).toBe(true);
  });
});
