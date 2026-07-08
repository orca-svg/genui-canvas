import type { CardSpec, CompositionSpec } from "@genui-canvas/contracts";
import type { ToolResultCache } from "./tool-cache.js";

export interface CurrentComposition {
  cards: Array<{
    cardId: string;
    entityId?: string;
    componentType: string;
    state: "pinned" | "visible" | "hidden" | "expanded";
  }>;
}

/**
 * Server-enforced invariant (stage 4): a pinned card is preserved and kept on
 * top regardless of what the provider returned. Even a non-compliant or
 * adversarial LLM cannot bury or drop a card the user pinned.
 */
export function enforcePinnedPreservation(
  spec: CompositionSpec,
  current: CurrentComposition,
  cache: ToolResultCache,
): CompositionSpec {
  const pinned = current.cards.filter((card) => card.state === "pinned" && card.entityId);
  if (pinned.length === 0) return spec;

  const cards: CardSpec[] = [...spec.cards];
  const byEntity = new Map<string, CardSpec>();
  for (const card of cards) {
    if (card.entityRef) byEntity.set(card.entityRef.entityId, card);
  }

  const pinnedCardIds: string[] = [];
  for (const pin of pinned) {
    const entityId = pin.entityId;
    if (!entityId) continue;
    const ref = { toolResult: "searchBenefits", entityId } as const;
    if (!cache.has(ref)) continue; // no data to render this pin — cannot enforce

    let card = byEntity.get(entityId);
    if (!card) {
      card = {
        cardId: pin.cardId,
        componentType: "BenefitCard",
        entityRef: ref,
        props: {},
        emphasis: "primary",
        rationale: "사용자가 고정한 카드입니다.",
      };
      cards.push(card);
      byEntity.set(entityId, card);
    }
    pinnedCardIds.push(card.cardId);
  }

  const knownIds = new Set(cards.map((card) => card.cardId));
  const rest = spec.order.filter((id) => knownIds.has(id) && !pinnedCardIds.includes(id));
  const appended = cards
    .map((card) => card.cardId)
    .filter((id) => !pinnedCardIds.includes(id) && !rest.includes(id));

  return { ...spec, cards, order: [...pinnedCardIds, ...rest, ...appended] };
}
