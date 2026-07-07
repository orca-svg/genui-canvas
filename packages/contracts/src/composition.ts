import { z } from "zod";
import { CatalogComponentTypeSchema, validateCatalogProps } from "./catalog.js";
import { UserProfileSchema } from "./gateway.js";

/** Scalar-only prop values — the LLM cannot smuggle objects, URLs, or HTML. */
const ScalarSchema = z.union([z.string(), z.number(), z.boolean()]);

/** Points a card at a cached gateway tool result instead of inlining data. */
export const EntityRefSchema = z.object({
  toolResult: z.enum([
    "searchBenefits",
    "getBenefitDetail",
    "getUpcomingDeadlines",
    "buildChecklist",
    "getApplicationGuide",
  ]),
  entityId: z.string().min(1),
});
export type EntityRef = z.infer<typeof EntityRefSchema>;

export const CardSpecSchema = z
  .object({
    cardId: z.string().min(1),
    componentType: CatalogComponentTypeSchema,
    entityRef: EntityRefSchema.optional(),
    props: z.record(ScalarSchema).default({}),
    emphasis: z.enum(["primary", "secondary"]).optional(),
    // Why this card, in terms of a trace signal — powers transparency + tests.
    rationale: z.string().min(1),
  })
  .superRefine((card, ctx) => {
    const result = validateCatalogProps(card.componentType, card.props);
    if (!result.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.error, path: ["props"] });
    }
  });
export type CardSpec = z.infer<typeof CardSpecSchema>;

/** The single artifact the LLM produces at a composition point. */
export const CompositionSpecSchema = z.object({
  intentSummary: z.string(),
  cards: z.array(CardSpecSchema),
  order: z.array(z.string()),
});
export type CompositionSpec = z.infer<typeof CompositionSpecSchema>;

// --- Context fed INTO the LLM at a composition point -------------------------

export const EntityEngagementSchema = z.object({
  entityId: z.string(),
  title: z.string(),
  pinned: z.boolean(),
  hidden: z.boolean(),
  expandCount: z.number().int().nonnegative(),
  dwellRank: z.number().int().positive().optional(),
  lastAction: z.string().optional(),
});
export type EntityEngagement = z.infer<typeof EntityEngagementSchema>;

export const TraceSummarySchema = z.object({
  entityEngagement: z.array(EntityEngagementSchema),
  orderingSignal: z
    .object({ userReordered: z.boolean(), topThreeEntityIds: z.array(z.string()) })
    .optional(),
  recentEvents: z.array(z.string()),
  turnCount: z.number().int().nonnegative(),
});
export type TraceSummary = z.infer<typeof TraceSummarySchema>;

export const CompositionTriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("query.submit"), text: z.string() }),
  z.object({ type: z.literal("persona.switch"), personaId: z.string() }),
]);
export type CompositionTrigger = z.infer<typeof CompositionTriggerSchema>;

export const CurrentCompositionSchema = z.object({
  cards: z.array(
    z.object({
      cardId: z.string(),
      entityId: z.string().optional(),
      componentType: z.string(),
      state: z.enum(["pinned", "visible", "hidden", "expanded"]),
    }),
  ),
});

export const CompositionContextSchema = z.object({
  trigger: CompositionTriggerSchema,
  currentComposition: CurrentCompositionSchema,
  traceSummary: TraceSummarySchema,
  profile: UserProfileSchema,
});
export type CompositionContext = z.infer<typeof CompositionContextSchema>;
