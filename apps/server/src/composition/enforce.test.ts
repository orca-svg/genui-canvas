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
    const pinnedCard = out.cards.find((c) => c.entityRef?.entityId === "b");
    expect(pinnedCard).toBeDefined();
    expect(out.order[0]).toBe(pinnedCard?.cardId);
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
    expect(out.order[0]).toBe("card-b");
  });

  it("leaves a spec unchanged when nothing is pinned", () => {
    const noPin = { cards: [] };
    const spec = specWithout(["card-a"]);
    const out = enforceManipulationInvariants(spec, noPin, cache());
    expect(out.order).toEqual(["card-a"]);
    expect(out.cards).toHaveLength(1);
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

    expect(CompositionSpecSchema.safeParse(out).success).toBe(true);
    expect(new Set(out.cards.map((card) => card.cardId)).size).toBe(out.cards.length);
    expect(new Set(out.order)).toEqual(new Set(out.cards.map((card) => card.cardId)));
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

    expect(out.cards.find((card) => card.cardId === "score-b")).toMatchObject({
      componentType: "ScoreBreakdown",
      entityRef: { toolResult: "searchBenefits", entityId: "b" },
    });
    expect(out.order[0]).toBe("score-b");
    expect(CompositionSpecSchema.safeParse(out).success).toBe(true);
  });

  it("removes a hidden semantic card even when the provider resurfaces it", () => {
    const spec = {
      intentSummary: "x",
      cards: [
        { cardId: "card-a", componentType: "BenefitCard" as const, entityRef: { toolResult: "searchBenefits" as const, entityId: "a" }, props: {}, rationale: "r" },
        { cardId: "provider-renamed-b", componentType: "BenefitCard" as const, entityRef: { toolResult: "searchBenefits" as const, entityId: "b" }, props: {}, rationale: "r" },
      ],
      order: ["card-a", "provider-renamed-b"],
    };
    const hiddenCurrent = {
      cards: [{ cardId: "card-b", entityId: "b", componentType: "BenefitCard", pinned: false, hidden: true, expanded: false }],
    };

    const out = enforceManipulationInvariants(spec, hiddenCurrent, cache());

    expect(out.cards.map((card) => card.entityRef.entityId)).toEqual(["a"]);
    expect(out.order).toEqual(["card-a"]);
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
    expect(out.cards.map((card) => card.entityRef.entityId)).toEqual(["a"]);
    expect(out.order).toEqual(["card-a"]);
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

    expect(out.order).toEqual(["card-b", "card-a"]);
  });
});
