import { describe, expect, it } from "vitest";
import { createShellState, shellReducer } from "./shell-store.js";
import { ROW_COLUMNS, deriveCanvasGroups, rowsOf } from "./canvas-layout.js";
import type { ShellCardInit } from "./shell-store.js";

const init = (cards: ShellCardInit[]) => createShellState("comp-1", cards).cards;

describe("deriveCanvasGroups", () => {
  it("puts a PersonaSelector band first, DeadlineList last, and one row per candidate in shell order", () => {
    const cards = init([
      { cardId: "deadlines", entityId: "upcoming-deadlines", componentType: "DeadlineList" },
      { cardId: "card-a", entityId: "a", componentType: "BenefitCard", title: "A" },
      { cardId: "score-a", entityId: "a", componentType: "ScoreBreakdown" },
      { cardId: "card-b", entityId: "b", componentType: "BenefitCard", title: "B" },
      { cardId: "personas", entityId: "personas", componentType: "PersonaSelector" },
    ]);
    const groups = deriveCanvasGroups(cards);
    expect(groups.map((g) => g.key)).toEqual(["band:personas", "row:a", "row:b", "band:deadlines"]);
    const rowA = groups[1]!;
    expect(rowA.kind).toBe("row");
    expect(rowA.slots).toEqual([
      { cardId: "card-a", column: "benefit", expanded: false, emphasis: undefined },
      { cardId: "score-a", column: "score", expanded: false, emphasis: undefined },
    ]);
  });

  it("excludes hidden cards and keeps the row when only a sub-card is hidden", () => {
    let cards = init([
      { cardId: "card-a", entityId: "a", componentType: "BenefitCard" },
      { cardId: "checklist-a", entityId: "a", componentType: "Checklist" },
      { cardId: "card-b", entityId: "b", componentType: "BenefitCard" },
    ]);
    cards = shellReducer({ compositionId: "c", cards }, { type: "card.hide", cardId: "checklist-a" }).cards;
    cards = shellReducer({ compositionId: "c", cards }, { type: "card.hide", cardId: "card-b" }).cards;
    const groups = deriveCanvasGroups(cards);
    expect(groups.map((g) => g.key)).toEqual(["row:a"]);
    expect(groups[0]!.slots.map((s) => s.cardId)).toEqual(["card-a"]);
  });

  it("gives an orphan sub-card its own row with no benefit slot", () => {
    const cards = init([
      { cardId: "card-a", entityId: "a", componentType: "BenefitCard" },
      { cardId: "source-r", entityId: "r", componentType: "SourceNotice" },
    ]);
    const rows = rowsOf(deriveCanvasGroups(cards));
    expect(rows.map((r) => r.key)).toEqual(["row:a", "row:r"]);
    expect(rows[1]!.benefitCardId).toBeUndefined();
    expect(rows[1]!.slots).toEqual([{ cardId: "source-r", column: "source", expanded: false, emphasis: undefined }]);
  });

  it("orders rows by the BenefitCard position so moving only the BenefitCard moves the row", () => {
    const cards = init([
      { cardId: "score-a", entityId: "a", componentType: "ScoreBreakdown" },
      { cardId: "card-b", entityId: "b", componentType: "BenefitCard" },
      { cardId: "card-a", entityId: "a", componentType: "BenefitCard" },
    ]);
    expect(rowsOf(deriveCanvasGroups(cards)).map((r) => r.key)).toEqual(["row:b", "row:a"]);
  });

  it("carries pinned/expanded/title from the BenefitCard and marks pinned rows", () => {
    let cards = init([{ cardId: "card-a", entityId: "a", componentType: "BenefitCard", title: "국가장학금" }]);
    cards = shellReducer({ compositionId: "c", cards }, { type: "card.pin", cardId: "card-a" }).cards;
    cards = shellReducer({ compositionId: "c", cards }, { type: "card.expand", cardId: "card-a" }).cards;
    const [row] = rowsOf(deriveCanvasGroups(cards));
    expect(row).toMatchObject({ title: "국가장학금", pinned: true, expanded: true, benefitCardId: "card-a" });
    expect(row!.slots[0]).toMatchObject({ expanded: true });
  });

  it("hides the whole row when its BenefitCard is hidden, keeping sub-cards in the shell", () => {
    let cards = init([
      { cardId: "card-a", entityId: "a", componentType: "BenefitCard" },
      { cardId: "score-a", entityId: "a", componentType: "ScoreBreakdown" },
      { cardId: "card-b", entityId: "b", componentType: "BenefitCard" },
    ]);
    cards = shellReducer({ compositionId: "c", cards }, { type: "card.hide", cardId: "card-a" }).cards;
    expect(deriveCanvasGroups(cards).map((g) => g.key)).toEqual(["row:b"]);
    expect(cards.find((c) => c.cardId === "score-a")?.hidden).toBe(false);
    cards = shellReducer({ compositionId: "c", cards }, { type: "card.unhide", cardId: "card-a" }).cards;
    expect(deriveCanvasGroups(cards).map((g) => g.key)).toEqual(["row:a", "row:b"]);
  });

  it("sorts row slots by the fixed column order and keeps only the first card per column", () => {
    const cards = init([
      { cardId: "checklist-a", entityId: "a", componentType: "Checklist" },
      { cardId: "score-a", entityId: "a", componentType: "ScoreBreakdown" },
      { cardId: "card-a", entityId: "a", componentType: "BenefitCard" },
      { cardId: "score-a-2", entityId: "a", componentType: "ScoreBreakdown" },
    ]);
    const [row] = rowsOf(deriveCanvasGroups(cards));
    expect(row!.slots.map((s) => s.column)).toEqual(["benefit", "score", "checklist"]);
    expect(row!.slots.find((s) => s.column === "score")?.cardId).toBe("score-a");
    expect(row!.slots.map((s) => s.cardId)).not.toContain("score-a-2");
  });

  it("exposes the fixed column order", () => {
    expect([...ROW_COLUMNS]).toEqual(["benefit", "score", "checklist", "source"]);
  });
});
