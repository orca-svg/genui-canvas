import { describe, it, expect } from "vitest";
import { CompositionSpecSchema } from "@genui-canvas/contracts";
import { ToolResultCache } from "./tool-cache.js";
import { enforceManipulationInvariants } from "./enforce.js";
import { groupedOrderHolds } from "../demo/manipulation-check.js";

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

  it("keeps a hidden entity the provider re-emits under a renamed card id in the hidden tail", () => {
    const spec = {
      intentSummary: "x",
      cards: [
        {
          cardId: "provider-renamed-a",
          componentType: "BenefitCard" as const,
          entityRef: { toolResult: "searchBenefits" as const, entityId: "a" },
          props: {},
          rationale: "r",
        },
        twoCardSpec().cards[1]!,
      ],
      order: ["provider-renamed-a", "card-b"],
    };
    const result = enforceManipulationInvariants(spec, hiddenA, cache());
    // Matched by semantic key (BenefitCard::a), not by the shell's card id.
    expect(result.hiddenCardIds).toEqual(["provider-renamed-a"]);
    expect(result.spec.order).toEqual(["card-b", "provider-renamed-a"]);
    expect(result.spec.cards.filter((card) => card.entityRef.entityId === "a")).toHaveLength(1);
    expect(CompositionSpecSchema.safeParse(result.spec).success).toBe(true);
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

// --- candidate groups (spec rules 6/7, rulings R10/R11) ----------------------

const benefit = (id: string) => ({
  cardId: `card-${id}`,
  componentType: "BenefitCard" as const,
  entityRef: { toolResult: "searchBenefits" as const, entityId: id },
  props: {},
  rationale: "r",
});
const score = (id: string) => ({
  cardId: `score-${id}`,
  componentType: "ScoreBreakdown" as const,
  entityRef: { toolResult: "searchBenefits" as const, entityId: id },
  props: {},
  rationale: "r",
});
const checklist = (id: string) => ({
  cardId: `checklist-${id}`,
  componentType: "Checklist" as const,
  entityRef: { toolResult: "buildChecklist" as const, entityId: id },
  props: {},
  rationale: "r",
});
const source = (id: string) => ({
  cardId: `source-${id}`,
  componentType: "SourceNotice" as const,
  entityRef: { toolResult: "getBenefitDetail" as const, entityId: id },
  props: {},
  rationale: "r",
});
const deadlines = {
  cardId: "deadlines",
  componentType: "DeadlineList" as const,
  entityRef: { toolResult: "getUpcomingDeadlines" as const, entityId: "upcoming-deadlines" as const },
  props: {},
  rationale: "r",
};
const personas = {
  cardId: "personas",
  componentType: "PersonaSelector" as const,
  entityRef: { toolResult: "listPersonas" as const, entityId: "personas" as const },
  props: {},
  rationale: "r",
};
type AnyCard =
  | ReturnType<typeof benefit>
  | ReturnType<typeof score>
  | ReturnType<typeof checklist>
  | ReturnType<typeof source>
  | typeof deadlines
  | typeof personas;
const composedOf = (...cards: AnyCard[]) => ({
  intentSummary: "x",
  cards,
  order: cards.map((card) => card.cardId),
});
const shellRow = (
  cardId: string,
  componentType: AnyCard["componentType"],
  entityId: string,
  flags: Partial<{ pinned: boolean; hidden: boolean; expanded: boolean }> = {},
) => ({ cardId, entityId, componentType, pinned: false, hidden: false, expanded: false, ...flags });

const groupCache = () => {
  const c = new ToolResultCache();
  c.putSearchResults([summary("p"), summary("r"), summary("x")]);
  for (const id of ["p", "r", "x"]) {
    c.put("buildChecklist", id, { benefitId: id, items: [], caveats: [] });
    c.put("getBenefitDetail", id, { result: { id } });
  }
  c.put("getUpcomingDeadlines", "upcoming-deadlines", { results: [{ id: "p" }] });
  c.put("listPersonas", "personas", { personas: [] });
  return c;
};

describe("candidate groups", () => {
  it("keeps pinned, expanded, and reordered groups whole with DeadlineList last", () => {
    const spec = composedOf(
      benefit("p"),
      score("p"),
      benefit("r"),
      checklist("r"),
      source("r"),
      benefit("x"),
      deadlines,
    );
    const current = {
      cards: [
        shellRow("card-p", "BenefitCard", "p", { pinned: true }),
        shellRow("card-r", "BenefitCard", "r", { expanded: true }),
        shellRow("card-x", "BenefitCard", "x"),
        shellRow("deadlines", "DeadlineList", "upcoming-deadlines"),
      ],
    };

    const out = enforceManipulationInvariants(spec, current, groupCache(), true);

    const expected = ["card-p", "score-p", "card-r", "checklist-r", "source-r", "card-x", "deadlines"];
    expect(out.spec.order).toEqual(expected);
    expect(out.spec.cards.map((card) => card.cardId)).toEqual(expected);
    expect(out.hiddenCardIds).toEqual([]);
    expect(CompositionSpecSchema.safeParse(out.spec).success).toBe(true);
  });

  it("puts PersonaSelector first and the pinned group right after it on a persona switch", () => {
    const spec = composedOf(personas, benefit("p"), score("p"), benefit("x"), deadlines);
    const current = {
      cards: [
        shellRow("card-p", "BenefitCard", "p", { pinned: true }),
        shellRow("card-x", "BenefitCard", "x"),
        shellRow("deadlines", "DeadlineList", "upcoming-deadlines"),
      ],
    };

    const out = enforceManipulationInvariants(spec, current, groupCache());

    const expected = ["personas", "card-p", "score-p", "card-x", "deadlines"];
    expect(out.spec.order).toEqual(expected);
    expect(out.spec.cards.map((card) => card.cardId)).toEqual(expected);
  });

  it("pins the whole candidate group when only its sub-card is pinned", () => {
    const spec = composedOf(benefit("x"), benefit("p"), score("p"), deadlines);
    const current = {
      cards: [
        shellRow("score-p", "ScoreBreakdown", "p", { pinned: true }),
        shellRow("card-x", "BenefitCard", "x"),
        shellRow("card-p", "BenefitCard", "p"),
        shellRow("deadlines", "DeadlineList", "upcoming-deadlines"),
      ],
    };

    const out = enforceManipulationInvariants(spec, current, groupCache());

    expect(out.spec.order).toEqual(["card-p", "score-p", "card-x", "deadlines"]);
  });

  it("regroups a non-compliant provider's scattered sub-cards in the fixed in-group order", () => {
    const spec = composedOf(
      deadlines,
      source("r"),
      benefit("x"),
      checklist("r"),
      score("p"),
      benefit("r"),
      benefit("p"),
    );
    const current = {
      cards: [
        shellRow("card-p", "BenefitCard", "p", { pinned: true }),
        shellRow("card-r", "BenefitCard", "r", { expanded: true }),
      ],
    };

    const out = enforceManipulationInvariants(spec, current, groupCache());

    // pinned p first; remaining groups by the provider position of their first card (r before x)
    expect(out.spec.order).toEqual([
      "card-p",
      "score-p",
      "card-r",
      "checklist-r",
      "source-r",
      "card-x",
      "deadlines",
    ]);
  });

  it("regroups a non-compliant provider's scattered sub-cards on an unmanipulated turn", () => {
    const spec = composedOf(score("a"), deadlines, benefit("b"), benefit("a"), checklist("b"));
    const out = enforceManipulationInvariants(spec, { cards: [] }, groupCache());
    expect(out.hiddenCardIds).toEqual([]);
    expect(out.spec.order).toEqual(["card-a", "score-a", "card-b", "checklist-b", "deadlines"]);
    expect(out.spec.cards.map((card) => card.cardId)).toEqual(out.spec.order);
  });

  it("keeps sub-cards without a visible BenefitCard after the groups, grouped per entity in the fixed in-group order", () => {
    const spec = composedOf(source("r"), benefit("x"), checklist("r"), deadlines);
    const current = { cards: [shellRow("card-x", "BenefitCard", "x", { expanded: true })] };

    const out = enforceManipulationInvariants(spec, current, groupCache(), true);

    expect(out.spec.order).toEqual(["card-x", "checklist-r", "source-r", "deadlines"]);
  });

  it("groups interleaved orphan sub-cards per entity, entities in provider first-appearance order", () => {
    const spec = composedOf(benefit("x"), source("r"), checklist("s"), checklist("r"), source("s"), deadlines);
    const out = enforceManipulationInvariants(spec, { cards: [] }, groupCache());
    expect(out.spec.order).toEqual(["card-x", "checklist-r", "source-r", "checklist-s", "source-s", "deadlines"]);
  });

  it("produces an order the replay's groupedOrderHolds accepts even with orphan sub-cards", () => {
    const spec = composedOf(benefit("x"), source("r"), checklist("s"), checklist("r"), source("s"), deadlines);
    const out = enforceManipulationInvariants(spec, { cards: [] }, groupCache());
    const visible = out.spec.cards.map((card) => ({ componentType: card.componentType, entityId: card.entityRef.entityId }));
    expect(groupedOrderHolds(visible, new Set())).toBe(true);
  });

  it("orders unpinned groups by the user's BenefitCard rows, then new candidates by provider order", () => {
    const spec = composedOf(benefit("p"), benefit("x"), checklist("x"), benefit("r"), deadlines);
    const current = {
      cards: [
        shellRow("card-r", "BenefitCard", "r"),
        shellRow("card-x", "BenefitCard", "x", { expanded: true }),
      ],
    };

    const out = enforceManipulationInvariants(spec, current, groupCache(), true);

    expect(out.spec.order).toEqual(["card-r", "card-x", "checklist-x", "card-p", "deadlines"]);
  });

  it("never resurrects a pinned sub-card of a candidate whose BenefitCard is hidden", () => {
    const spec = composedOf(benefit("x"), deadlines);
    const current = {
      cards: [
        shellRow("score-p", "ScoreBreakdown", "p", { pinned: true }),
        shellRow("card-p", "BenefitCard", "p", { hidden: true }),
        shellRow("card-x", "BenefitCard", "x"),
      ],
    };

    const out = enforceManipulationInvariants(spec, current, groupCache());

    expect(out.spec.order).toEqual(["card-x", "deadlines", "card-p"]);
    expect(out.hiddenCardIds).toEqual(["card-p"]);
  });

  it("appends the hidden tail after DeadlineList", () => {
    const spec = composedOf(benefit("p"), score("p"), benefit("x"), deadlines);
    const current = {
      cards: [
        shellRow("card-p", "BenefitCard", "p", { pinned: true }),
        shellRow("card-x", "BenefitCard", "x"),
        shellRow("card-r", "BenefitCard", "r", { hidden: true }),
      ],
    };

    const out = enforceManipulationInvariants(spec, current, groupCache());

    expect(out.spec.order).toEqual(["card-p", "score-p", "card-x", "deadlines", "card-r"]);
    expect(out.hiddenCardIds).toEqual(["card-r"]);
  });
});
