import { describe, it, expect } from "vitest";
import { CompositionSpecSchema } from "@genui-canvas/contracts";
import { RuleBasedProvider, type ComposeRequest } from "./provider.js";

const baseRequest = (overrides: Partial<ComposeRequest["context"]> = {}): ComposeRequest => ({
  context: {
    trigger: { type: "query.submit", text: "서울 대학생 지원" },
    currentComposition: { cards: [] },
    traceSummary: { entityEngagement: [], recentEvents: [], turnCount: 0 },
    profile: {},
    ...overrides,
  },
  candidates: [
    { toolResult: "searchBenefits", entityId: "a", category: "education", score: 0.9, status: "candidate" },
    { toolResult: "searchBenefits", entityId: "b", category: "housing", score: 0.6, status: "candidate" },
  ],
  resources: [],
});

describe("RuleBasedProvider", () => {
  it("produces a schema-valid CompositionSpec with one BenefitCard per candidate", async () => {
    const raw = await new RuleBasedProvider().compose(baseRequest());
    const parsed = CompositionSpecSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.cards).toHaveLength(2);
  });

  it("orders by score descending by default", async () => {
    const raw = (await new RuleBasedProvider().compose(baseRequest())) as {
      cards: Array<{ entityRef: { entityId: string } }>;
    };
    expect(raw.cards.map((c) => c.entityRef.entityId)).toEqual(["a", "b"]);
  });

  it("places a pinned card first even when it has a lower score", async () => {
    const req = baseRequest({
      currentComposition: {
        cards: [{ cardId: "card-b", entityId: "b", componentType: "BenefitCard", pinned: true, hidden: false, expanded: false }],
      },
    });
    const raw = (await new RuleBasedProvider().compose(req)) as {
      cards: Array<{ entityRef: { entityId: string } }>;
    };
    expect(raw.cards[0]?.entityRef.entityId).toBe("b");
  });

  it("drops a hidden candidate from the composition", async () => {
    const req = baseRequest({
      currentComposition: {
        cards: [{ cardId: "card-b", entityId: "b", componentType: "BenefitCard", pinned: false, hidden: true, expanded: false }],
      },
    });
    const raw = (await new RuleBasedProvider().compose(req)) as {
      cards: Array<{ entityRef: { entityId: string } }>;
    };
    expect(raw.cards.map((c) => c.entityRef.entityId)).toEqual(["a"]);
  });

  it("preserves an explicit user reorder when the trace reports a reorder", async () => {
    const req = baseRequest({
      currentComposition: {
        cards: [
          { cardId: "card-b", entityId: "b", componentType: "BenefitCard", pinned: false, hidden: false, expanded: false },
          { cardId: "card-a", entityId: "a", componentType: "BenefitCard", pinned: false, hidden: false, expanded: false },
        ],
      },
      traceSummary: {
        entityEngagement: [],
        orderingSignal: { userReordered: true, topThreeEntityIds: ["b", "a"] },
        recentEvents: ["user card.reorder b"],
        turnCount: 1,
      },
    });
    const raw = (await new RuleBasedProvider().compose(req)) as {
      cards: Array<{ entityRef: { entityId: string } }>;
    };
    expect(raw.cards.map((card) => card.entityRef.entityId)).toEqual(["b", "a"]);
  });

  it("is deterministic", async () => {
    const a = await new RuleBasedProvider().compose(baseRequest());
    const b = await new RuleBasedProvider().compose(baseRequest());
    expect(a).toEqual(b);
  });
});

const ref = (toolResult: "searchBenefits" | "buildChecklist" | "getBenefitDetail", entityId: string) => ({ toolResult, entityId });
const fullResources = (): ComposeRequest["resources"] => [
  { componentType: "BenefitCard", entityRef: ref("searchBenefits", "a") },
  { componentType: "ScoreBreakdown", entityRef: ref("searchBenefits", "a") },
  { componentType: "Checklist", entityRef: ref("buildChecklist", "a") },
  { componentType: "SourceNotice", entityRef: ref("getBenefitDetail", "a") },
  { componentType: "BenefitCard", entityRef: ref("searchBenefits", "b") },
  { componentType: "ScoreBreakdown", entityRef: ref("searchBenefits", "b") },
  { componentType: "Checklist", entityRef: ref("buildChecklist", "b") },
  { componentType: "SourceNotice", entityRef: ref("getBenefitDetail", "b") },
  { componentType: "DeadlineList", entityRef: { toolResult: "getUpcomingDeadlines", entityId: "upcoming-deadlines" } },
  { componentType: "PersonaSelector", entityRef: { toolResult: "listPersonas", entityId: "personas" } },
];
const row = (entityId: string, flags: Partial<{ pinned: boolean; hidden: boolean; expanded: boolean }>) => ({
  cardId: `card-${entityId}`,
  entityId,
  componentType: "BenefitCard" as const,
  pinned: false,
  hidden: false,
  expanded: false,
  ...flags,
});
async function composeTypes(request: ComposeRequest): Promise<string[]> {
  const raw = (await new RuleBasedProvider().compose(request)) as {
    cards: Array<{ cardId: string; componentType: string; entityRef: { entityId: string } }>;
    order: string[];
  };
  expect(CompositionSpecSchema.safeParse(raw).success).toBe(true);
  return raw.order.map((id) => {
    const card = raw.cards.find((c) => c.cardId === id)!;
    return `${card.componentType}:${card.entityRef.entityId}`;
  });
}

describe("RuleBasedProvider — trace-driven sub-cards", () => {
  it("emits only BenefitCards plus the offered DeadlineList on a fresh query", async () => {
    expect(await composeTypes({ ...baseRequest(), resources: fullResources() })).toEqual([
      "BenefitCard:a",
      "BenefitCard:b",
      "DeadlineList:upcoming-deadlines",
    ]);
  });

  it("adds Checklist and SourceNotice after an expanded candidate and ScoreBreakdown after a pinned one", async () => {
    const request = {
      ...baseRequest({ currentComposition: { cards: [row("a", { expanded: true }), row("b", { pinned: true })] } }),
      resources: fullResources(),
    };
    expect(await composeTypes(request)).toEqual([
      "BenefitCard:b",
      "ScoreBreakdown:b",
      "BenefitCard:a",
      "Checklist:a",
      "SourceNotice:a",
      "DeadlineList:upcoming-deadlines",
    ]);
  });

  it("keeps a Checklist when the trace shows ticked rows even if the card is collapsed", async () => {
    const request = {
      ...baseRequest({
        traceSummary: {
          entityEngagement: [{ entityId: "b", pinned: false, hidden: false, expandCount: 1, checkedItems: [0, 2] }],
          recentEvents: [],
          turnCount: 1,
        },
      }),
      resources: fullResources(),
    };
    expect(await composeTypes(request)).toEqual([
      "BenefitCard:a",
      "BenefitCard:b",
      "Checklist:b",
      "DeadlineList:upcoming-deadlines",
    ]);
  });

  it("puts a PersonaSelector first only for a persona.switch trigger and never emits unoffered cards", async () => {
    const switched = {
      ...baseRequest({ trigger: { type: "persona.switch", personaId: "senior" } }),
      resources: fullResources(),
    };
    expect((await composeTypes(switched))[0]).toBe("PersonaSelector:personas");
    const bare = { ...baseRequest({ currentComposition: { cards: [row("a", { expanded: true })] } }), resources: [] };
    expect(await composeTypes(bare)).toEqual(["BenefitCard:a", "BenefitCard:b"]);
  });

  it("drops a hidden candidate's whole group", async () => {
    const request = {
      ...baseRequest({ currentComposition: { cards: [row("a", { hidden: true, expanded: true })] } }),
      resources: fullResources(),
    };
    expect(await composeTypes(request)).toEqual(["BenefitCard:b", "DeadlineList:upcoming-deadlines"]);
  });
});
