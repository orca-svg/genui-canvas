import { describe, it, expect } from "vitest";
import { ToolResultCache } from "./tool-cache.js";

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

describe("ToolResultCache", () => {
  it("round-trips a value put under a tool result + entityId", () => {
    const cache = new ToolResultCache();
    cache.put("getBenefitDetail", "national-scholarship", summary);
    expect(cache.get({ toolResult: "getBenefitDetail", entityId: "national-scholarship" })).toEqual(
      summary,
    );
  });

  it("indexes searchBenefits results by their id", () => {
    const cache = new ToolResultCache();
    cache.putSearchResults([summary, { ...summary, id: "b", title: "서울 청년 월세" }]);
    expect(cache.has({ toolResult: "searchBenefits", entityId: "national-scholarship" })).toBe(true);
    expect(cache.has({ toolResult: "searchBenefits", entityId: "b" })).toBe(true);
  });

  it("reports has=false and get=undefined for a missing ref", () => {
    const cache = new ToolResultCache();
    const ref = { toolResult: "searchBenefits", entityId: "ghost" } as const;
    expect(cache.has(ref)).toBe(false);
    expect(cache.get(ref)).toBeUndefined();
  });
});
