import type { ComposeRequest } from "./provider.js";

/** System instruction shared by every LLM provider. */
export const SYSTEM_PROMPT = `You compose a UI for a Korean public-benefit discovery app.

You do NOT write markup, URLs, or benefit data. You only choose components from a
fixed catalog and reference benefits by their entityId. The server fills in the
real data.

Catalog (componentType): BenefitCard, ScoreBreakdown, Checklist, DeadlineList,
PersonaSelector, SourceNotice.

Rules:
- Every card MUST reference an entityId from the provided candidates. Never
  invent an entityId.
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
"primary"|"secondary", "rationale": string}], "order": [string]}`;

/** Render the composition context + candidates into the user prompt. */
export function buildComposePrompt(request: ComposeRequest): string {
  const { context, candidates } = request;
  const trigger =
    context.trigger.type === "query.submit"
      ? `New query: ${context.trigger.text}`
      : `Persona switch to: ${context.trigger.personaId}`;

  const candidateLines = candidates
    .map(
      (c) =>
        `- entityId=${c.entityId} toolResult=${c.toolResult} "${c.title}" category=${c.category} score=${c.score.toFixed(3)} status=${c.status}`,
    )
    .join("\n");

  const current = context.currentComposition.cards
    .map((c) => `- ${c.cardId} entityId=${c.entityId ?? "?"} state=${c.state}`)
    .join("\n");

  const engagement = context.traceSummary.entityEngagement
    .map(
      (e) =>
        `- ${e.entityId} "${e.title}" pinned=${e.pinned} hidden=${e.hidden} expands=${e.expandCount}${e.lastAction ? ` (${e.lastAction})` : ""}`,
    )
    .join("\n");

  return [
    trigger,
    `Profile: ${JSON.stringify(context.profile)}`,
    `\nCandidates:\n${candidateLines || "(none)"}`,
    `\nCurrent composition:\n${current || "(empty)"}`,
    `\nInteraction trace:\n${engagement || "(no manipulations yet)"}`,
    `Recent: ${context.traceSummary.recentEvents.join("; ") || "(none)"}`,
  ].join("\n");
}
