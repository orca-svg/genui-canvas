import { describe, it, expect } from "vitest";
import { createShellState, shellReducer, visibleCardIds, orderedCardIds } from "./shell-store.js";

const init = () =>
  createShellState("comp-1", [
    { cardId: "a", entityId: "national-scholarship", componentType: "BenefitCard" },
    { cardId: "b", entityId: "seoul-youth-rent-support", componentType: "BenefitCard" },
    { cardId: "c", entityId: "job-seeker-allowance", componentType: "BenefitCard" },
  ]);

describe("createShellState", () => {
  it("initializes cards unpinned, visible, collapsed, in given order", () => {
    const state = init();
    expect(orderedCardIds(state)).toEqual(["a", "b", "c"]);
    expect(state.cards.every((c) => !c.pinned && !c.hidden && !c.expanded)).toBe(true);
  });
});

describe("shellReducer manipulations", () => {
  it("pin moves the card above unpinned cards", () => {
    const state = shellReducer(init(), { type: "card.pin", cardId: "c" });
    expect(orderedCardIds(state)).toEqual(["c", "a", "b"]);
    expect(state.cards.find((x) => x.cardId === "c")?.pinned).toBe(true);
  });

  it("keeps pinned cards on top even when an unpinned card is reordered upward", () => {
    let state = shellReducer(init(), { type: "card.pin", cardId: "a" }); // a pinned, top
    state = shellReducer(state, { type: "card.reorder", cardId: "c", toIndex: 0 });
    // c is unpinned; it may rise among unpinned but never above pinned "a"
    expect(orderedCardIds(state)[0]).toBe("a");
    expect(orderedCardIds(state)).toEqual(["a", "c", "b"]);
  });

  it("hide removes a card from the visible set but keeps it in state", () => {
    const state = shellReducer(init(), { type: "card.hide", cardId: "b" });
    expect(visibleCardIds(state)).toEqual(["a", "c"]);
    expect(state.cards).toHaveLength(3);
  });

  it("expand and collapse toggle the expanded flag", () => {
    let state = shellReducer(init(), { type: "card.expand", cardId: "a" });
    expect(state.cards.find((x) => x.cardId === "a")?.expanded).toBe(true);
    state = shellReducer(state, { type: "card.collapse", cardId: "a" });
    expect(state.cards.find((x) => x.cardId === "a")?.expanded).toBe(false);
  });

  it("unpin returns a card into the unpinned band preserving relative order", () => {
    let state = shellReducer(init(), { type: "card.pin", cardId: "b" });
    state = shellReducer(state, { type: "card.pin", cardId: "c" });
    expect(orderedCardIds(state)).toEqual(["b", "c", "a"]);
    state = shellReducer(state, { type: "card.unpin", cardId: "b" });
    expect(orderedCardIds(state)[0]).toBe("c"); // remaining pinned stays on top
    expect(orderedCardIds(state)).toEqual(["c", "b", "a"]);
  });
});

describe("pinned-on-top invariant (property)", () => {
  it("holds after an arbitrary action sequence", () => {
    let state = init();
    const actions = [
      { type: "card.pin", cardId: "b" },
      { type: "card.reorder", cardId: "c", toIndex: 0 },
      { type: "card.pin", cardId: "a" },
      { type: "card.reorder", cardId: "b", toIndex: 2 },
      { type: "card.unpin", cardId: "b" },
    ] as const;
    for (const action of actions) state = shellReducer(state, action);
    const order = state.cards.map((c) => (c.pinned ? 1 : 0));
    const lastPinned = order.lastIndexOf(1);
    const firstUnpinned = order.indexOf(0);
    // every pinned index precedes every unpinned index
    expect(firstUnpinned === -1 || lastPinned < firstUnpinned).toBe(true);
  });
});
