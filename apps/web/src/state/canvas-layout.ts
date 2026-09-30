import type { CatalogComponentType } from "@genui-canvas/contracts";
import type { ShellCard } from "./shell-store.js";

/** Column order of a candidate row; opaque strings to the renderer. */
export const ROW_COLUMNS = ["benefit", "score", "checklist", "source"] as const;
export type RowColumn = (typeof ROW_COLUMNS)[number];

export interface CanvasSlot {
  cardId: string;
  column: string;
  expanded?: boolean;
  emphasis?: "primary" | "secondary";
}
export interface CanvasBand {
  key: string;
  kind: "band";
  slots: CanvasSlot[];
}
export interface CanvasRow {
  key: string;
  kind: "row";
  slots: CanvasSlot[];
  entityId: string;
  benefitCardId?: string;
  title: string;
  pinned: boolean;
  expanded: boolean;
}
export type CanvasGroup = CanvasBand | CanvasRow;

const COLUMN_OF: Partial<Record<CatalogComponentType, RowColumn>> = {
  BenefitCard: "benefit",
  ScoreBreakdown: "score",
  Checklist: "checklist",
  SourceNotice: "source",
};

const slotOf = (card: ShellCard, column: string): CanvasSlot => ({
  cardId: card.cardId,
  column,
  expanded: card.expanded,
  emphasis: card.emphasis,
});

/**
 * Bands first (PersonaSelector), candidate rows in the order their anchor
 * card appears in the shell (BenefitCard, else the first card of the entity),
 * DeadlineList bands last. Hidden cards never enter a group.
 */
export function deriveCanvasGroups(cards: readonly ShellCard[]): CanvasGroup[] {
  const visible = cards.filter((card) => !card.hidden);
  const leading: CanvasBand[] = [];
  const trailing: CanvasBand[] = [];
  const middle: Array<{ anchorIndex: number; group: CanvasGroup }> = [];
  const rowsByEntity = new Map<string, { row: CanvasRow; entry: { anchorIndex: number; group: CanvasGroup } }>();

  visible.forEach((card, index) => {
    const column = COLUMN_OF[card.componentType];
    if (card.componentType === "PersonaSelector") {
      leading.push({ key: `band:${card.cardId}`, kind: "band", slots: [slotOf(card, "band")] });
      return;
    }
    if (card.componentType === "DeadlineList") {
      trailing.push({ key: `band:${card.cardId}`, kind: "band", slots: [slotOf(card, "band")] });
      return;
    }
    if (!column || !card.entityId) {
      middle.push({ anchorIndex: index, group: { key: `band:${card.cardId}`, kind: "band", slots: [slotOf(card, "band")] } });
      return;
    }
    let known = rowsByEntity.get(card.entityId);
    if (!known) {
      const row: CanvasRow = {
        key: `row:${card.entityId}`,
        kind: "row",
        slots: [],
        entityId: card.entityId,
        title: card.entityId,
        pinned: false,
        expanded: false,
      };
      const entry = { anchorIndex: index, group: row };
      known = { row, entry };
      rowsByEntity.set(card.entityId, known);
      middle.push(entry);
    }
    if (known.row.slots.some((slot) => slot.column === column)) return; // first card per column wins
    known.row.slots.push(slotOf(card, column));
    if (column === "benefit") {
      known.row.benefitCardId = card.cardId;
      known.row.title = card.title ?? card.entityId;
      known.row.pinned = card.pinned;
      known.row.expanded = card.expanded;
      known.entry.anchorIndex = index; // the BenefitCard is the row's anchor
    }
  });

  for (const known of rowsByEntity.values()) {
    known.row.slots.sort(
      (a, b) => ROW_COLUMNS.indexOf(a.column as RowColumn) - ROW_COLUMNS.indexOf(b.column as RowColumn),
    );
  }
  middle.sort((a, b) => a.anchorIndex - b.anchorIndex);
  return [...leading, ...middle.map((entry) => entry.group), ...trailing];
}

export function rowsOf(groups: readonly CanvasGroup[]): CanvasRow[] {
  return groups.filter((group): group is CanvasRow => group.kind === "row");
}
