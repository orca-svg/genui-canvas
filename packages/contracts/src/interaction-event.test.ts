import { describe, expect, it } from "vitest";
import {
  InteractionEventSchema,
  createInteractionEvent,
  type InteractionEventInput,
} from "./interaction-event.js";

const baseInput: InteractionEventInput = {
  sessionId: "s1",
  seq: 3,
  actor: "user",
  type: "card.pin",
  target: { cardId: "c1", entityId: "national-scholarship" },
  context: { compositionId: "comp1", visibleCardIds: ["c1", "c2"] },
};

describe("createInteractionEvent", () => {
  it("fills eventId, ts, schemaVersion and produces a schema-valid event", () => {
    const event = createInteractionEvent(baseInput);
    expect(event.schemaVersion).toBe(1);
    expect(event.eventId).toMatch(/[0-9a-f-]{36}/);
    expect(typeof event.ts).toBe("string");
    expect(Number.isNaN(Date.parse(event.ts))).toBe(false);
    expect(() => InteractionEventSchema.parse(event)).not.toThrow();
  });

  it("defaults participantId to local-dev when omitted", () => {
    expect(createInteractionEvent(baseInput).participantId).toBe("local-dev");
  });

  it("preserves an explicit participantId (pseudonymous study id)", () => {
    expect(createInteractionEvent({ ...baseInput, participantId: "P07" }).participantId).toBe("P07");
  });
});

describe("InteractionEventSchema", () => {
  it("accepts every declared event type", () => {
    const types = [
      "card.pin", "card.unpin", "card.hide", "card.unhide",
      "card.expand", "card.collapse", "card.reorder",
      "query.submit", "persona.switch",
      "composition.applied", "composition.rejected", "tool.called", "session.start",
    ] as const;
    for (const type of types) {
      expect(() => InteractionEventSchema.parse(createInteractionEvent({ ...baseInput, type }))).not.toThrow();
    }
  });

  it("rejects an unknown event type", () => {
    const bad = { ...createInteractionEvent(baseInput), type: "card.explode" };
    expect(InteractionEventSchema.safeParse(bad).success).toBe(false);
  });

  it("requires context.compositionId", () => {
    const event = createInteractionEvent(baseInput) as Record<string, unknown>;
    const bad = { ...event, context: { visibleCardIds: [] } };
    expect(InteractionEventSchema.safeParse(bad).success).toBe(false);
  });

  it("carries reorder ordering in the payload", () => {
    const event = createInteractionEvent({
      ...baseInput,
      type: "card.reorder",
      payload: { from: 2, to: 0, order: ["c2", "c1"] },
    });
    const parsed = InteractionEventSchema.parse(event);
    expect(parsed.payload).toEqual({ from: 2, to: 0, order: ["c2", "c1"] });
  });
});
