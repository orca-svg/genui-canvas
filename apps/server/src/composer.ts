import {
  OpaqueEntityIdSchema,
  type CatalogComponentType,
  type BenefitSummary,
  type CompositionContext,
  type CompositionSpec,
  type CompositionTrigger,
  type TraceSummary,
  type UserProfile,
} from "@genui-canvas/contracts";
import type { GatewayClient } from "./mcp/gateway-client.js";
import type { ComposeCandidate, ComposeResource, LlmProvider } from "./llm/provider.js";
import { ToolResultCache } from "./composition/tool-cache.js";
import { validateComposition } from "./composition/validate.js";
import { enforceManipulationInvariants } from "./composition/enforce.js";
import { expandComposition, type A2uiMessage } from "./composition/expand.js";

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
    }
  | { ok: false; errors: string[] };

export interface CompositionCardMetadata {
  cardId: string;
  title: string;
  sourceUrl?: string;
  sourceCheckedAt?: string;
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

  const query = request.trigger.type === "query.submit" ? request.trigger.text : request.query ?? "";
  const search = (await deps.gateway.searchBenefits(query, request.profile)) as {
    results: BenefitSummary[];
  };
  if (search.results.some((benefit) => !OpaqueEntityIdSchema.safeParse(benefit.id).success)) {
    return { ok: false, errors: ["Gateway returned an invalid opaque entity id"] };
  }
  const benefits = search.results.slice(0, MAX_COMPOSITION_CANDIDATES);
  cache.putSearchResults(benefits);

  // Hydrate the trusted result cache before asking the provider to compose.
  // Each call is deterministic and failures are isolated: search cards remain
  // usable even when one optional gateway surface is temporarily unavailable.
  const [details, checklists, deadlines, personas] = await Promise.all([
    Promise.allSettled(
      benefits.map(async (benefit) => ({
        entityId: benefit.id,
        data: await deps.gateway.getBenefitDetail(benefit.id),
      })),
    ),
    Promise.allSettled(
      benefits.map(async (benefit) => ({
        entityId: benefit.id,
        data: await deps.gateway.buildChecklist(benefit.id),
      })),
    ),
    deps.gateway.getUpcomingDeadlines(request.profile).then(
      (data) => ({ status: "fulfilled" as const, value: data }),
      (reason: unknown) => ({ status: "rejected" as const, reason }),
    ),
    deps.gateway.listPersonas().then(
      (data) => ({ status: "fulfilled" as const, value: data }),
      (reason: unknown) => ({ status: "rejected" as const, reason }),
    ),
  ]);
  for (const result of details) {
    if (result.status === "fulfilled") {
      cache.put("getBenefitDetail", result.value.entityId, result.value.data);
    }
  }
  for (const result of checklists) {
    if (result.status === "fulfilled") {
      cache.put("buildChecklist", result.value.entityId, result.value.data);
    }
  }
  if (deadlines.status === "fulfilled") {
    cache.put("getUpcomingDeadlines", "upcoming-deadlines", deadlines.value);
  }
  if (personas.status === "fulfilled") {
    cache.put("listPersonas", "personas", personas.value);
  }

  const candidates: ComposeCandidate[] = benefits.map((benefit) => ({
    toolResult: "searchBenefits",
    entityId: benefit.id,
    category: benefit.category,
    score: benefit.score,
    status: benefit.status,
  }));
  const resources: ComposeResource[] = [];
  for (const benefit of benefits) {
    const searchRef = { toolResult: "searchBenefits" as const, entityId: benefit.id };
    resources.push(
      { componentType: "BenefitCard", entityRef: searchRef },
      { componentType: "ScoreBreakdown", entityRef: searchRef },
    );
    const checklistRef = { toolResult: "buildChecklist" as const, entityId: benefit.id };
    if (cache.has(checklistRef)) {
      resources.push({ componentType: "Checklist", entityRef: checklistRef });
    }
    const detailRef = { toolResult: "getBenefitDetail" as const, entityId: benefit.id };
    if (cache.has(detailRef)) {
      resources.push({ componentType: "SourceNotice", entityRef: detailRef });
    }
  }
  const deadlineRef = {
    toolResult: "getUpcomingDeadlines" as const,
    entityId: "upcoming-deadlines" as const,
  };
  if (cache.has(deadlineRef)) {
    resources.push({
      componentType: "DeadlineList",
      entityRef: deadlineRef,
    });
  }
  const personasRef = { toolResult: "listPersonas" as const, entityId: "personas" as const };
  if (cache.has(personasRef)) {
    resources.push({
      componentType: "PersonaSelector",
      entityRef: personasRef,
    });
  }

  const context: CompositionContext = {
    trigger: request.trigger,
    currentComposition: request.currentComposition,
    traceSummary: request.traceSummary,
    profile: request.profile as UserProfile,
  };

  const raw = await deps.provider.compose({ context, candidates, resources });
  const validation = validateComposition(raw, cache);
  if (!validation.ok) return { ok: false, errors: validation.errors };

  // Stage 4: direct-manipulation invariants are enforced server-side, so the
  // provider cannot restore hidden cards, bury pinned cards, or erase an
  // explicit user ordering signal.
  const spec = enforceManipulationInvariants(
    validation.spec,
    request.currentComposition,
    cache,
    request.traceSummary.orderingSignal?.userReordered === true,
  );
  const messages = expandComposition(spec, cache);
  return { ok: true, spec, messages, cardMetadata: buildCardMetadata(spec, cache) };
}

function buildCardMetadata(
  spec: CompositionSpec,
  cache: ToolResultCache,
): CompositionCardMetadata[] {
  return spec.order.flatMap((cardId) => {
    const card = spec.cards.find((candidate) => candidate.cardId === cardId);
    if (!card) return [];

    if (card.componentType === "DeadlineList") {
      return [{ cardId, title: "다가오는 신청 마감" }];
    }
    if (card.componentType === "PersonaSelector") {
      return [{ cardId, title: "추천 관점" }];
    }

    const entityId = card.entityRef.entityId;
    const summary = asRecord(
      cache.get({ toolResult: "searchBenefits", entityId }),
    );
    const detail = asRecord(
      cache.get({ toolResult: "getBenefitDetail", entityId }),
    );
    const baseTitle = stringValue(summary.title) ?? stringValue(detail.title) ?? entityId;
    const suffix: Record<string, string> = {
      ScoreBreakdown: " · 상대 관련도",
      Checklist: " · 신청 준비",
      SourceNotice: " · 출처",
    };
    const metadata: CompositionCardMetadata = {
      cardId,
      title: `${baseTitle}${suffix[card.componentType] ?? ""}`,
    };
    const sourceUrl = safeHttpsUrl(detail.sourceUrl);
    if (sourceUrl) metadata.sourceUrl = sourceUrl;
    const sourceCheckedAt = stringValue(detail.lastFetchedAt);
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

function safeHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    return new URL(value).protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}
