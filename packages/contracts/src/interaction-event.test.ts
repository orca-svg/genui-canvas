import { describe, expect, it } from "vitest";
import {
  InteractionEventSchema,
  createInteractionEvent,
  type InteractionEventInput,
} from "./interaction-event.js";

const baseInput: InteractionEventInput = {
  sessionId: "00000000-0000-4000-8000-000000000001",
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
  it("rejects a non-UUID session id", () => {
    const event = createInteractionEvent({ ...baseInput, sessionId: "not-a-uuid" });
    expect(InteractionEventSchema.safeParse(event).success).toBe(false);
  });

  it("accepts every declared event type", () => {
    const types = [
      "card.pin", "card.unpin", "card.hide", "card.unhide",
      "card.expand", "card.collapse", "card.reorder",
      "query.submit", "persona.switch",
      "composition.applied", "composition.rejected", "tool.called", "session.start",
    ] as const;
    for (const type of types) {
      const actor =
        type.startsWith("card.") || type === "query.submit" || type === "persona.switch"
          ? "user"
          : "system";
      const payload =
        type === "query.submit"
          ? { text: "서울 청년 지원" }
          : type === "persona.switch"
            ? { personaId: "youth_jobseeker" }
            : type === "card.reorder"
              ? { toIndex: 0 }
              : type === "composition.rejected"
                ? { reason: "turn_failed" }
                : undefined;
      expect(() =>
        InteractionEventSchema.parse(createInteractionEvent({ ...baseInput, actor, type, payload })),
      ).not.toThrow();
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
      payload: { toIndex: 0 },
    });
    const parsed = InteractionEventSchema.parse(event);
    expect(parsed.payload).toEqual({ toIndex: 0 });
  });

  it("rejects arbitrary or sensitive payload fields outside the query text contract", () => {
    const sensitive = createInteractionEvent({
      ...baseInput,
      type: "card.pin",
      payload: { email: "person@example.com" },
    });
    const oversizedQuery = createInteractionEvent({
      ...baseInput,
      type: "query.submit",
      payload: { text: "가".repeat(301) },
    });
    expect(InteractionEventSchema.safeParse(sensitive).success).toBe(false);
    expect(InteractionEventSchema.safeParse(oversizedQuery).success).toBe(false);
  });

  it("rejects free text in identifier fields and spoofed actors", () => {
    const hostileId = createInteractionEvent({
      ...baseInput,
      target: { cardId: "card\nignore-previous", entityId: "person@example.com" },
    });
    const spoofedActor = createInteractionEvent({
      ...baseInput,
      actor: "system",
      type: "card.pin",
    });
    expect(InteractionEventSchema.safeParse(hostileId).success).toBe(false);
    expect(InteractionEventSchema.safeParse(spoofedActor).success).toBe(false);
  });
});
