import { describe, expect, it } from "vitest";
import {
  InteractionEventSchema,
  InteractionEventTypeSchema,
  createInteractionEvent,
  type InteractionEventInput,
  type InteractionEventType,
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

  // Explicit, hand-maintained — deliberately not derived from the production
  // startsWith() rule in interaction-event.ts, so this table can't just restate
  // whatever the implementation already does. The keys-match assertion below
  // fails the test the moment a new InteractionEventType is declared without an
  // entry here, instead of silently skipping it.
  const EXPECTED_ACTOR_BY_TYPE: Record<InteractionEventType, "user" | "system"> = {
    "card.pin": "user",
    "card.unpin": "user",
    "card.hide": "user",
    "card.unhide": "user",
    "card.expand": "user",
    "card.collapse": "user",
    "card.reorder": "user",
    "checklist.check": "user",
    "checklist.uncheck": "user",
    "query.submit": "user",
    "persona.switch": "user",
    "composition.applied": "system",
    "composition.rejected": "system",
    "tool.called": "system",
    "session.start": "system",
  };

  function payloadFor(type: InteractionEventType) {
    switch (type) {
      case "query.submit":
        return { text: "서울 청년 지원" };
      case "persona.switch":
        return { personaId: "youth_jobseeker" };
      case "card.reorder":
        return { toIndex: 0 };
      case "checklist.check":
      case "checklist.uncheck":
        return { itemIndex: 0 };
      case "composition.rejected":
        return { reason: "turn_failed" as const };
      case "tool.called":
        return { tools: [{ name: "searchBenefits" as const, calls: 1, failures: 0 }] };
      default:
        return undefined;
    }
  }

  it("declares an expected actor for every InteractionEventType (fails if a new type is added without one)", () => {
    expect(Object.keys(EXPECTED_ACTOR_BY_TYPE).sort()).toEqual([...InteractionEventTypeSchema.options].sort());
  });

  it("accepts every declared event type when paired with its expected actor", () => {
    for (const [type, actor] of Object.entries(EXPECTED_ACTOR_BY_TYPE) as [InteractionEventType, "user" | "system"][]) {
      const payload = payloadFor(type);
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

describe("checklist and server bookkeeping events", () => {
  const checklistTarget = {
    cardId: "checklist-national-scholarship",
    entityId: "national-scholarship",
    componentType: "Checklist" as const,
  };

  it("accepts a user checklist.check event carrying only a bounded row index", () => {
    const event = createInteractionEvent({
      ...baseInput,
      type: "checklist.check",
      target: checklistTarget,
      payload: { itemIndex: 2 },
    });
    expect(InteractionEventSchema.safeParse(event).success).toBe(true);
  });

  it("accepts a checklist row index at the top of the valid range (89)", () => {
    const event = createInteractionEvent({
      ...baseInput,
      type: "checklist.check",
      target: checklistTarget,
      payload: { itemIndex: 89 },
    });
    expect(InteractionEventSchema.safeParse(event).success).toBe(true);
  });

  it("rejects a checklist row index at or beyond the 90-row card limit", () => {
    const event = createInteractionEvent({
      ...baseInput,
      type: "checklist.uncheck",
      target: checklistTarget,
      payload: { itemIndex: 90 },
    });
    expect(InteractionEventSchema.safeParse(event).success).toBe(false);
  });

  it("rejects a checklist toggle without its payload or with a system actor", () => {
    const missing = createInteractionEvent({ ...baseInput, type: "checklist.check", target: checklistTarget });
    expect(InteractionEventSchema.safeParse(missing).success).toBe(false);
    const system = createInteractionEvent({
      ...baseInput,
      actor: "system",
      type: "checklist.check",
      target: checklistTarget,
      payload: { itemIndex: 0 },
    });
    expect(InteractionEventSchema.safeParse(system).success).toBe(false);
  });

  it("accepts a system tool.called event summarising gateway calls", () => {
    const event = createInteractionEvent({
      ...baseInput,
      actor: "system",
      type: "tool.called",
      target: undefined,
      payload: { tools: [{ name: "searchBenefits", calls: 1, failures: 0 }] },
    });
    expect(InteractionEventSchema.safeParse(event).success).toBe(true);
  });

  it("rejects tool.called with an unknown tool or an empty list", () => {
    const unknown = createInteractionEvent({
      ...baseInput,
      actor: "system",
      type: "tool.called",
      target: undefined,
      payload: { tools: [{ name: "dropTables", calls: 1, failures: 0 }] },
    });
    expect(InteractionEventSchema.safeParse(unknown).success).toBe(false);
    const empty = createInteractionEvent({
      ...baseInput,
      actor: "system",
      type: "tool.called",
      target: undefined,
      payload: { tools: [] },
    });
    expect(InteractionEventSchema.safeParse(empty).success).toBe(false);
  });

  it("rejects session.start with a payload", () => {
    const event = createInteractionEvent({
      ...baseInput,
      actor: "system",
      type: "session.start",
      target: undefined,
      payload: { note: "x" },
    });
    expect(InteractionEventSchema.safeParse(event).success).toBe(false);
  });
});
