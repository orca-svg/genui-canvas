import { z } from "zod";
import { CatalogComponentTypeSchema, validateCatalogProps } from "./catalog.js";
import { RecommendationPersonaSchema, StrictUserProfileSchema } from "./gateway.js";
import {
  OpaqueEntityIdSchema,
  OpaqueIdentifierSchema,
  UserQueryTextSchema,
} from "./input.js";

/** Scalar-only prop values — the LLM cannot smuggle objects, URLs, or HTML. */
const ScalarSchema = z.union([z.string(), z.number(), z.boolean()]);
const UnsafeRationalePattern = /(?:https?:\/\/|www\.|javascript:|<|>|\]\()/i;
const DefinitiveEligibilityPattern = new RegExp(
  [
    ["받을 수", " 있습니다"].join(""),
    ["자격이", " 됩니다"].join(""),
    ["수급", " 자격"].join(""),
  ].join("|"),
);

export const SafeRationaleSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((value) => !UnsafeRationalePattern.test(value), "rationale contains markup or a URL")
  .refine(
    (value) => !DefinitiveEligibilityPattern.test(value),
    "rationale contains a definitive eligibility claim",
  );

/** Points a card at a cached gateway tool result instead of inlining data. */
export const EntityRefSchema = z.discriminatedUnion("toolResult", [
  z.object({ toolResult: z.literal("searchBenefits"), entityId: OpaqueEntityIdSchema }).strict(),
  z.object({ toolResult: z.literal("getBenefitDetail"), entityId: OpaqueEntityIdSchema }).strict(),
  z.object({ toolResult: z.literal("buildChecklist"), entityId: OpaqueEntityIdSchema }).strict(),
  z
    .object({
      toolResult: z.literal("getUpcomingDeadlines"),
      entityId: z.literal("upcoming-deadlines"),
    })
    .strict(),
  z.object({ toolResult: z.literal("listPersonas"), entityId: z.literal("personas") }).strict(),
]);
export type EntityRef = z.infer<typeof EntityRefSchema>;

const CardBaseShape = {
  cardId: OpaqueIdentifierSchema,
  props: z.record(z.string(), ScalarSchema).default({}),
  emphasis: z.enum(["primary", "secondary"]).optional(),
  // Why this card, in terms of a trace signal — powers transparency + tests.
  rationale: SafeRationaleSchema,
};

/**
 * The component discriminator also fixes the only gateway result capable of
 * supplying that component. This rejects semantically invalid but structurally
 * plausible compositions before any A2UI surface is created.
 */
export const CardSpecSchema = z
  .discriminatedUnion("componentType", [
    z.object({
      ...CardBaseShape,
      componentType: z.literal("BenefitCard"),
      entityRef: z.object({
        toolResult: z.literal("searchBenefits"),
        entityId: OpaqueEntityIdSchema,
      }).strict(),
    }).strict(),
    z.object({
      ...CardBaseShape,
      componentType: z.literal("ScoreBreakdown"),
      entityRef: z.object({
        toolResult: z.literal("searchBenefits"),
        entityId: OpaqueEntityIdSchema,
      }).strict(),
    }).strict(),
    z.object({
      ...CardBaseShape,
      componentType: z.literal("Checklist"),
      entityRef: z.object({
        toolResult: z.literal("buildChecklist"),
        entityId: OpaqueEntityIdSchema,
      }).strict(),
    }).strict(),
    z.object({
      ...CardBaseShape,
      componentType: z.literal("DeadlineList"),
      entityRef: z.object({
        toolResult: z.literal("getUpcomingDeadlines"),
        entityId: z.literal("upcoming-deadlines"),
      }).strict(),
    }).strict(),
    z.object({
      ...CardBaseShape,
      componentType: z.literal("PersonaSelector"),
      entityRef: z.object({
        toolResult: z.literal("listPersonas"),
        entityId: z.literal("personas"),
      }).strict(),
    }).strict(),
    z.object({
      ...CardBaseShape,
      componentType: z.literal("SourceNotice"),
      entityRef: z.object({
        toolResult: z.literal("getBenefitDetail"),
        entityId: OpaqueEntityIdSchema,
      }).strict(),
    }).strict(),
  ])
  .superRefine((card, ctx) => {
    const result = validateCatalogProps(card.componentType, card.props);
    if (!result.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.error, path: ["props"] });
    }
  });
export type CardSpec = z.infer<typeof CardSpecSchema>;

/** The single artifact the LLM produces at a composition point. */
export const CompositionSpecSchema = z.object({
  intentSummary: z.string().max(500),
  cards: z.array(CardSpecSchema).max(50),
  order: z.array(OpaqueIdentifierSchema).max(50),
}).strict().superRefine((spec, ctx) => {
  const cardIds = spec.cards.map((card) => card.cardId);
  const uniqueCardIds = new Set(cardIds);
  if (uniqueCardIds.size !== cardIds.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "cardId values must be unique",
      path: ["cards"],
    });
  }

  const uniqueOrder = new Set(spec.order);
  if (uniqueOrder.size !== spec.order.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "order must not contain duplicate card ids",
      path: ["order"],
    });
  }

  const missing = [...uniqueCardIds].filter((id) => !uniqueOrder.has(id));
  const unknown = [...uniqueOrder].filter((id) => !uniqueCardIds.has(id));
  if (missing.length > 0 || unknown.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `order must contain the exact cardId set (missing: ${missing.join(", ") || "none"}; unknown: ${unknown.join(", ") || "none"})`,
      path: ["order"],
    });
  }
});
export type CompositionSpec = z.infer<typeof CompositionSpecSchema>;

// --- Context fed INTO the LLM at a composition point -------------------------

export const EntityEngagementSchema = z.object({
  entityId: OpaqueEntityIdSchema,
  title: z.string().max(240),
  pinned: z.boolean(),
  hidden: z.boolean(),
  expandCount: z.number().int().nonnegative().max(10_000),
  dwellRank: z.number().int().positive().max(100).optional(),
  lastAction: z.string().max(64).optional(),
}).strict();
export type EntityEngagement = z.infer<typeof EntityEngagementSchema>;

export const TraceSummarySchema = z.object({
  entityEngagement: z.array(EntityEngagementSchema).max(50),
  orderingSignal: z
    .object({
      userReordered: z.boolean(),
      topThreeEntityIds: z.array(OpaqueEntityIdSchema).max(3),
    })
    .strict()
    .optional(),
  recentEvents: z.array(z.string().max(256)).max(50),
  turnCount: z.number().int().nonnegative().max(100_000),
}).strict();
export type TraceSummary = z.infer<typeof TraceSummarySchema>;

export const CompositionTriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("query.submit"), text: UserQueryTextSchema }).strict(),
  z
    .object({ type: z.literal("persona.switch"), personaId: RecommendationPersonaSchema })
    .strict(),
]);
export type CompositionTrigger = z.infer<typeof CompositionTriggerSchema>;

export const CurrentCompositionSchema = z
  .object({
    cards: z
      .array(
        z
          .object({
            cardId: OpaqueIdentifierSchema,
            entityId: OpaqueEntityIdSchema.optional(),
            componentType: CatalogComponentTypeSchema,
            pinned: z.boolean(),
            hidden: z.boolean(),
            expanded: z.boolean(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

export const CompositionContextSchema = z
  .object({
    trigger: CompositionTriggerSchema,
    currentComposition: CurrentCompositionSchema,
    traceSummary: TraceSummarySchema,
    profile: StrictUserProfileSchema,
  })
  .strict();
export type CompositionContext = z.infer<typeof CompositionContextSchema>;
