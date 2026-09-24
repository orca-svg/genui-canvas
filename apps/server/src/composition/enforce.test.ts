import { describe, it, expect } from "vitest";
import { CompositionSpecSchema } from "@genui-canvas/contracts";
import { ToolResultCache } from "./tool-cache.js";
import { enforceManipulationInvariants } from "./enforce.js";

const summary = (id: string) => ({
  id,
  title: id,
  provider: "p",
  category: "education",
  summary: "s",
  status: "candidate",
  score: 0.5,
  scoreBreakdown: [],
  reasons: [],
  missingInfo: [],
});

const cache = () => {
  const c = new ToolResultCache();
  c.putSearchResults([summary("a"), summary("b")]);
  return c;
};

const current = {
  cards: [{ cardId: "card-b", entityId: "b", componentType: "BenefitCard", pinned: true, hidden: false, expanded: false }],
};

const specWithout = (order: string[]) => ({
  intentSummary: "x",
  cards: [
    {
      cardId: "card-a",
      componentType: "BenefitCard" as const,
      entityRef: { toolResult: "searchBenefits" as const, entityId: "a" },
      props: {},
      rationale: "r",
    },
  ],
  order,
});

describe("enforceManipulationInvariants", () => {
  it("re-adds a pinned card the provider dropped", () => {
    const out = enforceManipulationInvariants(specWithout(["card-a"]), current, cache());
    const pinnedCard = out.spec.cards.find((c) => c.entityRef?.entityId === "b");
    expect(pinnedCard).toBeDefined();
    expect(out.spec.order[0]).toBe(pinnedCard?.cardId);
  });

  it("moves a pinned card to the front of the order", () => {
    const spec = {
      intentSummary: "x",
      cards: [
        { cardId: "card-a", componentType: "BenefitCard" as const, entityRef: { toolResult: "searchBenefits" as const, entityId: "a" }, props: {}, rationale: "r" },
        { cardId: "card-b", componentType: "BenefitCard" as const, entityRef: { toolResult: "searchBenefits" as const, entityId: "b" }, props: {}, rationale: "r" },
      ],
      order: ["card-a", "card-b"],
    };
    const out = enforceManipulationInvariants(spec, current, cache());
    expect(out.spec.order[0]).toBe("card-b");
  });

  it("leaves a spec unchanged when nothing is pinned", () => {
    const noPin = { cards: [] };
    const spec = specWithout(["card-a"]);
    const out = enforceManipulationInvariants(spec, noPin, cache());
    expect(out.spec.order).toEqual(["card-a"]);
    expect(out.spec.cards).toHaveLength(1);
  });

  it("preserves the exact unique card/order set when a restored pin's old cardId collides", () => {
    const collidingCurrent = {
      cards: [
        {
          cardId: "card-a",
          entityId: "b",
          componentType: "BenefitCard",
          pinned: true,
          hidden: false,
          expanded: false,
        },
      ],
    };

    const out = enforceManipulationInvariants(specWithout(["card-a"]), collidingCurrent, cache());

    expect(CompositionSpecSchema.safeParse(out.spec).success).toBe(true);
    expect(new Set(out.spec.cards.map((card) => card.cardId)).size).toBe(out.spec.cards.length);
    expect(new Set(out.spec.order)).toEqual(new Set(out.spec.cards.map((card) => card.cardId)));
  });

  it("restores a pinned semantic card with its original component/tool contract", () => {
    const scorePin = {
      cards: [
        {
          cardId: "score-b",
          entityId: "b",
          componentType: "ScoreBreakdown",
          pinned: true,
          hidden: false,
          expanded: false,
        },
      ],
    };

    const out = enforceManipulationInvariants(specWithout(["card-a"]), scorePin, cache());

    expect(out.spec.cards.find((card) => card.cardId === "score-b")).toMatchObject({
      componentType: "ScoreBreakdown",
      entityRef: { toolResult: "searchBenefits", entityId: "b" },
    });
    expect(out.spec.order[0]).toBe("score-b");
    expect(CompositionSpecSchema.safeParse(out.spec).success).toBe(true);
  });

  it("keeps a simultaneously pinned and hidden card hidden", () => {
    const hiddenPinned = {
      cards: [
        {
          cardId: "card-b",
          entityId: "b",
          componentType: "BenefitCard" as const,
          pinned: true,
          hidden: true,
          expanded: false,
        },
      ],
    };
    const spec = {
      intentSummary: "x",
      cards: [
        { cardId: "card-a", componentType: "BenefitCard" as const, entityRef: { toolResult: "searchBenefits" as const, entityId: "a" }, props: {}, rationale: "r" },
        { cardId: "card-b", componentType: "BenefitCard" as const, entityRef: { toolResult: "searchBenefits" as const, entityId: "b" }, props: {}, rationale: "r" },
      ],
      order: ["card-a", "card-b"],
    };

    const out = enforceManipulationInvariants(spec, hiddenPinned, cache());
    expect(out.hiddenCardIds).toEqual(["card-b"]);
    expect(out.spec.order).toEqual(["card-a", "card-b"]);
  });

  it("keeps the user's current semantic order after a recorded reorder", () => {
    const spec = {
      intentSummary: "x",
      cards: [
        { cardId: "card-a", componentType: "BenefitCard" as const, entityRef: { toolResult: "searchBenefits" as const, entityId: "a" }, props: {}, rationale: "r" },
        { cardId: "card-b", componentType: "BenefitCard" as const, entityRef: { toolResult: "searchBenefits" as const, entityId: "b" }, props: {}, rationale: "r" },
      ],
      order: ["card-a", "card-b"],
    };
    const reorderedCurrent = {
      cards: [
        { cardId: "card-b", entityId: "b", componentType: "BenefitCard", pinned: false, hidden: false, expanded: false },
        { cardId: "card-a", entityId: "a", componentType: "BenefitCard", pinned: false, hidden: false, expanded: false },
      ],
    };

    const out = enforceManipulationInvariants(spec, reorderedCurrent, cache(), true);

    expect(out.spec.order).toEqual(["card-b", "card-a"]);
  });
});

const twoCardSpec = () => ({
  intentSummary: "x",
  cards: [
    {
      cardId: "card-a",
      componentType: "BenefitCard" as const,
      entityRef: { toolResult: "searchBenefits" as const, entityId: "a" },
      props: {},
      rationale: "r",
    },
    {
      cardId: "card-b",
      componentType: "BenefitCard" as const,
      entityRef: { toolResult: "searchBenefits" as const, entityId: "b" },
      props: {},
      rationale: "r",
    },
  ],
  order: ["card-a", "card-b"],
});

const hiddenA = {
  cards: [
    { cardId: "card-a", entityId: "a", componentType: "BenefitCard" as const, pinned: false, hidden: true, expanded: false },
  ],
};

describe("hidden tail", () => {
  it("keeps a hidden card the provider emitted in a hidden tail after the visible order", () => {
    const result = enforceManipulationInvariants(twoCardSpec(), hiddenA, cache());
    expect(result.hiddenCardIds).toEqual(["card-a"]);
    expect(result.spec.order).toEqual(["card-b", "card-a"]);
    expect(CompositionSpecSchema.safeParse(result.spec).success).toBe(true);
  });

  it("restores a hidden card the provider omitted so the shell can unhide it locally", () => {
    const spec = { ...twoCardSpec(), cards: twoCardSpec().cards.slice(1), order: ["card-b"] };
    const result = enforceManipulationInvariants(spec, hiddenA, cache());
    expect(result.hiddenCardIds).toEqual(["card-a"]);
    const restored = result.spec.cards.find((card) => card.cardId === "card-a");
    expect(restored?.entityRef).toEqual({ toolResult: "searchBenefits", entityId: "a" });
    expect(restored?.rationale).toContain("숨긴");
    expect(result.spec.order).toEqual(["card-b", "card-a"]);
  });

  it("drops the sub-cards of a hidden candidate instead of shipping them", () => {
    const c = cache();
    c.put("buildChecklist", "a", { benefitId: "a", items: [], caveats: [] });
    const spec = {
      ...twoCardSpec(),
      cards: [
        ...twoCardSpec().cards,
        {
          cardId: "checklist-a",
          componentType: "Checklist" as const,
          entityRef: { toolResult: "buildChecklist" as const, entityId: "a" },
          props: {},
          rationale: "r",
        },
      ],
      order: ["card-a", "checklist-a", "card-b"],
    };
    const result = enforceManipulationInvariants(spec, hiddenA, c);
    expect(result.spec.order).toEqual(["card-b", "card-a"]);
    expect(result.spec.cards.map((card) => card.cardId)).not.toContain("checklist-a");
  });

  it("hides only the sub-card when the user hid that sub-card alone", () => {
    const c = cache();
    c.put("buildChecklist", "a", { benefitId: "a", items: [], caveats: [] });
    const spec = {
      ...twoCardSpec(),
      cards: [
        ...twoCardSpec().cards,
        {
          cardId: "checklist-a",
          componentType: "Checklist" as const,
          entityRef: { toolResult: "buildChecklist" as const, entityId: "a" },
          props: {},
          rationale: "r",
        },
      ],
      order: ["card-a", "checklist-a", "card-b"],
    };
    const hiddenChecklist = {
      cards: [
        { cardId: "checklist-a", entityId: "a", componentType: "Checklist" as const, pinned: false, hidden: true, expanded: false },
      ],
    };
    const result = enforceManipulationInvariants(spec, hiddenChecklist, c);
    expect(result.spec.order).toEqual(["card-a", "card-b", "checklist-a"]);
    expect(result.hiddenCardIds).toEqual(["checklist-a"]);
  });

  it("returns no hidden ids and the same spec when nothing was manipulated", () => {
    const result = enforceManipulationInvariants(twoCardSpec(), { cards: [] }, cache());
    expect(result.hiddenCardIds).toEqual([]);
    expect(result.spec.order).toEqual(["card-a", "card-b"]);
  });
});
