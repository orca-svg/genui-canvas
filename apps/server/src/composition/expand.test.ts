import { describe, it, expect } from "vitest";
import { BASIC_CATALOG_ID } from "@genui-canvas/contracts";
import { ToolResultCache } from "./tool-cache.js";
import { expandComposition } from "./expand.js";

const summary = {
  id: "national-scholarship",
  title: "국가장학금",
  provider: "한국장학재단",
  category: "education",
  summary: "대학생 등록금 지원",
  status: "candidate",
  score: 0.955,
  scoreBreakdown: [],
  reasons: [],
  missingInfo: [],
};

function cacheWith(...summaries: Array<typeof summary>) {
  const cache = new ToolResultCache();
  cache.putSearchResults(summaries);
  return cache;
}

const specFor = (entityId: string, cardId = "c1") => ({
  intentSummary: "테스트",
  cards: [
    {
      cardId,
      componentType: "BenefitCard" as const,
      entityRef: { toolResult: "searchBenefits" as const, entityId },
      props: {},
      rationale: "테스트",
    },
  ],
  order: [cardId],
});

describe("expandComposition — BenefitCard", () => {
  it("emits createSurface with the shared catalog id and the card id as surface id", () => {
    const messages = expandComposition(specFor("national-scholarship"), cacheWith(summary));
    const create = messages.find((m) => "createSurface" in m) as Record<string, unknown>;
    expect(create).toBeDefined();
    expect(create.createSurface).toMatchObject({
      surfaceId: "c1",
      catalogId: BASIC_CATALOG_ID,
    });
  });

  it("binds the benefit data into the data model", () => {
    const messages = expandComposition(specFor("national-scholarship"), cacheWith(summary));
    const dataMsg = messages.find((m) => "updateDataModel" in m) as Record<string, unknown>;
    const value = (dataMsg.updateDataModel as { value: Record<string, unknown> }).value;
    expect(value.title).toBe("국가장학금");
    expect(value.provider).toBe("한국장학재단");
    expect(value.summary).toBe("대학생 등록금 지원");
    expect(value.scoreLabel).toBe("96%");
  });

  it("is deterministic for a fixed input", () => {
    const a = expandComposition(specFor("national-scholarship"), cacheWith(summary));
    const b = expandComposition(specFor("national-scholarship"), cacheWith(summary));
    expect(a).toEqual(b);
  });

  it("skips a card whose entityRef is not in the cache", () => {
    const messages = expandComposition(specFor("ghost"), cacheWith(summary));
    expect(messages.some((m) => "createSurface" in m)).toBe(false);
  });

  it("produces one surface per ordered card", () => {
    const spec = {
      intentSummary: "둘",
      cards: [
        { cardId: "c1", componentType: "BenefitCard" as const, entityRef: { toolResult: "searchBenefits" as const, entityId: "national-scholarship" }, props: {}, rationale: "r" },
        { cardId: "c2", componentType: "BenefitCard" as const, entityRef: { toolResult: "searchBenefits" as const, entityId: "b" }, props: {}, rationale: "r" },
      ],
      order: ["c2", "c1"],
    };
    const messages = expandComposition(spec, cacheWith(summary, { ...summary, id: "b", title: "서울 청년 월세" }));
    const surfaceIds = messages
      .filter((m) => "createSurface" in m)
      .map((m) => (m.createSurface as { surfaceId: string }).surfaceId);
    expect(surfaceIds).toEqual(["c2", "c1"]); // follows spec.order
  });
});
