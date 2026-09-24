import {
  CHECKLIST_MAX_ITEMS,
  OpaqueEntityIdSchema,
  type CatalogComponentType,
  type BenefitSummary,
  type CompositionContext,
  type CompositionSpec,
  type CompositionTrigger,
  type GatewayToolName,
  type ToolCallSummary,
  type TraceSummary,
  type UserProfile,
} from "@genui-canvas/contracts";
import type { GatewayClient } from "./mcp/gateway-client.js";
import type { ComposeCandidate, ComposeResource, LlmProvider } from "./llm/provider.js";
import { ToolResultCache } from "./composition/tool-cache.js";
import { validateComposition } from "./composition/validate.js";
import { enforceManipulationInvariants } from "./composition/enforce.js";
import { expandComposition, type A2uiMessage, type ExpandContext } from "./composition/expand.js";

export interface ComposerDeps {
  gateway: GatewayClient;
  provider: LlmProvider;
}

export interface CurrentCompositionState {
  cards: Array<{
    cardId: string;
    entityId?: string;
    componentType: CatalogComponentType;
    pinned: boolean;
    hidden: boolean;
    expanded: boolean;
  }>;
}

export interface TurnRequest {
  trigger: CompositionTrigger;
  profile: UserProfile | Record<string, unknown>;
  traceSummary: TraceSummary;
  currentComposition: CurrentCompositionState;
  /** For persona.switch, the query to re-run (query.submit carries its own). */
  query?: string;
}

export type TurnResult =
  | {
      ok: true;
      spec: CompositionSpec;
      messages: A2uiMessage[];
      cardMetadata: CompositionCardMetadata[];
      /** Cards after the visible order that the shell keeps as hidden rows. */
      hiddenCardIds: string[];
      toolCalls: ToolCallSummary[];
    }
  | { ok: false; errors: string[]; toolCalls: ToolCallSummary[] };

export interface CompositionCardMetadata {
  cardId: string;
  title: string;
  sourceUrl?: string;
  sourceCheckedAt?: string;
  emphasis?: "primary" | "secondary";
  hidden?: boolean;
  /** Checklist only: CheckBox rows bound to /checked{i}. */
  itemCount?: number;
}

/** Per-turn count of gateway calls, recorded as one `tool.called` trace event. */
class ToolCallLedger {
  private readonly byName = new Map<GatewayToolName, { calls: number; failures: number }>();

  async run<T>(name: GatewayToolName, call: () => Promise<T>): Promise<T> {
    const entry = this.byName.get(name) ?? { calls: 0, failures: 0 };
    this.byName.set(name, entry);
    entry.calls += 1;
    try {
      return await call();
    } catch (error) {
      entry.failures += 1;
      throw error;
    }
  }

  summary(): ToolCallSummary[] {
    return [...this.byName.entries()].map(([name, counts]) => ({ name, ...counts }));
  }
}

const MAX_COMPOSITION_CANDIDATES = 12;

/**
 * One composition point. The SERVER drives gateway tool calls deterministically;
 * the provider (LLM or rule-based) only turns candidates + trace into a
 * CompositionSpec. Its output is validated (hallucination barrier) before the
 * deterministic expand renders it.
 */
export async function composeTurn(deps: ComposerDeps, request: TurnRequest): Promise<TurnResult> {
  const cache = new ToolResultCache();
  const ledger = new ToolCallLedger();

  const query = request.trigger.type === "query.submit" ? request.trigger.text : request.query ?? "";
  const search = (await ledger.run("searchBenefits", () =>
    deps.gateway.searchBenefits(query, request.profile),
  )) as { results: BenefitSummary[] };
  if (search.results.some((benefit) => !OpaqueEntityIdSchema.safeParse(benefit.id).success)) {
    return { ok: false, errors: ["Gateway returned an invalid opaque entity id"], toolCalls: ledger.summary() };
  }
  const benefits = search.results.slice(0, MAX_COMPOSITION_CANDIDATES);
  cache.putSearchResults(benefits);

  const [details, checklists, deadlines, personas] = await Promise.all([
    Promise.allSettled(
      benefits.map(async (benefit) => ({
        entityId: benefit.id,
        data: await ledger.run("getBenefitDetail", () => deps.gateway.getBenefitDetail(benefit.id)),
      })),
    ),
    Promise.allSettled(
      benefits.map(async (benefit) => ({
        entityId: benefit.id,
        data: await ledger.run("buildChecklist", () => deps.gateway.buildChecklist(benefit.id)),
      })),
    ),
    ledger.run("getUpcomingDeadlines", () => deps.gateway.getUpcomingDeadlines(request.profile)).then(
      (data) => ({ status: "fulfilled" as const, value: data }),
      (reason: unknown) => ({ status: "rejected" as const, reason }),
    ),
    ledger.run("listPersonas", () => deps.gateway.listPersonas()).then(
      (data) => ({ status: "fulfilled" as const, value: data }),
      (reason: unknown) => ({ status: "rejected" as const, reason }),
    ),
  ]);
  for (const result of details) {
    if (result.status === "fulfilled") cache.put("getBenefitDetail", result.value.entityId, result.value.data);
  }
  for (const result of checklists) {
    if (result.status === "fulfilled") cache.put("buildChecklist", result.value.entityId, result.value.data);
  }
  // Only offer DeadlineList when there is at least one dated row to show.
  if (deadlines.status === "fulfilled" && deadlines.value.results.length > 0) {
    cache.put("getUpcomingDeadlines", "upcoming-deadlines", deadlines.value);
  }
  if (personas.status === "fulfilled") cache.put("listPersonas", "personas", personas.value);

  const candidates: ComposeCandidate[] = benefits.map((benefit) => ({
    toolResult: "searchBenefits",
    entityId: benefit.id,
    category: benefit.category,
    score: benefit.ranking.score,
    status: benefit.assessment.status,
  }));
  const resources: ComposeResource[] = [];
  for (const benefit of benefits) {
    const searchRef = { toolResult: "searchBenefits" as const, entityId: benefit.id };
    resources.push(
      { componentType: "BenefitCard", entityRef: searchRef },
      { componentType: "ScoreBreakdown", entityRef: searchRef },
    );
    const checklistRef = { toolResult: "buildChecklist" as const, entityId: benefit.id };
    if (cache.has(checklistRef)) resources.push({ componentType: "Checklist", entityRef: checklistRef });
    const detailRef = { toolResult: "getBenefitDetail" as const, entityId: benefit.id };
    if (cache.has(detailRef)) resources.push({ componentType: "SourceNotice", entityRef: detailRef });
  }
  const deadlineRef = { toolResult: "getUpcomingDeadlines" as const, entityId: "upcoming-deadlines" as const };
  if (cache.has(deadlineRef)) resources.push({ componentType: "DeadlineList", entityRef: deadlineRef });
  const personasRef = { toolResult: "listPersonas" as const, entityId: "personas" as const };
  if (cache.has(personasRef)) resources.push({ componentType: "PersonaSelector", entityRef: personasRef });

  const context: CompositionContext = {
    trigger: request.trigger,
    currentComposition: request.currentComposition,
    traceSummary: request.traceSummary,
    profile: request.profile as UserProfile,
  };

  const raw = await deps.provider.compose({ context, candidates, resources });
  const validation = validateComposition(raw, cache);
  if (!validation.ok) return { ok: false, errors: validation.errors, toolCalls: ledger.summary() };

  const enforced = enforceManipulationInvariants(
    validation.spec,
    request.currentComposition,
    cache,
    request.traceSummary.orderingSignal?.userReordered === true,
  );
  const expandContext: ExpandContext = {
    checkedItemsByEntity: Object.fromEntries(
      request.traceSummary.entityEngagement
        .filter((entry) => entry.checkedItems.length > 0)
        .map((entry) => [entry.entityId, entry.checkedItems]),
    ),
    activePersonaId:
      request.trigger.type === "persona.switch"
        ? request.trigger.personaId
        : stringValue(asRecord(request.profile).persona),
  };
  const messages = expandComposition(enforced.spec, cache, expandContext);
  return {
    ok: true,
    spec: enforced.spec,
    messages,
    cardMetadata: buildCardMetadata(enforced.spec, cache, new Set(enforced.hiddenCardIds)),
    hiddenCardIds: enforced.hiddenCardIds,
    toolCalls: ledger.summary(),
  };
}

function buildCardMetadata(
  spec: CompositionSpec,
  cache: ToolResultCache,
  hiddenIds: Set<string>,
): CompositionCardMetadata[] {
  return spec.order.flatMap((cardId) => {
    const card = spec.cards.find((candidate) => candidate.cardId === cardId);
    if (!card) return [];
    const common = {
      cardId,
      ...(card.emphasis ? { emphasis: card.emphasis } : {}),
      ...(hiddenIds.has(cardId) ? { hidden: true } : {}),
    };

    if (card.componentType === "DeadlineList") return [{ ...common, title: "다가오는 신청 마감" }];
    if (card.componentType === "PersonaSelector") return [{ ...common, title: "추천 관점" }];

    const entityId = card.entityRef.entityId;
    const summary = asRecord(cache.get({ toolResult: "searchBenefits", entityId }));
    const detailResponse = asRecord(cache.get({ toolResult: "getBenefitDetail", entityId }));
    const detail = asRecord(detailResponse.result);
    const baseTitle = stringValue(summary.title) ?? stringValue(detail.title) ?? entityId;
    const suffix: Record<string, string> = {
      ScoreBreakdown: " · 상대 관련도",
      Checklist: " · 신청 준비",
      SourceNotice: " · 출처",
    };
    const metadata: CompositionCardMetadata = {
      ...common,
      title: `${baseTitle}${suffix[card.componentType] ?? ""}`,
    };
    if (card.componentType === "Checklist") {
      const checklist = asRecord(cache.get({ toolResult: "buildChecklist", entityId }));
      const items = Array.isArray(checklist.items) ? checklist.items : [];
      metadata.itemCount = Math.min(items.length, CHECKLIST_MAX_ITEMS);
    }
    const sourceLink = preferredOfficialLink(detail.links, "source");
    if (sourceLink) metadata.sourceUrl = sourceLink.url;
    const freshness = asRecord(detail.freshness);
    const sourceCheckedAt = stringValue(sourceLink?.verifiedAt) ?? stringValue(freshness.observedAt);
    if (sourceCheckedAt) metadata.sourceCheckedAt = sourceCheckedAt;
    return [metadata];
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function preferredOfficialLink(
  value: unknown,
  relation: "source" | "apply",
): { url: string; verifiedAt?: string } | undefined {
  if (!Array.isArray(value)) return undefined;
  for (const candidate of value) {
    const link = asRecord(candidate);
    if (link.official !== true || link.rel !== relation || typeof link.url !== "string") {
      continue;
    }
    try {
      if (new URL(link.url).protocol !== "https:") continue;
      return {
        url: link.url,
        ...(typeof link.verifiedAt === "string" ? { verifiedAt: link.verifiedAt } : {}),
      };
    } catch {
      // The published schema rejects this; retain a defensive consumer guard.
    }
  }
  return undefined;
}
