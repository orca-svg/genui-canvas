import type {
  CatalogComponentType,
  CompositionContext,
  EntityRef,
} from "@genui-canvas/contracts";

export interface ComposeCandidate {
  toolResult: EntityRef["toolResult"];
  entityId: string;
  category: string;
  score: number;
  status: string;
}

/** A validated cache reference the provider may safely select for one component. */
export interface ComposeResource {
  componentType: CatalogComponentType;
  entityRef: EntityRef;
}

export interface ComposeRequest {
  context: CompositionContext;
  candidates: ComposeCandidate[];
  resources: ComposeResource[];
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

type RawCard = {
  cardId: string;
  componentType: CatalogComponentType;
  entityRef: { toolResult: EntityRef["toolResult"]; entityId: string };
  props: Record<string, never>;
  emphasis: "primary" | "secondary";
  rationale: string;
};

const SUB_CARD_ID_PREFIX = { ScoreBreakdown: "score", Checklist: "checklist", SourceNotice: "source" } as const;

/**
 * Zero-key deterministic provider. Orders candidates by score, honoring pins,
 * hides, and explicit reorders, and turns engagement into sub-cards:
 * expanded → Checklist + SourceNotice, pinned → ScoreBreakdown, ticked rows →
 * Checklist stays, persona.switch → PersonaSelector first, offered deadlines →
 * DeadlineList last. Serves as the no-API-key default AND the CI baseline.
 */
export class RuleBasedProvider implements LlmProvider {
  readonly name = "rule-based";

  async compose(request: ComposeRequest): Promise<unknown> {
    const key = (componentType: string, entityId: string) => `${componentType}::${entityId}`;
    const flags = new Map<string, { pinned: boolean; hidden: boolean; expanded: boolean; index: number }>();
    request.context.currentComposition.cards.forEach((card, index) => {
      if (!card.entityId) return;
      flags.set(key(card.componentType, card.entityId), {
        pinned: card.pinned,
        hidden: card.hidden,
        expanded: card.expanded,
        index,
      });
    });
    const benefitFlags = (entityId: string) => flags.get(key("BenefitCard", entityId));
    const checkedCount = new Map(
      request.context.traceSummary.entityEngagement
        .filter((entry) => entry.checkedItems.length > 0)
        .map((entry) => [entry.entityId, entry.checkedItems.length]),
    );
    const offered = new Set(
      request.resources.map((resource) => key(resource.componentType, resource.entityRef.entityId)),
    );
    const userReordered = request.context.traceSummary.orderingSignal?.userReordered === true;

    const ordered = request.candidates
      .filter((candidate) => !benefitFlags(candidate.entityId)?.hidden)
      .sort((a, b) => {
        const pinnedDelta =
          Number(benefitFlags(b.entityId)?.pinned === true) -
          Number(benefitFlags(a.entityId)?.pinned === true);
        if (pinnedDelta !== 0) return pinnedDelta;
        if (userReordered) {
          const orderDelta =
            (benefitFlags(a.entityId)?.index ?? Number.MAX_SAFE_INTEGER) -
            (benefitFlags(b.entityId)?.index ?? Number.MAX_SAFE_INTEGER);
          if (orderDelta !== 0) return orderDelta;
        }
        return b.score - a.score;
      });

    const cards: RawCard[] = [];
    const sub = (
      componentType: keyof typeof SUB_CARD_ID_PREFIX,
      entityRef: { toolResult: EntityRef["toolResult"]; entityId: string },
      rationale: string,
    ): RawCard => ({
      cardId: `${SUB_CARD_ID_PREFIX[componentType]}-${entityRef.entityId}`,
      componentType,
      entityRef,
      props: {},
      emphasis: "secondary",
      rationale,
    });

    if (request.context.trigger.type === "persona.switch" && offered.has(key("PersonaSelector", "personas"))) {
      cards.push({
        cardId: "personas",
        componentType: "PersonaSelector",
        entityRef: { toolResult: "listPersonas", entityId: "personas" },
        props: {},
        emphasis: "secondary",
        rationale: "추천 관점을 전환했으므로 현재 관점의 가중치와 다른 선택지를 표시합니다.",
      });
    }

    ordered.forEach((candidate, index) => {
      const entityId = candidate.entityId;
      const f = benefitFlags(entityId);
      const checked = checkedCount.get(entityId) ?? 0;
      cards.push({
        cardId: `card-${entityId}`,
        componentType: "BenefitCard",
        entityRef: { toolResult: candidate.toolResult, entityId },
        props: {},
        emphasis: index === 0 ? "primary" : "secondary",
        rationale: f?.pinned
          ? "사용자가 고정한 카드입니다."
          : userReordered && f !== undefined
            ? "사용자가 조정한 카드 순서를 유지했습니다."
            : `상대 관련도 ${Math.round(candidate.score * 100)}/100 기준으로 정렬했습니다(자격 확률 아님).`,
      });
      if (f?.pinned && offered.has(key("ScoreBreakdown", entityId))) {
        cards.push(sub("ScoreBreakdown", { toolResult: "searchBenefits", entityId }, "고정한 후보의 순위 근거를 함께 표시합니다."));
      }
      if ((f?.expanded || checked > 0) && offered.has(key("Checklist", entityId))) {
        cards.push(
          sub(
            "Checklist",
            { toolResult: "buildChecklist", entityId },
            f?.expanded
              ? "펼쳐 본 후보의 신청 준비 항목을 표시합니다."
              : `체크한 준비 항목 ${checked}개가 있어 체크리스트를 유지합니다.`,
          ),
        );
      }
      if (f?.expanded && offered.has(key("SourceNotice", entityId))) {
        cards.push(sub("SourceNotice", { toolResult: "getBenefitDetail", entityId }, "펼쳐 본 후보의 출처와 최신성을 표시합니다."));
      }
    });

    if (offered.has(key("DeadlineList", "upcoming-deadlines"))) {
      cards.push({
        cardId: "deadlines",
        componentType: "DeadlineList",
        entityRef: { toolResult: "getUpcomingDeadlines", entityId: "upcoming-deadlines" },
        props: {},
        emphasis: "secondary",
        rationale: "마감이 확인된 후보가 있어 일정을 표시합니다.",
      });
    }

    return {
      intentSummary: `${ordered.length}개 후보를 상대 관련도와 사용자 조작을 반영해 구성했습니다.`,
      cards,
      order: cards.map((card) => card.cardId),
    };
  }
}
