import { z } from "zod";
import { CatalogComponentTypeSchema } from "./catalog.js";
import { RecommendationPersonaSchema } from "./gateway.js";
import {
  OpaqueEntityIdSchema,
  OpaqueIdentifierSchema,
  UserQueryTextSchema,
} from "./input.js";

export const INTERACTION_EVENT_SCHEMA_VERSION = 1 as const;
export const SessionIdSchema = z.string().uuid();

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
  // system-observed outputs
  "composition.applied",
  "composition.rejected",
  "tool.called",
  "session.start",
]);
export type InteractionEventType = z.infer<typeof InteractionEventTypeSchema>;

const PayloadSchemaByType = {
  "card.reorder": z.object({ toIndex: z.number().int().nonnegative().max(99) }).strict(),
  "query.submit": z.object({ text: UserQueryTextSchema }).strict(),
  "persona.switch": z.object({ personaId: RecommendationPersonaSchema }).strict(),
  "composition.rejected": z
    .object({ reason: z.enum(["turn_failed", "composition_invalid"]) })
    .strict(),
} as const;

const InteractionEventBaseSchema = z.object({
  schemaVersion: z.literal(1),
  eventId: z.string().uuid(),
  sessionId: SessionIdSchema,
  // Pseudonymous — never PII. "local-dev" outside a study.
  participantId: z.string().regex(/^[A-Za-z0-9:_-]{1,64}$/),
  seq: z.number().int().nonnegative(),
  ts: z.string().datetime(),
  actor: z.enum(["user", "system"]),
  type: InteractionEventTypeSchema,
  target: z
    .object({
      cardId: OpaqueIdentifierSchema.optional(),
      entityId: OpaqueEntityIdSchema.optional(),
      componentType: CatalogComponentTypeSchema.optional(),
    })
    .strict()
    .optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  context: z
    .object({
      compositionId: OpaqueIdentifierSchema,
      visibleCardIds: z.array(OpaqueIdentifierSchema).max(100),
    })
    .strict(),
  causality: z.object({ triggeredBy: z.string().uuid().optional() }).strict().optional(),
}).strict();

export const InteractionEventSchema = InteractionEventBaseSchema.superRefine((event, ctx) => {
  const schema = PayloadSchemaByType[event.type as keyof typeof PayloadSchemaByType];
  if (schema) {
    const parsed = schema.safeParse(event.payload);
    if (!parsed.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payload"],
        message: `invalid payload for ${event.type}`,
      });
    }
  } else if (event.payload !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["payload"],
      message: `${event.type} does not accept a payload`,
    });
  }

  const userEvent =
    event.type.startsWith("card.") ||
    event.type === "query.submit" ||
    event.type === "persona.switch";
  const expectedActor = userEvent ? "user" : "system";
  if (event.actor !== expectedActor) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["actor"],
      message: `${event.type} must use actor ${expectedActor}`,
    });
  }
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
