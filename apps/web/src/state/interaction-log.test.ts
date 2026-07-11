import { describe, it, expect } from "vitest";
import { InteractionEventSchema } from "@genui-canvas/contracts";
import { createShellState } from "./shell-store.js";
import { deriveInteractionEvent } from "./interaction-log.js";

const state = () =>
  createShellState("comp-1", [
    { cardId: "a", entityId: "national-scholarship", componentType: "BenefitCard" },
    { cardId: "b", entityId: "seoul-youth-rent-support", componentType: "BenefitCard" },
  ]);

describe("deriveInteractionEvent", () => {
  it("produces a schema-valid user event for a pin", () => {
    const event = deriveInteractionEvent(
      { type: "card.pin", cardId: "a" },
      state(),
      { sessionId: "11111111-1111-4111-8111-111111111111", seq: 5 },
    );
    expect(() => InteractionEventSchema.parse(event)).not.toThrow();
    expect(event.actor).toBe("user");
    expect(event.type).toBe("card.pin");
    expect(event.seq).toBe(5);
  });

  it("captures the acted card's entityId in the target", () => {
    const event = deriveInteractionEvent(
      { type: "card.hide", cardId: "b" },
      state(),
      { sessionId: "s1", seq: 1 },
    );
    expect(event.target?.cardId).toBe("b");
    expect(event.target?.entityId).toBe("seoul-youth-rent-support");
  });

  it("snapshots the visible cards and compositionId at action time", () => {
    const event = deriveInteractionEvent(
      { type: "card.expand", cardId: "a" },
      state(),
      { sessionId: "s1", seq: 2 },
    );
    expect(event.context.compositionId).toBe("comp-1");
    expect(event.context.visibleCardIds).toEqual(["a", "b"]);
  });

  it("carries the target index in a reorder payload", () => {
    const event = deriveInteractionEvent(
      { type: "card.reorder", cardId: "b", toIndex: 0 },
      state(),
      { sessionId: "s1", seq: 3 },
    );
    expect(event.type).toBe("card.reorder");
    expect(event.payload).toMatchObject({ toIndex: 0 });
  });
});
