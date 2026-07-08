import { CompositionSpecSchema, type CompositionSpec } from "@genui-canvas/contracts";
import type { ToolResultCache } from "./tool-cache.js";

export type ValidationResult =
  | { ok: true; spec: CompositionSpec }
  | { ok: false; errors: string[] };

/**
 * Validate the LLM's raw output before it can render:
 *  1-2. structure + catalog/props (CompositionSpecSchema — strict per-component
 *       props, scalar-only, no url/html props).
 *  3.   reference integrity — every entityRef must point at data the server
 *       actually retrieved (the hallucination barrier).
 * Pinned-preservation (stage 4) is enforced server-side in the composer (M4).
 */
export function validateComposition(raw: unknown, cache: ToolResultCache): ValidationResult {
  const parsed = CompositionSpecSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    };
  }

  const spec = parsed.data;
  const errors: string[] = [];
  for (const card of spec.cards) {
    if (card.entityRef && !cache.has(card.entityRef)) {
      errors.push(
        `card ${card.cardId}: ${card.entityRef.toolResult}:${card.entityRef.entityId} was not retrieved (hallucinated reference)`,
      );
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, spec };
}
