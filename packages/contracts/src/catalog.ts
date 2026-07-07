import { z } from "zod";

/**
 * The trusted component catalog. Per A2UI's "safe like data" principle, the LLM
 * may only request components from this list, and only with the scalar
 * presentation props defined here. All benefit data flows in via `entityRef`
 * (see composition.ts), never through props — so there is no prop that can carry
 * a URL, HTML, or arbitrary data.
 */
export const CATALOG_COMPONENT_TYPES = [
  "BenefitCard",
  "ScoreBreakdown",
  "Checklist",
  "DeadlineList",
  "PersonaSelector",
  "SourceNotice",
] as const;
export type CatalogComponentType = (typeof CATALOG_COMPONENT_TYPES)[number];

export const CatalogComponentTypeSchema = z.enum(CATALOG_COMPONENT_TYPES);

/** Per-component scalar-only prop schemas (strict: unknown keys are rejected). */
export const CATALOG_PROPS = {
  BenefitCard: z
    .object({ showScore: z.boolean().optional(), showReasons: z.boolean().optional() })
    .strict(),
  ScoreBreakdown: z.object({ maxItems: z.number().int().positive().optional() }).strict(),
  Checklist: z.object({ compact: z.boolean().optional() }).strict(),
  DeadlineList: z.object({ withinDays: z.number().int().nonnegative().optional() }).strict(),
  PersonaSelector: z.object({}).strict(),
  SourceNotice: z.object({}).strict(),
} satisfies Record<CatalogComponentType, z.ZodTypeAny>;

export type CatalogValidation = { ok: true } | { ok: false; error: string };

export function validateCatalogProps(type: string, props: unknown): CatalogValidation {
  const schema = (CATALOG_PROPS as Record<string, z.ZodTypeAny | undefined>)[type];
  if (!schema) return { ok: false, error: `unknown component type: ${type}` };
  const result = schema.safeParse(props ?? {});
  return result.success ? { ok: true } : { ok: false, error: result.error.message };
}
