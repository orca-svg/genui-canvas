import { z } from "zod";

export const INTERACTION_EVENT_SCHEMA_VERSION = 1 as const;

// Web Crypto is a global in Node >= 22 and in browsers. Accessed via globalThis
// so this contract package stays environment-neutral (no node:crypto import).
const webCrypto = (globalThis as unknown as { crypto: { randomUUID: () => string } }).crypto;

/** Every interaction that can reshape or be logged against the canvas. */
export const InteractionEventTypeSchema = z.enum([
  // fine-grained manipulations (deterministic, instant)
  "card.pin",
  "card.unpin",
  "card.hide",
  "card.unhide",
  "card.expand",
  "card.collapse",
  "card.reorder",
  // composition points (LLM triggers)
  "query.submit",
  "persona.switch",
  // system / llm outputs
  "composition.applied",
  "composition.rejected",
  "tool.called",
  "session.start",
]);
export type InteractionEventType = z.infer<typeof InteractionEventTypeSchema>;

export const InteractionEventSchema = z.object({
  schemaVersion: z.literal(1),
  eventId: z.string().min(1),
  sessionId: z.string().min(1),
  // Pseudonymous — never PII. "local-dev" outside a study.
  participantId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  ts: z.string().min(1),
  actor: z.enum(["user", "system", "llm"]),
  type: InteractionEventTypeSchema,
  target: z
    .object({
      cardId: z.string().optional(),
      entityId: z.string().optional(),
      componentType: z.string().optional(),
    })
    .optional(),
  payload: z.record(z.unknown()).optional(),
  context: z.object({
    compositionId: z.string().min(1),
    visibleCardIds: z.array(z.string()),
  }),
  causality: z.object({ triggeredBy: z.string().optional() }).optional(),
});
export type InteractionEvent = z.infer<typeof InteractionEventSchema>;

/** Fields the caller supplies; the rest are stamped by createInteractionEvent. */
export type InteractionEventInput = Omit<
  InteractionEvent,
  "schemaVersion" | "eventId" | "ts" | "participantId"
> & { participantId?: string };

/**
 * Stamp a schema-valid event with id + timestamp. `seq` stays caller-owned so
 * the session store can guarantee monotonicity independent of clock skew.
 */
export function createInteractionEvent(input: InteractionEventInput): InteractionEvent {
  const { participantId, ...rest } = input;
  return {
    schemaVersion: INTERACTION_EVENT_SCHEMA_VERSION,
    eventId: webCrypto.randomUUID(),
    ts: new Date().toISOString(),
    participantId: participantId ?? "local-dev",
    ...rest,
  };
}
