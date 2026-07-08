import { describe, it, expect } from "vitest";
import { ToolResultCache } from "./tool-cache.js";
import { validateComposition } from "./validate.js";

const summary = {
  id: "national-scholarship",
  title: "국가장학금",
  provider: "한국장학재단",
  category: "education",
  summary: "대학생 등록금 지원",
  status: "candidate",
  score: 1,
  scoreBreakdown: [],
  reasons: [],
  missingInfo: [],
};

const cache = () => {
  const c = new ToolResultCache();
  c.putSearchResults([summary]);
  return c;
};

const validRaw = {
  intentSummary: "테스트",
  cards: [
    {
      cardId: "c1",
      componentType: "BenefitCard",
      entityRef: { toolResult: "searchBenefits", entityId: "national-scholarship" },
      rationale: "관심 분야와 일치",
    },
  ],
  order: ["c1"],
};

describe("validateComposition", () => {
  it("accepts a structurally valid spec whose entityRefs are all cached", () => {
    const result = validateComposition(validRaw, cache());
    expect(result.ok).toBe(true);
  });

  it("rejects a spec referencing an entityId not in the tool results (hallucination barrier)", () => {
    const raw = {
      ...validRaw,
      cards: [
        {
          ...validRaw.cards[0],
          entityRef: { toolResult: "searchBenefits", entityId: "ghost-benefit" },
        },
      ],
    };
    const result = validateComposition(raw, cache());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/ghost-benefit/);
  });

  it("rejects a spec with an unknown component type", () => {
    const raw = { ...validRaw, cards: [{ ...validRaw.cards[0], componentType: "RawHtml" }] };
    expect(validateComposition(raw, cache()).ok).toBe(false);
  });

  it("rejects a spec with a url-bearing prop", () => {
    const raw = {
      ...validRaw,
      cards: [{ ...validRaw.cards[0], props: { href: "https://evil.example" } }],
    };
    expect(validateComposition(raw, cache()).ok).toBe(false);
  });
});
