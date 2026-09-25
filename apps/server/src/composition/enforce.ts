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
 *
 * Every composition's visible order is built from candidate groups (spec
 * rules 6/7) — not only a turn where something was pinned, hidden, or
 * reordered — so a non-compliant provider's scattered cards are regrouped on
 * the very first query: a PersonaSelector first, then each candidate's
 * BenefitCard with its sub-cards in the fixed BenefitCard → ScoreBreakdown →
 * Checklist → SourceNotice order — pinned groups first, then the user's order
 * when they reordered, then the provider's — then sub-cards left without a
 * visible BenefitCard, and DeadlineList last. `spec.cards` is returned in
 * `spec.order`, so every consumer (wire card list, A2UI messages, metadata)
 * sees one order.
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
  // only while the card is visible and must never resurrect a hidden card —
  // nor a sub-card of a candidate whose BenefitCard is hidden.
  const pinned = current.cards.filter(
    (card) =>
      card.pinned &&
      !card.hidden &&
      card.entityId &&
      !(card.componentType !== "BenefitCard" && hiddenEntityIds.has(card.entityId)),
  );

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

  const visibleOrder = groupedVisibleOrder(cards, baseOrder, pinnedCardIds, current, userReordered);

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
  const order = [...visibleOrder, ...hiddenCardIds];

  return {
    spec: {
      ...spec,
      cards: inOrder([...cards, ...hiddenTail], order),
      order,
    },
    hiddenCardIds,
  };
}

/** In-group position of the candidate-scoped components; other types are singletons. */
const GROUP_RANK: Partial<Record<CatalogComponentType, number>> = {
  BenefitCard: 0,
  ScoreBreakdown: 1,
  Checklist: 2,
  SourceNotice: 3,
};

/**
 * Visible order by candidate group: PersonaSelector → pinned groups (a pin on
 * any card of a group pins the group, in the order the pinned rows appear) →
 * the remaining groups with a visible BenefitCard (the user's BenefitCard row
 * order when they reordered, otherwise the provider position of the group's
 * first card) → sub-cards without a visible BenefitCard (grouped per entity,
 * entities by first appearance) → DeadlineList.
 */
function groupedVisibleOrder(
  cards: readonly CardSpec[],
  providerOrder: readonly string[],
  pinnedCardIds: readonly string[],
  current: CurrentComposition,
  userReordered: boolean,
): string[] {
  // Restored pins are not in the provider order; they sort after it, in insertion order.
  const position = new Map(providerOrder.map((cardId, index) => [cardId, index] as const));
  cards.forEach((card, index) => {
    if (!position.has(card.cardId)) position.set(card.cardId, providerOrder.length + index);
  });
  const byPosition = (a: CardSpec, b: CardSpec) =>
    (position.get(a.cardId) ?? 0) - (position.get(b.cardId) ?? 0);
  const inProviderOrder = [...cards].sort(byPosition);
  const isGrouped = (card: CardSpec) => GROUP_RANK[card.componentType] !== undefined;

  // Map insertion order = provider position of each group's first card.
  const groups = new Map<string, CardSpec[]>();
  for (const card of inProviderOrder.filter(isGrouped)) {
    const entityId = card.entityRef.entityId;
    groups.set(entityId, [...(groups.get(entityId) ?? []), card]);
  }
  for (const members of groups.values()) {
    members.sort(
      (a, b) => (GROUP_RANK[a.componentType] ?? 0) - (GROUP_RANK[b.componentType] ?? 0) || byPosition(a, b),
    );
  }

  const cardById = new Map(cards.map((card) => [card.cardId, card]));
  const pinnedEntities: string[] = [];
  for (const cardId of pinnedCardIds) {
    const card = cardById.get(cardId);
    if (!card || !isGrouped(card)) continue;
    if (!pinnedEntities.includes(card.entityRef.entityId)) pinnedEntities.push(card.entityRef.entityId);
  }
  const unpinned = [...groups.keys()].filter((entityId) => !pinnedEntities.includes(entityId));
  const anchored = unpinned.filter((entityId) =>
    groups.get(entityId)!.some((card) => card.componentType === "BenefitCard"),
  );
  if (userReordered) {
    const userIndex = new Map<string, number>();
    current.cards.forEach((row, index) => {
      if (row.componentType !== "BenefitCard" || !row.entityId || row.hidden) return;
      if (!userIndex.has(row.entityId)) userIndex.set(row.entityId, index);
    });
    // Stable: groups the user never saw keep their provider position after the user's rows.
    anchored.sort(
      (a, b) =>
        (userIndex.get(a) ?? Number.MAX_SAFE_INTEGER) - (userIndex.get(b) ?? Number.MAX_SAFE_INTEGER),
    );
  }
  const orphanEntities = new Set(unpinned.filter((entityId) => !anchored.includes(entityId)));

  const ordered = [
    ...inProviderOrder.filter((card) => card.componentType === "PersonaSelector"),
    ...pinnedEntities.flatMap((entityId) => groups.get(entityId) ?? []),
    ...anchored.flatMap((entityId) => groups.get(entityId) ?? []),
    ...[...orphanEntities].flatMap((entityId) => groups.get(entityId) ?? []),
  ];
  const placed = new Set(ordered.map((card) => card.cardId));
  const trailing = inProviderOrder.filter((card) => card.componentType === "DeadlineList");
  // Any other (future) singleton keeps its provider position before DeadlineList.
  const others = inProviderOrder.filter(
    (card) => !placed.has(card.cardId) && card.componentType !== "DeadlineList",
  );
  return [...ordered, ...others, ...trailing].map((card) => card.cardId);
}

/** `cards` rearranged to follow `order` (both hold the exact same cardId set). */
function inOrder(cards: readonly CardSpec[], order: readonly string[]): CardSpec[] {
  const byId = new Map(cards.map((card) => [card.cardId, card]));
  return order.flatMap((cardId) => {
    const card = byId.get(cardId);
    return card ? [card] : [];
  });
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
