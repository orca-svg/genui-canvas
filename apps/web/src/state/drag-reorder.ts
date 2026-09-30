import type { CanvasRow } from "./canvas-layout.js";
import type { ShellAction, ShellCard } from "./shell-store.js";

/** Only rows anchored by a BenefitCard can be dragged or dropped on. */
export function isRowSortable(row: CanvasRow): boolean {
  return row.benefitCardId !== undefined;
}

/** While `active` is dragged, rows on the other side of the pinned boundary are not drop targets. */
export function rowBlocksDrop(active: CanvasRow | undefined, candidate: CanvasRow): boolean {
  if (!active) return false;
  return isRowSortable(candidate) && candidate.pinned !== active.pinned;
}

/**
 * Translate "row A dropped on row B" into the single `card.reorder` the shell
 * already understands: move A's BenefitCard right after (down) or right
 * before (up) B's BenefitCard. Row order is anchored on the BenefitCard, so
 * A's sub-cards follow without moving.
 */
export function planRowMove(
  cards: readonly ShellCard[],
  rows: readonly CanvasRow[],
  activeKey: string,
  overKey: string,
): ShellAction | null {
  if (activeKey === overKey) return null;
  const activeIndex = rows.findIndex((row) => row.key === activeKey);
  const overIndex = rows.findIndex((row) => row.key === overKey);
  if (activeIndex === -1 || overIndex === -1) return null;
  const active = rows[activeIndex]!;
  const over = rows[overIndex]!;
  if (!isRowSortable(active) || !isRowSortable(over) || active.pinned !== over.pinned) return null;
  const without = cards.filter((card) => card.cardId !== active.benefitCardId);
  const overPosition = without.findIndex((card) => card.cardId === over.benefitCardId);
  if (overPosition === -1) return null;
  const toIndex = activeIndex < overIndex ? overPosition + 1 : overPosition;
  return { type: "card.reorder", cardId: active.benefitCardId!, toIndex };
}
