// Re-exports of the gateway's published contract types so the rest of
// genui-canvas has a single import site for @mcp-gen-ui/schema. The gateway is
// the source of truth for benefit data shapes; we never redefine them.
import { UserProfileSchema as PublishedUserProfileSchema } from "@mcp-gen-ui/schema";

/** Consumer-side hardening until the gateway publishes strict v2 objects. */
export const StrictUserProfileSchema = PublishedUserProfileSchema.strict();

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
  RecommendationWeightsSchema,
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
  BenefitSearchResponse,
  UpcomingDeadlinesResponse,
  RecommendationWeights,
} from "@mcp-gen-ui/schema";
