import { describe, expect, it } from "vitest";
import { createShellState, shellReducer } from "./shell-store.js";
import { deriveCanvasGroups, rowsOf } from "./canvas-layout.js";
import { isRowSortable, planRowMove, rowBlocksDrop } from "./drag-reorder.js";

const base = () =>
  createShellState("c", [
    { cardId: "card-a", entityId: "a", componentType: "BenefitCard" },
    { cardId: "score-a", entityId: "a", componentType: "ScoreBreakdown" },
    { cardId: "card-b", entityId: "b", componentType: "BenefitCard" },
    { cardId: "card-c", entityId: "c", componentType: "BenefitCard" },
    { cardId: "source-r", entityId: "r", componentType: "SourceNotice" },
  ]).cards;

describe("planRowMove", () => {
  it("moves a row below another by reordering only its BenefitCard after the target's", () => {
    const cards = base();
    const rows = rowsOf(deriveCanvasGroups(cards));
    const action = planRowMove(cards, rows, "row:a", "row:c");
    expect(action).toEqual({ type: "card.reorder", cardId: "card-a", toIndex: 3 });
    const after = shellReducer({ compositionId: "c", cards }, action!).cards;
    expect(rowsOf(deriveCanvasGroups(after)).map((r) => r.key)).toEqual(["row:b", "row:c", "row:a", "row:r"]);
  });

  it("moves a row above another by inserting before the target's BenefitCard", () => {
    const cards = base();
    const rows = rowsOf(deriveCanvasGroups(cards));
    const action = planRowMove(cards, rows, "row:c", "row:a");
    expect(action).toEqual({ type: "card.reorder", cardId: "card-c", toIndex: 0 });
    const after = shellReducer({ compositionId: "c", cards }, action!).cards;
    expect(rowsOf(deriveCanvasGroups(after)).map((r) => r.key)).toEqual(["row:c", "row:a", "row:b", "row:r"]);
  });

  it("refuses to cross the pinned boundary and to move orphan rows", () => {
    let cards = base();
    cards = shellReducer({ compositionId: "c", cards }, { type: "card.pin", cardId: "card-c" }).cards;
    const rows = rowsOf(deriveCanvasGroups(cards));
    expect(planRowMove(cards, rows, "row:a", "row:c")).toBeNull();
    expect(planRowMove(cards, rows, "row:r", "row:a")).toBeNull();
    expect(planRowMove(cards, rows, "row:a", "row:a")).toBeNull();
    const active = rows.find((r) => r.key === "row:a");
    expect(rowBlocksDrop(active, rows.find((r) => r.key === "row:c")!)).toBe(true);
    expect(rowBlocksDrop(active, rows.find((r) => r.key === "row:b")!)).toBe(false);
    expect(rowBlocksDrop(undefined, rows.find((r) => r.key === "row:c")!)).toBe(false);
    expect(isRowSortable(rows.find((r) => r.key === "row:r")!)).toBe(false);
  });
});
