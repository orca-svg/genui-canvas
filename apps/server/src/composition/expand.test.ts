import { describe, it, expect } from "vitest";
import { A2uiMessageSchema, BASIC_CATALOG_ID } from "@genui-canvas/contracts";
import { ToolResultCache } from "./tool-cache.js";
import { expandComposition } from "./expand.js";

const summary = {
  id: "national-scholarship",
  title: "국가장학금",
  provider: "한국장학재단",
  category: "education",
  summary: "대학생 등록금 지원",
  assessment: {
    status: "candidate",
    constraints: [
      {
        dimension: "student",
        outcome: "match",
        basis: "authoritative_structured",
        ruleId: "test.student",
        ruleVersion: "2.0.0",
        sourceFields: ["studentStatus"],
        explanation: "재학생 조건과 일치합니다.",
      },
    ],
    missingInfo: ["소득 구간 확인 필요"],
  },
  ranking: {
    score: 0.955,
    breakdown: [
      {
        dimension: "student",
        signal: 1,
        weight: 3,
        contribution: 3,
        explanation: "재학생 조건과 일치합니다.",
      },
    ],
  },
  provenance: [],
  links: [],
  freshness: { status: "fresh", observedAt: "2026-07-10T00:00:00.000Z" },
};

function detailResponse() {
  return {
    schemaVersion: "benefit-detail.v2",
    dataStatus: {
      mode: "fixture",
      partial: false,
      sources: [
        {
          sourceId: "fixture-benefits",
          status: "ok",
          retrievedAt: "2026-07-09T12:00:00.000Z",
          recordCount: 1,
          adapterVersion: "0.3.0",
        },
      ],
    },
    result: {
      ...summary,
      target: "대학생",
      eligibility: [],
      documents: [],
      applicationMethods: [],
      links: [
        {
          rel: "source",
          url: "https://www.gov.kr/official-benefit",
          official: true,
          health: "verified",
          verifiedAt: "2026-07-09T12:00:00.000Z",
        },
        {
          rel: "apply",
          url: "https://apply.example.go.kr/benefit",
          official: true,
          health: "unchecked",
        },
      ],
      freshness: { status: "fresh", observedAt: "2026-07-09T12:00:00.000Z" },
    },
    generatedAt: "2026-07-10T00:00:00.000Z",
  };
}

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
    expect(value.scoreLabel).toBe("상대 관련도 96/100 · 자격 확률 아님");
  });

  it("keeps recommendation evidence, uncertainty, rationale, and the retrieved gateway source in the BenefitCard model", () => {
    const cache = cacheWith(summary);
    cache.put("getBenefitDetail", summary.id, detailResponse());

    const messages = expandComposition(specFor(summary.id), cache);
    const dataMsg = messages.find((m) => "updateDataModel" in m) as Record<string, unknown>;
    const value = (dataMsg.updateDataModel as { value: Record<string, unknown> }).value;

    expect(value).toMatchObject({
      status: "candidate",
      reasons: ["재학생 조건과 일치합니다."],
      missingInfo: ["소득 구간 확인 필요"],
      scoreBreakdown: [
        expect.objectContaining({ dimension: "student", explanation: "재학생 조건과 일치합니다." }),
      ],
      rationale: "테스트",
      sourceUrl: "https://www.gov.kr/official-benefit",
    });
    expect(value.candidateCaveat).toMatch(/후보|자격/);
  });

  it("is deterministic for a fixed input", () => {
    const a = expandComposition(specFor("national-scholarship"), cacheWith(summary));
    const b = expandComposition(specFor("national-scholarship"), cacheWith(summary));
    expect(a).toEqual(b);
  });

  it("frames a structured conflict as a verification need, not a final decision", () => {
    const conflict = {
      ...summary,
      assessment: { ...summary.assessment, status: "conflict_detected" },
    };
    const messages = expandComposition(specFor(summary.id), cacheWith(conflict));
    const dataMsg = messages.find((message) => "updateDataModel" in message) as Record<string, unknown>;
    const value = (dataMsg.updateDataModel as { value: Record<string, unknown> }).value;

    expect(value.statusLabel).toBe("구조화된 공식 조건과 충돌 감지 · 공식 요건 확인 필요");
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

describe("expandComposition — semantic catalog components", () => {
  it("caps dynamic rows so every emitted A2UI message stays inside the wire limits", () => {
    const cache = new ToolResultCache();
    cache.put("listPersonas", "personas", {
      personas: Array.from({ length: 120 }, (_, index) => ({
        id: "general",
        description: `관점 ${index}`,
        weights: { query: 1 },
      })),
    });
    const spec = {
      intentSummary: "관점 상한",
      cards: [
        {
          cardId: "persona-card",
          componentType: "PersonaSelector" as const,
          entityRef: { toolResult: "listPersonas" as const, entityId: "personas" as const },
          props: {},
          rationale: "표시 행 수를 제한합니다.",
        },
      ],
      order: ["persona-card"],
    };

    const messages = expandComposition(spec, cache);
    expect(messages.every((message) => A2uiMessageSchema.safeParse(message).success)).toBe(true);
    const componentMessage = messages.find((message) => "updateComponents" in message) as {
      updateComponents: { components: Array<{ component: string; children?: string[] }> };
    };
    const root = componentMessage.updateComponents.components.find(
      (component) => component.component === "Column",
    );
    expect(root?.children?.length).toBeLessThanOrEqual(100);
  });

  it("renders ScoreBreakdown from retrieved recommendation dimensions instead of a generic summary", () => {
    const spec = {
      intentSummary: "점수 설명",
      cards: [
        {
          cardId: "score-card",
          componentType: "ScoreBreakdown" as const,
          entityRef: { toolResult: "searchBenefits" as const, entityId: summary.id },
          props: { maxItems: 1 },
          rationale: "추천 점수를 설명합니다.",
        },
      ],
      order: ["score-card"],
    };

    const messages = expandComposition(spec, cacheWith(summary));
    const dataMsg = messages.find((m) => "updateDataModel" in m) as Record<string, unknown>;
    const value = (dataMsg.updateDataModel as { value: Record<string, unknown> }).value;

    expect(value).toMatchObject({
      benefitTitle: "국가장학금",
      scoreLabel: "상대 관련도 96/100 · 자격 확률 아님",
      items: [
        expect.objectContaining({
          dimension: "student",
          contribution: 3,
          explanation: "재학생 조건과 일치합니다.",
        }),
      ],
      rationale: "추천 점수를 설명합니다.",
    });
  });

  it("renders Checklist items, required markers, and gateway caveats", () => {
    const cache = new ToolResultCache();
    cache.put("buildChecklist", summary.id, {
      benefitId: summary.id,
      items: [
        { id: "enrollment", label: "재학증명서", required: true, source: "공고문" },
        { id: "consent", label: "가구원 동의서", required: false },
      ],
      caveats: ["자격 판정이 아니며 공식 공고를 확인하세요."],
    });
    const spec = {
      intentSummary: "준비물",
      cards: [
        {
          cardId: "checklist-card",
          componentType: "Checklist" as const,
          entityRef: { toolResult: "buildChecklist" as const, entityId: summary.id },
          props: { compact: false },
          rationale: "신청 준비를 돕습니다.",
        },
      ],
      order: ["checklist-card"],
    };

    const messages = expandComposition(spec, cache);
    const dataMsg = messages.find((m) => "updateDataModel" in m) as Record<string, unknown>;
    const value = (dataMsg.updateDataModel as { value: Record<string, unknown> }).value;

    expect(value).toMatchObject({
      benefitId: summary.id,
      requiredCount: 1,
      items: [
        expect.objectContaining({ label: "재학증명서", required: true }),
        expect.objectContaining({ label: "가구원 동의서", required: false }),
      ],
      caveats: ["자격 판정이 아니며 공식 공고를 확인하세요."],
      rationale: "신청 준비를 돕습니다.",
    });
  });

  it("renders DeadlineList as dated candidate rows with uncertainty intact", () => {
    const cache = new ToolResultCache();
    cache.put("getUpcomingDeadlines", "upcoming-deadlines", {
      profile: { regionCode: "KR-11" },
      withinDays: 30,
      generatedAt: "2026-07-10T00:00:00.000Z",
      results: [
        {
          ...summary,
          assessment: {
            ...summary.assessment,
            status: "needs_more_info",
            missingInfo: ["소득 구간"],
          },
          applicationDeadline: "2026-07-20T14:59:59.000Z",
        },
        {
          ...summary,
          id: "outside-window",
          title: "두 달 뒤 마감",
          applicationDeadline: "2026-09-20T14:59:59.000Z",
        },
      ],
    });
    const spec = {
      intentSummary: "마감 일정",
      cards: [
        {
          cardId: "deadline-card",
          componentType: "DeadlineList" as const,
          entityRef: {
            toolResult: "getUpcomingDeadlines" as const,
            entityId: "upcoming-deadlines" as const,
          },
          props: { withinDays: 30 },
          rationale: "가까운 신청 마감을 놓치지 않도록 표시합니다.",
        },
      ],
      order: ["deadline-card"],
    };

    const messages = expandComposition(spec, cache);
    const dataMsg = messages.find((m) => "updateDataModel" in m) as Record<string, unknown>;
    const value = (dataMsg.updateDataModel as { value: Record<string, unknown> }).value;

    expect(value).toMatchObject({
      withinDays: 30,
      generatedAt: "2026-07-10T00:00:00.000Z",
      results: [
        expect.objectContaining({
          id: summary.id,
          assessment: expect.objectContaining({
            status: "needs_more_info",
            missingInfo: ["소득 구간"],
          }),
          applicationDeadline: "2026-07-20T14:59:59.000Z",
        }),
      ],
      rationale: "가까운 신청 마감을 놓치지 않도록 표시합니다.",
    });
    expect(value.results).toHaveLength(1);
  });

  it("renders PersonaSelector from the gateway persona registry with transparent weights", () => {
    const cache = new ToolResultCache();
    cache.put("listPersonas", "personas", {
      personas: [
        {
          id: "university_student",
          description: "재학생 조건과 연령 적합도를 우선합니다.",
          weights: { student: 3, age: 2, query: 1 },
        },
        {
          id: "general",
          description: "모든 조건을 동일하게 반영합니다.",
          weights: { student: 1, age: 1, query: 1 },
        },
      ],
    });
    const spec = {
      intentSummary: "관점 전환",
      cards: [
        {
          cardId: "persona-card",
          componentType: "PersonaSelector" as const,
          entityRef: { toolResult: "listPersonas" as const, entityId: "personas" as const },
          props: {},
          rationale: "추천 관점을 직접 선택할 수 있습니다.",
        },
      ],
      order: ["persona-card"],
    };

    const messages = expandComposition(spec, cache);
    const dataMsg = messages.find((m) => "updateDataModel" in m) as Record<string, unknown>;
    const value = (dataMsg.updateDataModel as { value: Record<string, unknown> }).value;

    expect(value).toMatchObject({
      personas: [
        expect.objectContaining({
          id: "university_student",
          description: "재학생 조건과 연령 적합도를 우선합니다.",
          weights: { student: 3, age: 2, query: 1 },
        }),
        expect.objectContaining({ id: "general" }),
      ],
      rationale: "추천 관점을 직접 선택할 수 있습니다.",
    });
  });

  it("renders SourceNotice solely from retrieved detail provenance and freshness fields", () => {
    const cache = new ToolResultCache();
    cache.put("getBenefitDetail", summary.id, detailResponse());
    const spec = {
      intentSummary: "출처 확인",
      cards: [
        {
          cardId: "source-card",
          componentType: "SourceNotice" as const,
          entityRef: { toolResult: "getBenefitDetail" as const, entityId: summary.id },
          props: {},
          rationale: "최종 판단 전에 공식 정보를 확인하도록 안내합니다.",
        },
      ],
      order: ["source-card"],
    };

    const messages = expandComposition(spec, cache);
    const dataMsg = messages.find((m) => "updateDataModel" in m) as Record<string, unknown>;
    const value = (dataMsg.updateDataModel as { value: Record<string, unknown> }).value;

    expect(value).toMatchObject({
      benefitId: summary.id,
      benefitTitle: summary.title,
      provider: summary.provider,
      sourceUrl: "https://www.gov.kr/official-benefit",
      applicationUrl: "https://apply.example.go.kr/benefit",
      observedAt: "2026-07-09T12:00:00.000Z",
      rationale: "최종 판단 전에 공식 정보를 확인하도록 안내합니다.",
    });
    expect(value.sourceText).toContain("공식 출처");
    expect(value.sourceHealthText).toContain("fixture-benefits:ok");
    expect(value.safetyNotice).toMatch(/공식 주소|직접/);
  });
});
