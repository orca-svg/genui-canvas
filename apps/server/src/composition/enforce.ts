import type {
  CardSpec,
  CatalogComponentType,
  CompositionSpec,
} from "@genui-canvas/contracts";
import type { ToolResultCache } from "./tool-cache.js";

export interface CurrentComposition {
  cards: Array<{
    cardId: string;
    entityId?: string;
    componentType: CatalogComponentType;
    pinned: boolean;
    hidden: boolean;
    expanded: boolean;
  }>;
}

/**
 * Server-enforced direct-manipulation invariants: hidden cards stay absent,
 * pinned cards stay present and first, and an explicit reorder survives the
 * next composition. A non-compliant provider cannot undo these user actions.
 */
export function enforceManipulationInvariants(
  spec: CompositionSpec,
  current: CurrentComposition,
  cache: ToolResultCache,
  userReordered = false,
): CompositionSpec {
  const hiddenKeys = new Set(
    current.cards
      .filter((card) => card.hidden && card.entityId)
      .map((card) => semanticKey(card.componentType, card.entityId!)),
  );
  const visibleSpecCards = spec.cards.filter(
    (card) => !hiddenKeys.has(semanticKey(card.componentType, card.entityRef.entityId)),
  );
  const visibleSpecIds = new Set(visibleSpecCards.map((card) => card.cardId));
  const baseOrder = spec.order.filter((cardId) => visibleSpecIds.has(cardId));
  // Hidden wins if both independent flags are true: a pin controls ordering
  // only while the card is visible and must never resurrect a hidden card.
  const pinned = current.cards.filter((card) => card.pinned && !card.hidden && card.entityId);
  if (pinned.length === 0 && hiddenKeys.size === 0 && !userReordered) return spec;

  const cards: CardSpec[] = [...visibleSpecCards];
  const bySemanticRef = new Map<string, CardSpec>();
  for (const card of cards) {
    bySemanticRef.set(semanticKey(card.componentType, card.entityRef.entityId), card);
  }

  const pinnedCardIds: string[] = [];
  const usedCardIds = new Set(cards.map((card) => card.cardId));
  const handledPins = new Set<string>();
  for (const pin of pinned) {
    const entityId = pin.entityId;
    if (!entityId) continue;
    const pinKey = semanticKey(pin.componentType, entityId);
    if (handledPins.has(pinKey)) continue;
    handledPins.add(pinKey);
    const restored = restoredCard(pin.componentType, pin.cardId, entityId);
    if (!restored) continue;
    const ref = restored.entityRef;
    if (!cache.has(ref)) continue; // no data to render this pin — cannot enforce

    let card = bySemanticRef.get(pinKey);
    if (!card) {
      const cardId = uniqueCardId(pin.cardId, entityId, usedCardIds);
      card = { ...restored, cardId };
      cards.push(card);
      usedCardIds.add(cardId);
      bySemanticRef.set(pinKey, card);
    }
    pinnedCardIds.push(card.cardId);
  }

  const knownIds = new Set(cards.map((card) => card.cardId));
  const baseRest = baseOrder.filter(
    (id) => knownIds.has(id) && !pinnedCardIds.includes(id),
  );
  const currentOrder = userReordered
    ? current.cards.flatMap((currentCard) => {
        if (!currentCard.entityId || currentCard.hidden) return [];
        const match = cards.find(
          (card) =>
            card.componentType === currentCard.componentType &&
            card.entityRef.entityId === currentCard.entityId,
        );
        return match && !pinnedCardIds.includes(match.cardId) ? [match.cardId] : [];
      })
    : [];
  const rest = [
    ...new Set([
      ...currentOrder,
      ...baseRest.filter((cardId) => !currentOrder.includes(cardId)),
    ]),
  ];
  const appended = cards
    .map((card) => card.cardId)
    .filter((id) => !pinnedCardIds.includes(id) && !rest.includes(id));

  return { ...spec, cards, order: [...pinnedCardIds, ...rest, ...appended] };
}

function semanticKey(componentType: string, entityId: string): string {
  return `${componentType}::${entityId}`;
}

function restoredCard(
  componentType: string,
  cardId: string,
  entityId: string,
): CardSpec | undefined {
  const base = {
    cardId,
    props: {},
    emphasis: "primary" as const,
    rationale: "사용자가 고정한 카드입니다.",
  };
  switch (componentType) {
    case "BenefitCard":
      return {
        ...base,
        componentType,
        entityRef: { toolResult: "searchBenefits", entityId },
      };
    case "ScoreBreakdown":
      return {
        ...base,
        componentType,
        entityRef: { toolResult: "searchBenefits", entityId },
      };
    case "Checklist":
      return {
        ...base,
        componentType,
        entityRef: { toolResult: "buildChecklist", entityId },
      };
    case "DeadlineList":
      if (entityId !== "upcoming-deadlines") return undefined;
      return {
        ...base,
        componentType,
        entityRef: { toolResult: "getUpcomingDeadlines", entityId },
      };
    case "PersonaSelector":
      if (entityId !== "personas") return undefined;
      return {
        ...base,
        componentType,
        entityRef: { toolResult: "listPersonas", entityId },
      };
    case "SourceNotice":
      return {
        ...base,
        componentType,
        entityRef: { toolResult: "getBenefitDetail", entityId },
      };
    default:
      return undefined;
  }
}

function uniqueCardId(preferred: string, entityId: string, used: Set<string>): string {
  if (!used.has(preferred)) return preferred;
  const safeEntityId = entityId.replace(/[^a-zA-Z0-9_-]/g, "-") || "benefit";
  const base = `pinned-${safeEntityId}`;
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}
