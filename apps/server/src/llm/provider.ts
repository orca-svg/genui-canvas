import type { CompositionContext, EntityRef } from "@genui-canvas/contracts";

export interface ComposeCandidate {
  toolResult: EntityRef["toolResult"];
  entityId: string;
  title: string;
  category: string;
  score: number;
  status: string;
}

export interface ComposeRequest {
  context: CompositionContext;
  candidates: ComposeCandidate[];
}

/**
 * The single seam every LLM plugs into (BYOK). `compose` returns a raw object
 * that the composer validates as a CompositionSpec — providers are never
 * trusted to be well-formed.
 */
export interface LlmProvider {
  readonly name: string;
  compose(request: ComposeRequest): Promise<unknown>;
}

/**
 * Zero-key deterministic provider. Orders candidates by score, honoring the
 * user's pinned/hidden manipulations from the current composition. Serves as
 * the no-API-key default AND the control baseline for the manipulation-check.
 */
export class RuleBasedProvider implements LlmProvider {
  readonly name = "rule-based";

  async compose(request: ComposeRequest): Promise<unknown> {
    const pinned = new Set<string>();
    const hidden = new Set<string>();
    for (const card of request.context.currentComposition.cards) {
      if (!card.entityId) continue;
      if (card.state === "pinned") pinned.add(card.entityId);
      if (card.state === "hidden") hidden.add(card.entityId);
    }

    const ordered = request.candidates
      .filter((candidate) => !hidden.has(candidate.entityId))
      .sort((a, b) => {
        const pinnedDelta = Number(pinned.has(b.entityId)) - Number(pinned.has(a.entityId));
        if (pinnedDelta !== 0) return pinnedDelta;
        return b.score - a.score;
      });

    const cards = ordered.map((candidate, index) => ({
      cardId: `card-${candidate.entityId}`,
      componentType: "BenefitCard" as const,
      entityRef: { toolResult: candidate.toolResult, entityId: candidate.entityId },
      props: {},
      emphasis: index === 0 ? ("primary" as const) : ("secondary" as const),
      rationale: pinned.has(candidate.entityId)
        ? "사용자가 고정한 카드입니다."
        : `적합도 ${Math.round(candidate.score * 100)}% 기준으로 정렬했습니다.`,
    }));

    return {
      intentSummary: `${cards.length}개 후보를 적합도와 사용자 조작을 반영해 구성했습니다.`,
      cards,
      order: cards.map((card) => card.cardId),
    };
  }
}
