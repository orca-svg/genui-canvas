/**
 * Shell state: the ordered set of cards and their manipulation flags. This is
 * the deterministic layer — pin/hide/expand/reorder apply instantly here,
 * independent of the LLM. The one invariant: pinned cards always precede
 * unpinned cards (a user cannot bury a pinned card under an unpinned one).
 */
export interface ShellCard {
  cardId: string;
  entityId?: string;
  componentType: CatalogComponentType;
  title?: string;
  sourceUrl?: string;
  sourceCheckedAt?: string;
  pinned: boolean;
  hidden: boolean;
  expanded: boolean;
}

export interface ShellState {
  compositionId: string;
  cards: ShellCard[];
}

export interface ShellCardInit {
  cardId: string;
  entityId?: string;
  componentType: CatalogComponentType;
  title?: string;
  sourceUrl?: string;
  sourceCheckedAt?: string;
}

export type ShellAction =
  | {
      type:
        | "card.pin"
        | "card.unpin"
        | "card.hide"
        | "card.unhide"
        | "card.expand"
        | "card.collapse";
      cardId: string;
    }
  | { type: "card.reorder"; cardId: string; toIndex: number };

export function createShellState(compositionId: string, cards: ShellCardInit[]): ShellState {
  return {
    compositionId,
    cards: cards.map((card) => ({ ...card, pinned: false, hidden: false, expanded: false })),
  };
}

export function orderedCardIds(state: ShellState): string[] {
  return state.cards.map((card) => card.cardId);
}

export function visibleCardIds(state: ShellState): string[] {
  return state.cards.filter((card) => !card.hidden).map((card) => card.cardId);
}

/** Stable partition: pinned cards first, each band keeping its relative order. */
function enforcePinnedTop(cards: ShellCard[]): ShellCard[] {
  return [...cards.filter((c) => c.pinned), ...cards.filter((c) => !c.pinned)];
}

function withPinnedTop(state: ShellState): ShellState {
  return { ...state, cards: enforcePinnedTop(state.cards) };
}

function setFlag(
  state: ShellState,
  cardId: string,
  flag: "pinned" | "hidden" | "expanded",
  value: boolean,
): ShellState {
  return {
    ...state,
    cards: state.cards.map((card) => (card.cardId === cardId ? { ...card, [flag]: value } : card)),
  };
}

function moveCard(state: ShellState, cardId: string, toIndex: number): ShellState {
  const from = state.cards.findIndex((card) => card.cardId === cardId);
  if (from === -1) return state;
  const cards = [...state.cards];
  const [moved] = cards.splice(from, 1);
  const clamped = Math.max(0, Math.min(toIndex, cards.length));
  cards.splice(clamped, 0, moved!);
  return { ...state, cards };
}

export function shellReducer(state: ShellState, action: ShellAction): ShellState {
  switch (action.type) {
    case "card.pin":
      return withPinnedTop(setFlag(state, action.cardId, "pinned", true));
    case "card.unpin":
      return withPinnedTop(setFlag(state, action.cardId, "pinned", false));
    case "card.hide":
      return setFlag(state, action.cardId, "hidden", true);
    case "card.unhide":
      return setFlag(state, action.cardId, "hidden", false);
    case "card.expand":
      return setFlag(state, action.cardId, "expanded", true);
    case "card.collapse":
      return setFlag(state, action.cardId, "expanded", false);
    case "card.reorder":
      return withPinnedTop(moveCard(state, action.cardId, action.toIndex));
  }
}
import type { CatalogComponentType } from "@genui-canvas/contracts";
