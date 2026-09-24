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

export interface EnforcedComposition {
  spec: CompositionSpec;
  /** Cards shipped after the visible order so the shell can unhide them without a round-trip. */
  hiddenCardIds: string[];
}

/**
 * Server-enforced direct-manipulation invariants: hidden cards never enter the
 * visible order (they ride in a hidden tail), pinned cards stay present and
 * first, and an explicit reorder survives the next composition. A non-compliant
 * provider cannot undo these user actions.
 */
export function enforceManipulationInvariants(
  spec: CompositionSpec,
  current: CurrentComposition,
  cache: ToolResultCache,
  userReordered = false,
): EnforcedComposition {
  const hiddenCurrent = current.cards.filter((card) => card.hidden && card.entityId);
  const hiddenKeys = new Set(
    hiddenCurrent.map((card) => semanticKey(card.componentType, card.entityId!)),
  );
  // Hiding a candidate's BenefitCard hides its whole group; its sub-cards are not shipped.
  const hiddenEntityIds = new Set(
    hiddenCurrent
      .filter((card) => card.componentType === "BenefitCard")
      .map((card) => card.entityId!),
  );
  const isHiddenKey = (card: CardSpec) =>
    hiddenKeys.has(semanticKey(card.componentType, card.entityRef.entityId));
  const ridesWithHiddenGroup = (card: CardSpec) =>
    card.componentType !== "BenefitCard" && hiddenEntityIds.has(card.entityRef.entityId);

  const visibleSpecCards = spec.cards.filter(
    (card) => !isHiddenKey(card) && !ridesWithHiddenGroup(card),
  );
  const hiddenSpecCards = spec.cards.filter((card) => isHiddenKey(card));
  const visibleSpecIds = new Set(visibleSpecCards.map((card) => card.cardId));
  const baseOrder = spec.order.filter((cardId) => visibleSpecIds.has(cardId));
  // Hidden wins if both independent flags are true: a pin controls ordering
  // only while the card is visible and must never resurrect a hidden card.
  const pinned = current.cards.filter((card) => card.pinned && !card.hidden && card.entityId);
  if (pinned.length === 0 && hiddenKeys.size === 0 && !userReordered) {
    return { spec, hiddenCardIds: [] };
  }

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
    const restored = restoredCard(pin.componentType, pin.cardId, entityId, PIN_RATIONALE);
    if (!restored) continue;
    if (!cache.has(restored.entityRef)) continue; // no data to render this pin — cannot enforce

    let card = bySemanticRef.get(pinKey);
    if (!card) {
      const cardId = uniqueCardId(pin.cardId, entityId, usedCardIds, "pinned");
      card = { ...restored, cardId };
      cards.push(card);
      usedCardIds.add(cardId);
      bySemanticRef.set(pinKey, card);
    }
    pinnedCardIds.push(card.cardId);
  }

  const knownIds = new Set(cards.map((card) => card.cardId));
  const baseRest = baseOrder.filter((id) => knownIds.has(id) && !pinnedCardIds.includes(id));
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
    ...new Set([...currentOrder, ...baseRest.filter((cardId) => !currentOrder.includes(cardId))]),
  ];
  const appended = cards
    .map((card) => card.cardId)
    .filter((id) => !pinnedCardIds.includes(id) && !rest.includes(id));

  // Hidden tail: exactly one card per hidden semantic key, provider's card if it
  // emitted one, otherwise restored from the cache.
  const hiddenTail: CardSpec[] = [];
  const hiddenBySemantic = new Map(
    hiddenSpecCards.map((card) => [semanticKey(card.componentType, card.entityRef.entityId), card]),
  );
  const handledHidden = new Set<string>();
  for (const hidden of hiddenCurrent) {
    const entityId = hidden.entityId!;
    const key = semanticKey(hidden.componentType, entityId);
    if (handledHidden.has(key)) continue;
    handledHidden.add(key);
    let card = hiddenBySemantic.get(key);
    if (!card) {
      const restored = restoredCard(hidden.componentType, hidden.cardId, entityId, HIDDEN_RATIONALE);
      if (!restored || !cache.has(restored.entityRef)) continue;
      card = restored;
    }
    if (usedCardIds.has(card.cardId)) {
      card = { ...card, cardId: uniqueCardId(card.cardId, entityId, usedCardIds, "hidden") };
    }
    usedCardIds.add(card.cardId);
    hiddenTail.push(card);
  }
  const hiddenCardIds = hiddenTail.map((card) => card.cardId);

  return {
    spec: {
      ...spec,
      cards: [...cards, ...hiddenTail],
      order: [...pinnedCardIds, ...rest, ...appended, ...hiddenCardIds],
    },
    hiddenCardIds,
  };
}

const PIN_RATIONALE = "사용자가 고정한 카드입니다.";
const HIDDEN_RATIONALE = "사용자가 숨긴 카드입니다. 다시 보기를 누르면 표시됩니다.";

function semanticKey(componentType: string, entityId: string): string {
  return `${componentType}::${entityId}`;
}

function restoredCard(
  componentType: string,
  cardId: string,
  entityId: string,
  rationale: string,
): CardSpec | undefined {
  const base = { cardId, props: {}, emphasis: "primary" as const, rationale };
  switch (componentType) {
    case "BenefitCard":
      return { ...base, componentType, entityRef: { toolResult: "searchBenefits", entityId } };
    case "ScoreBreakdown":
      return { ...base, componentType, entityRef: { toolResult: "searchBenefits", entityId } };
    case "Checklist":
      return { ...base, componentType, entityRef: { toolResult: "buildChecklist", entityId } };
    case "DeadlineList":
      if (entityId !== "upcoming-deadlines") return undefined;
      return { ...base, componentType, entityRef: { toolResult: "getUpcomingDeadlines", entityId } };
    case "PersonaSelector":
      if (entityId !== "personas") return undefined;
      return { ...base, componentType, entityRef: { toolResult: "listPersonas", entityId } };
    case "SourceNotice":
      return { ...base, componentType, entityRef: { toolResult: "getBenefitDetail", entityId } };
    default:
      return undefined;
  }
}

function uniqueCardId(
  preferred: string,
  entityId: string,
  used: Set<string>,
  prefix: "pinned" | "hidden",
): string {
  if (!used.has(preferred)) return preferred;
  const safeEntityId = entityId.replace(/[^a-zA-Z0-9_-]/g, "-") || "benefit";
  const base = `${prefix}-${safeEntityId}`;
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}
