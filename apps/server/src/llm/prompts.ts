import type { ComposeRequest } from "./provider.js";
import { CATALOG_TOOL_RESULT_BY_COMPONENT } from "@genui-canvas/contracts";

const CATALOG_TOOL_MAPPING_PROMPT = Object.entries(CATALOG_TOOL_RESULT_BY_COMPONENT)
  .map(([componentType, toolResult]) => `- ${componentType} -> ${toolResult}`)
  .join("\n");

/** System instruction shared by every LLM provider. */
export const SYSTEM_PROMPT = `You compose a UI for a Korean public-benefit discovery app.

You do NOT write markup, URLs, or benefit data. You only choose components from a
fixed catalog and reference benefits by their entityId. The server fills in the
real data.

Catalog (componentType): BenefitCard, ScoreBreakdown, Checklist, DeadlineList,
PersonaSelector, SourceNotice.

Required component -> gateway result mapping:
${CATALOG_TOOL_MAPPING_PROMPT}

Rules:
- Copy each card's componentType, toolResult, and entityId from one exact entry
  in "Available component references". Never invent or mix references.
- cardId values MUST be unique. order MUST contain every cardId exactly once,
  with no missing, duplicate, or unknown id.
- Respect the user's manipulations: keep pinned cards first; do not resurface
  hidden cards; honor the trace signals.
- Each card needs a short Korean "rationale" citing why (e.g. the trace signal
  or match reason).
- Recommendations are candidates, not eligibility decisions. No definitive
  eligibility claims.
- props are scalar presentation flags only; never include href/url/html.

Output ONLY a JSON object, no prose and no markdown fences, of the form:
{"intentSummary": string, "cards": [{"cardId": string, "componentType": string,
"entityRef": {"toolResult": string, "entityId": string}, "emphasis":
"primary"|"secondary", "props": object, "rationale": string}], "order": [string]}`;

/** Render the composition context + candidates into the user prompt. */
export function buildComposePrompt(request: ComposeRequest): string {
  const { context, candidates, resources } = request;
  // Only a bounded semantic projection reaches the model. Raw query text,
  // gateway titles/summaries/URLs, and profile strings stay in the trusted
  // deterministic layer so untrusted display data cannot become instructions.
  const trigger = `Request kind: ${context.trigger.type}`;

  const candidateLines = candidates
    .map(
      (c, index) =>
        `- rank=${index + 1} entityId=${c.entityId} toolResult=${c.toolResult} category=${c.category} score=${c.score.toFixed(3)} status=${c.status}`,
    )
    .join("\n");

  const current = context.currentComposition.cards
    .map(
      (c) =>
        `- ${c.cardId} entityId=${c.entityId ?? "?"} pinned=${c.pinned} hidden=${c.hidden} expanded=${c.expanded}`,
    )
    .join("\n");

  const resourceLines = resources
    .map(
      (resource) =>
        `- componentType=${resource.componentType} toolResult=${resource.entityRef.toolResult} entityId=${resource.entityRef.entityId}`,
    )
    .join("\n");

  const engagement = context.traceSummary.entityEngagement
    .map(
      (e) =>
        `- ${e.entityId} pinned=${e.pinned} hidden=${e.hidden} expands=${e.expandCount}${e.lastAction ? ` (${e.lastAction})` : ""}`,
    )
    .join("\n");

  return [
    trigger,
    `\nCandidates:\n${candidateLines || "(none)"}`,
    `\nAvailable component references:\n${resourceLines || "(none)"}`,
    `\nCurrent composition:\n${current || "(empty)"}`,
    `\nInteraction trace:\n${engagement || "(no manipulations yet)"}`,
    `Recent: ${context.traceSummary.recentEvents.join("; ") || "(none)"}`,
  ].join("\n");
}
