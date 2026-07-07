import { describe, expect, it } from "vitest";
import {
  CompositionSpecSchema,
  CompositionContextSchema,
  TraceSummarySchema,
} from "./composition.js";

const validSpec = {
  intentSummary: "서울 대학생 대상 후보를 주거 우선으로 재구성",
  cards: [
    {
      cardId: "c-housing",
      componentType: "BenefitCard",
      entityRef: { toolResult: "searchBenefits", entityId: "seoul-youth-rent-support" },
      emphasis: "primary",
      rationale: "사용자가 이 카드를 고정했습니다.",
    },
    {
      cardId: "c-scholarship",
      componentType: "BenefitCard",
      entityRef: { toolResult: "searchBenefits", entityId: "national-scholarship" },
      rationale: "관심 분야(교육)와 일치합니다.",
    },
  ],
  order: ["c-housing", "c-scholarship"],
};

describe("CompositionSpecSchema", () => {
  it("accepts a well-formed spec", () => {
    expect(() => CompositionSpecSchema.parse(validSpec)).not.toThrow();
  });

  it("rejects a card with an unknown componentType", () => {
    const bad = { ...validSpec, cards: [{ ...validSpec.cards[0], componentType: "RawHtml" }] };
    expect(CompositionSpecSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a card missing its rationale (transparency contract)", () => {
    const card = { ...validSpec.cards[0] } as Record<string, unknown>;
    delete card.rationale;
    expect(CompositionSpecSchema.safeParse({ ...validSpec, cards: [card] }).success).toBe(false);
  });

  it("rejects a non-scalar prop value on a card", () => {
    const bad = {
      ...validSpec,
      cards: [{ ...validSpec.cards[0], props: { data: { id: "x" } } }],
    };
    expect(CompositionSpecSchema.safeParse(bad).success).toBe(false);
  });

  it("forbids any url-bearing prop (URLs come only from gateway data)", () => {
    const bad = {
      ...validSpec,
      cards: [{ ...validSpec.cards[0], props: { href: "https://evil.example" } }],
    };
    expect(CompositionSpecSchema.safeParse(bad).success).toBe(false);
  });
});

describe("TraceSummarySchema", () => {
  it("accepts an empty summary", () => {
    expect(() =>
      TraceSummarySchema.parse({ entityEngagement: [], recentEvents: [], turnCount: 0 }),
    ).not.toThrow();
  });
});

describe("CompositionContextSchema", () => {
  it("accepts a query-triggered context", () => {
    const ctx = {
      trigger: { type: "query.submit", text: "서울 대학생 지원" },
      currentComposition: { cards: [] },
      traceSummary: { entityEngagement: [], recentEvents: [], turnCount: 0 },
      profile: {},
    };
    expect(() => CompositionContextSchema.parse(ctx)).not.toThrow();
  });
});
