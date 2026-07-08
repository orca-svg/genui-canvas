import type {
  BenefitSummary,
  CompositionContext,
  CompositionSpec,
  CompositionTrigger,
  TraceSummary,
  UserProfile,
} from "@genui-canvas/contracts";
import type { GatewayClient } from "./mcp/gateway-client.js";
import type { ComposeCandidate, LlmProvider } from "./llm/provider.js";
import { ToolResultCache } from "./composition/tool-cache.js";
import { validateComposition } from "./composition/validate.js";
import { expandComposition, type A2uiMessage } from "./composition/expand.js";

export interface ComposerDeps {
  gateway: GatewayClient;
  provider: LlmProvider;
}

export interface CurrentCompositionState {
  cards: Array<{
    cardId: string;
    entityId?: string;
    componentType: string;
    state: "pinned" | "visible" | "hidden" | "expanded";
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
  | { ok: true; spec: CompositionSpec; messages: A2uiMessage[] }
  | { ok: false; errors: string[] };

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
  cache.putSearchResults(search.results);

  const candidates: ComposeCandidate[] = search.results.map((benefit) => ({
    toolResult: "searchBenefits",
    entityId: benefit.id,
    title: benefit.title,
    category: benefit.category,
    score: benefit.score,
    status: benefit.status,
  }));

  const context: CompositionContext = {
    trigger: request.trigger,
    currentComposition: request.currentComposition,
    traceSummary: request.traceSummary,
    profile: request.profile as UserProfile,
  };

  const raw = await deps.provider.compose({ context, candidates });
  const validation = validateComposition(raw, cache);
  if (!validation.ok) return { ok: false, errors: validation.errors };

  const messages = expandComposition(validation.spec, cache);
  return { ok: true, spec: validation.spec, messages };
}
