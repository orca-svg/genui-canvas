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
