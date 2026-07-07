// Re-exports of the gateway's published contract types so the rest of
// genui-canvas has a single import site for @mcp-gen-ui/schema. The gateway is
// the source of truth for benefit data shapes; we never redefine them.
export {
  UserProfileSchema,
  BenefitSummarySchema,
  ScoreBreakdownItemSchema,
  BenefitDetailSchema,
  ChecklistResponseSchema,
  ChecklistItemSchema,
  ApplicationGuideResponseSchema,
  ApplicationStepSchema,
  UpcomingDeadlineSummarySchema,
  UpcomingDeadlinesResponseSchema,
  BenefitSearchResponseSchema,
  RecommendationPersonaSchema,
  BenefitCategorySchema,
} from "@mcp-gen-ui/schema";

export type {
  UserProfile,
  BenefitSummary,
  ScoreBreakdownItem,
  BenefitDetail,
  ChecklistResponse,
  ApplicationGuideResponse,
  RecommendationPersona,
  BenefitCategory,
} from "@mcp-gen-ui/schema";
