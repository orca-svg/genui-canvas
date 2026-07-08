import { describe, it, expect } from "vitest";
import { ToolResultCache } from "./tool-cache.js";
import { enforcePinnedPreservation } from "./enforce.js";

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
  cards: [{ cardId: "card-b", entityId: "b", componentType: "BenefitCard", state: "pinned" as const }],
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

describe("enforcePinnedPreservation", () => {
  it("re-adds a pinned card the provider dropped", () => {
    const out = enforcePinnedPreservation(specWithout(["card-a"]), current, cache());
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
    const out = enforcePinnedPreservation(spec, current, cache());
    expect(out.order[0]).toBe("card-b");
  });

  it("leaves a spec unchanged when nothing is pinned", () => {
    const noPin = { cards: [] };
    const spec = specWithout(["card-a"]);
    const out = enforcePinnedPreservation(spec, noPin, cache());
    expect(out.order).toEqual(["card-a"]);
    expect(out.cards).toHaveLength(1);
  });
});
