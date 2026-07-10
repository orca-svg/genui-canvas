import { BASIC_CATALOG_ID, type CardSpec, type CompositionSpec } from "@genui-canvas/contracts";
import type { ToolResultCache } from "./tool-cache.js";

export interface A2uiMessage {
  version: "v0.9";
  [key: string]: unknown;
}

interface CardBody {
  components: Array<Record<string, unknown>>;
  value: Record<string, unknown>;
}

// Leaves room for each card's fixed heading/caveat/rationale children under
// the wire contract's 100-child limit.
const MAX_DYNAMIC_TEXT_ITEMS = 96;

/**
 * Deterministically expand a validated CompositionSpec into A2UI v0.9 messages,
 * pulling real data from the tool cache. Approach A: each semantic card becomes
 * a subtree of primitive components (Column/Text). The LLM chose *what*; this
 * function decides *how*, reproducibly (same input → identical output).
 */
export function expandComposition(spec: CompositionSpec, cache: ToolResultCache): A2uiMessage[] {
  const byId = new Map(spec.cards.map((card) => [card.cardId, card]));
  const messages: A2uiMessage[] = [];

  for (const cardId of spec.order) {
    const card = byId.get(cardId);
    if (!card) continue;
    const data = cache.get(card.entityRef);
    // A referenced-but-uncached entity was already rejected by validate; guard
    // here too so expand never emits a surface with no data to bind.
    if (data === undefined) continue;
    messages.push(...expandCard(card, data, cache));
  }

  return messages;
}

function expandCard(card: CardSpec, data: unknown, cache: ToolResultCache): A2uiMessage[] {
  const { components, value } = buildCardBody(card, data, cache);
  return [
    { version: "v0.9", createSurface: { surfaceId: card.cardId, catalogId: BASIC_CATALOG_ID } },
    { version: "v0.9", updateComponents: { surfaceId: card.cardId, components } },
    { version: "v0.9", updateDataModel: { surfaceId: card.cardId, path: "/", value } },
  ];
}

function buildCardBody(card: CardSpec, data: unknown, cache: ToolResultCache): CardBody {
  switch (card.componentType) {
    case "BenefitCard":
      return benefitCardBody(card, data, cache);
    case "ScoreBreakdown":
      return scoreBreakdownBody(card, data);
    case "Checklist":
      return checklistBody(card, data);
    case "DeadlineList":
      return deadlineListBody(card, data);
    case "PersonaSelector":
      return personaSelectorBody(card, data);
    case "SourceNotice":
      return sourceNoticeBody(card, data);
    default:
      return assertNever(card);
  }
}

function sourceNoticeBody(
  card: Extract<CardSpec, { componentType: "SourceNotice" }>,
  data: unknown,
): CardBody {
  const detail = asRecord(data);
  const sourceUrl = safeHttpsUrl(detail.sourceUrl) ?? "";
  const applicationUrl = safeHttpsUrl(detail.applicationUrl);
  const lastFetchedAt = typeof detail.lastFetchedAt === "string" ? detail.lastFetchedAt : "";
  const value: Record<string, unknown> = {
    heading: "출처와 최신성",
    benefitId: String(detail.id ?? card.entityRef.entityId),
    benefitTitle: String(detail.title ?? ""),
    provider: String(detail.provider ?? ""),
    sourceUrl,
    sourceText: sourceUrl
      ? `게이트웨이 출처(공식 여부 확인 필요): ${sourceUrl}`
      : "게이트웨이 출처 주소를 확인할 수 없습니다.",
    lastFetchedAt,
    freshnessText: lastFetchedAt ? `게이트웨이 확인 시각: ${lastFetchedAt}` : "확인 시각 정보 없음",
    rationale: card.rationale,
    rationaleText: `표시 이유: ${card.rationale}`,
    safetyNotice:
      "추천은 후보 안내입니다. 링크가 해당 기관 공식 주소인지 확인한 뒤 최신 자격과 마감을 직접 확인하고, 로그인·본인인증·제출은 사용자가 수행하세요.",
  };
  if (applicationUrl) {
    value.applicationUrl = applicationUrl;
    value.applicationText = `게이트웨이 제공 신청 경로(공식 여부 확인 필요): ${applicationUrl}`;
  }

  return {
    value,
    components: [
      {
        id: "root",
        component: "Column",
        children: [
          "heading",
          "benefitTitle",
          "provider",
          "source",
          ...(applicationUrl ? ["application"] : []),
          "freshness",
          "safetyNotice",
          "rationale",
        ],
      },
      { id: "heading", component: "Text", text: { path: "/heading" } },
      { id: "benefitTitle", component: "Text", text: { path: "/benefitTitle" } },
      { id: "provider", component: "Text", text: { path: "/provider" } },
      { id: "source", component: "Text", text: { path: "/sourceText" } },
      ...(applicationUrl
        ? [{ id: "application", component: "Text", text: { path: "/applicationText" } }]
        : []),
      { id: "freshness", component: "Text", text: { path: "/freshnessText" } },
      { id: "safetyNotice", component: "Text", text: { path: "/safetyNotice" } },
      { id: "rationale", component: "Text", text: { path: "/rationaleText" } },
    ],
  };
}

function personaSelectorBody(
  card: Extract<CardSpec, { componentType: "PersonaSelector" }>,
  data: unknown,
): CardBody {
  const response = asRecord(data);
  const personas = Array.isArray(response.personas)
    ? response.personas.filter(isRecord).slice(0, MAX_DYNAMIC_TEXT_ITEMS)
    : [];
  const value: Record<string, unknown> = {
    heading: "추천 관점 선택",
    personas,
    rationale: card.rationale,
    rationaleText: `표시 이유: ${card.rationale}`,
    caveat:
      "관점 전환은 추천 점수의 우선순위만 바꾸며, 실제 신청 자격을 결정하지 않습니다.",
  };
  const personaIds = personas.map((persona, index) => {
    value[`persona${index}Text`] = personaText(persona);
    return `persona-${index}`;
  });

  return {
    value,
    components: [
      {
        id: "root",
        component: "Column",
        children: ["heading", ...personaIds, "caveat", "rationale"],
      },
      { id: "heading", component: "Text", text: { path: "/heading" } },
      ...personaIds.map((id, index) => ({
        id,
        component: "Text",
        text: { path: `/persona${index}Text` },
      })),
      { id: "caveat", component: "Text", text: { path: "/caveat" } },
      { id: "rationale", component: "Text", text: { path: "/rationaleText" } },
    ],
  };
}

function deadlineListBody(
  card: Extract<CardSpec, { componentType: "DeadlineList" }>,
  data: unknown,
): CardBody {
  const response = asRecord(data);
  const allResults = Array.isArray(response.results) ? response.results.filter(isRecord) : [];
  const responseWindow = typeof response.withinDays === "number" ? response.withinDays : undefined;
  const requestedWindow = typeof card.props.withinDays === "number" ? card.props.withinDays : undefined;
  const withinDays = requestedWindow ?? responseWindow;
  const generatedAt = typeof response.generatedAt === "string" ? response.generatedAt : "";
  const results = filterDeadlineResults(allResults, requestedWindow, generatedAt).slice(
    0,
    MAX_DYNAMIC_TEXT_ITEMS,
  );
  const value: Record<string, unknown> = {
    heading: withinDays === undefined ? "다가오는 신청 마감" : `향후 ${withinDays}일 신청 마감`,
    withinDays,
    generatedAt,
    results,
    resultCount: results.length,
    countText: `${results.length}개 후보`,
    rationale: card.rationale,
    rationaleText: `표시 이유: ${card.rationale}`,
    candidateCaveat:
      "마감 일정과 자격 요건은 변경될 수 있습니다. 신청 전 공식 공고에서 다시 확인하세요.",
  };
  const resultIds = results.map((result, index) => {
    value[`deadline${index}Text`] = deadlineResultText(result);
    return `deadline-${index}`;
  });

  return {
    value,
    components: [
      {
        id: "root",
        component: "Column",
        children: ["heading", "count", ...resultIds, "candidateCaveat", "rationale"],
      },
      { id: "heading", component: "Text", text: { path: "/heading" } },
      { id: "count", component: "Text", text: { path: "/countText" } },
      ...resultIds.map((id, index) => ({
        id,
        component: "Text",
        text: { path: `/deadline${index}Text` },
      })),
      { id: "candidateCaveat", component: "Text", text: { path: "/candidateCaveat" } },
      { id: "rationale", component: "Text", text: { path: "/rationaleText" } },
    ],
  };
}

function filterDeadlineResults(
  results: Record<string, unknown>[],
  withinDays: number | undefined,
  generatedAt: string,
): Record<string, unknown>[] {
  if (withinDays === undefined) return results;
  const start = Date.parse(generatedAt);
  if (!Number.isFinite(start)) return results;
  const end = start + withinDays * 24 * 60 * 60 * 1000;
  return results.filter((result) => {
    if (typeof result.applicationDeadline !== "string") return false;
    const deadline = Date.parse(result.applicationDeadline);
    return Number.isFinite(deadline) && deadline >= start && deadline <= end;
  });
}

function checklistBody(
  card: Extract<CardSpec, { componentType: "Checklist" }>,
  data: unknown,
): CardBody {
  const checklist = asRecord(data);
  const items = Array.isArray(checklist.items)
    ? checklist.items.filter(isRecord).slice(0, MAX_DYNAMIC_TEXT_ITEMS)
    : [];
  const caveats = stringArray(checklist.caveats).slice(0, MAX_DYNAMIC_TEXT_ITEMS);
  const compact = card.props.compact === true;
  const requiredCount = items.filter((item) => item.required === true).length;
  const value: Record<string, unknown> = {
    heading: "신청 준비 체크리스트",
    benefitId: String(checklist.benefitId ?? card.entityRef.entityId),
    items,
    requiredCount,
    progressText: `필수 ${requiredCount}개 · 전체 ${items.length}개`,
    caveats,
    caveatText:
      caveats.length > 0
        ? `확인 사항: ${caveats.join(" · ")}`
        : "체크리스트는 공식 공고와 대조해 확인하세요.",
    rationale: card.rationale,
    rationaleText: `표시 이유: ${card.rationale}`,
  };
  const itemIds = items.map((item, index) => {
    value[`item${index}Text`] = checklistItemText(item, compact);
    return `item-${index}`;
  });

  return {
    value,
    components: [
      {
        id: "root",
        component: "Column",
        children: ["heading", "progress", ...itemIds, "caveat", "rationale"],
      },
      { id: "heading", component: "Text", text: { path: "/heading" } },
      { id: "progress", component: "Text", text: { path: "/progressText" } },
      ...itemIds.map((id, index) => ({
        id,
        component: "Text",
        text: { path: `/item${index}Text` },
      })),
      { id: "caveat", component: "Text", text: { path: "/caveatText" } },
      { id: "rationale", component: "Text", text: { path: "/rationaleText" } },
    ],
  };
}

function scoreBreakdownBody(
  card: Extract<CardSpec, { componentType: "ScoreBreakdown" }>,
  data: unknown,
): CardBody {
  const benefit = asRecord(data);
  const score = typeof benefit.score === "number" ? benefit.score : 0;
  const rawItems = Array.isArray(benefit.scoreBreakdown)
    ? benefit.scoreBreakdown.filter(isRecord)
    : [];
  const maxItems =
    typeof card.props.maxItems === "number"
      ? Math.min(MAX_DYNAMIC_TEXT_ITEMS, Math.max(1, Math.floor(card.props.maxItems)))
      : MAX_DYNAMIC_TEXT_ITEMS;
  const items = rawItems.slice(0, maxItems);

  const value: Record<string, unknown> = {
    heading: "상대 관련도 구성",
    benefitTitle: String(benefit.title ?? ""),
    score,
    scoreLabel: relativeScoreLabel(score),
    scoreText: relativeScoreLabel(score),
    items,
    rationale: card.rationale,
    rationaleText: `표시 이유: ${card.rationale}`,
  };
  const itemIds = items.map((item, index) => {
    const key = `item${index}Text`;
    value[key] = scoreDimensionText(item);
    return `item-${index}`;
  });

  return {
    value,
    components: [
      {
        id: "root",
        component: "Column",
        children: ["heading", "benefitTitle", "score", ...itemIds, "rationale"],
      },
      { id: "heading", component: "Text", text: { path: "/heading" } },
      { id: "benefitTitle", component: "Text", text: { path: "/benefitTitle" } },
      { id: "score", component: "Text", text: { path: "/scoreText" } },
      ...itemIds.map((id, index) => ({
        id,
        component: "Text",
        text: { path: `/item${index}Text` },
      })),
      { id: "rationale", component: "Text", text: { path: "/rationaleText" } },
    ],
  };
}

function benefitCardBody(
  card: Extract<CardSpec, { componentType: "BenefitCard" }>,
  data: unknown,
  cache: ToolResultCache,
): CardBody {
  const benefit = (data ?? {}) as Record<string, unknown>;
  const detail = (cache.get({
    toolResult: "getBenefitDetail",
    entityId: card.entityRef.entityId,
  }) ?? {}) as Record<string, unknown>;
  const score = typeof benefit.score === "number" ? benefit.score : 0;
  const showScore = card.props.showScore !== false;
  const showReasons = card.props.showReasons !== false;
  const reasons = stringArray(benefit.reasons).slice(0, MAX_DYNAMIC_TEXT_ITEMS);
  const missingInfo = stringArray(benefit.missingInfo).slice(0, MAX_DYNAMIC_TEXT_ITEMS);
  const scoreBreakdown = Array.isArray(benefit.scoreBreakdown)
    ? benefit.scoreBreakdown.slice(0, MAX_DYNAMIC_TEXT_ITEMS)
    : [];
  const sourceUrl = safeHttpsUrl(detail.sourceUrl);

  const value: Record<string, unknown> = {
    title: String(benefit.title ?? ""),
    provider: String(benefit.provider ?? ""),
    summary: String(benefit.summary ?? ""),
    status: String(benefit.status ?? "candidate"),
    statusLabel: recommendationStatusLabel(benefit.status),
    scoreLabel: relativeScoreLabel(score),
    reasons,
    reasonsText: reasons.length > 0 ? `추천 근거: ${reasons.join(" · ")}` : "추천 근거: 제공되지 않음",
    missingInfo,
    missingInfoText:
      missingInfo.length > 0
        ? `확인 필요: ${missingInfo.join(" · ")}`
        : "추가로 확인할 정보가 없습니다.",
    scoreBreakdown,
    scoreBreakdownText: scoreBreakdownLabel(scoreBreakdown),
    rationale: card.rationale,
    rationaleText: `구성 이유: ${card.rationale}`,
    candidateCaveat:
      "이 추천은 자격 판정이 아닌 후보 안내입니다. 출처 링크가 해당 기관 공식 주소인지 확인한 뒤 최신 요건을 확인하세요.",
  };
  if (sourceUrl) {
    value.sourceUrl = sourceUrl;
    value.sourceText = `게이트웨이 출처(공식 여부 확인 필요): ${sourceUrl}`;
  }

  const childIds = [
    "title",
    "provider",
    "status",
    "summary",
    ...(showScore ? ["score", "scoreBreakdown"] : []),
    ...(showReasons ? ["reasons"] : []),
    "missingInfo",
    "rationale",
    "candidateCaveat",
    ...(sourceUrl ? ["source"] : []),
  ];
  const components: Array<Record<string, unknown>> = [
    { id: "root", component: "Column", children: childIds },
    { id: "title", component: "Text", text: { path: "/title" } },
    { id: "provider", component: "Text", text: { path: "/provider" } },
    { id: "status", component: "Text", text: { path: "/statusLabel" } },
    { id: "summary", component: "Text", text: { path: "/summary" } },
    { id: "reasons", component: "Text", text: { path: "/reasonsText" } },
    { id: "missingInfo", component: "Text", text: { path: "/missingInfoText" } },
    { id: "rationale", component: "Text", text: { path: "/rationaleText" } },
    { id: "candidateCaveat", component: "Text", text: { path: "/candidateCaveat" } },
  ];
  if (showScore) {
    components.push({ id: "score", component: "Text", text: { path: "/scoreLabel" } });
    components.push({
      id: "scoreBreakdown",
      component: "Text",
      text: { path: "/scoreBreakdownText" },
    });
  }
  if (sourceUrl) {
    components.push({ id: "source", component: "Text", text: { path: "/sourceText" } });
  }

  return { components, value };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function scoreDimensionText(item: Record<string, unknown>): string {
  const dimension = typeof item.dimension === "string" ? item.dimension : "unknown";
  const explanation = typeof item.explanation === "string" ? item.explanation : "설명 없음";
  const contribution = typeof item.contribution === "number" ? ` · 기여 ${item.contribution.toFixed(2)}` : "";
  return `${scoreDimensionLabel(dimension)}: ${explanation}${contribution}`;
}

function scoreDimensionLabel(dimension: string): string {
  const labels: Record<string, string> = {
    region: "지역",
    age: "연령",
    student: "재학 상태",
    employment: "고용 상태",
    household: "가구 유형",
    category: "관심 분야",
    query: "검색 의도",
  };
  return labels[dimension] ?? dimension;
}

function checklistItemText(item: Record<string, unknown>, compact: boolean): string {
  const label = typeof item.label === "string" ? item.label : "이름 없는 준비 항목";
  const required = item.required === true ? "필수" : "선택";
  const source = !compact && typeof item.source === "string" ? ` · 출처: ${item.source}` : "";
  return `☐ [${required}] ${label}${source}`;
}

function deadlineResultText(result: Record<string, unknown>): string {
  const deadline = typeof result.applicationDeadline === "string"
    ? result.applicationDeadline.slice(0, 10)
    : "날짜 미정";
  const title = typeof result.title === "string" ? result.title : "이름 없는 혜택";
  const provider = typeof result.provider === "string" ? ` · ${result.provider}` : "";
  const status = ` · ${recommendationStatusLabel(result.status)}`;
  const missing = stringArray(result.missingInfo);
  const missingText = missing.length > 0 ? ` · 확인 필요: ${missing.join(", ")}` : "";
  return `${deadline} · ${title}${provider}${status}${missingText}`;
}

function personaText(persona: Record<string, unknown>): string {
  const id = typeof persona.id === "string" ? persona.id : "unknown";
  const description = typeof persona.description === "string" ? persona.description : "설명 없음";
  const weights = asRecord(persona.weights);
  const priorities = Object.entries(weights)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number")
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([dimension, weight]) => `${scoreDimensionLabel(dimension)} ${weight}`)
    .join(", ");
  return `${personaLabel(id)} — ${description}${priorities ? ` · 주요 가중치: ${priorities}` : ""}`;
}

function personaLabel(id: string): string {
  const labels: Record<string, string> = {
    youth_jobseeker: "청년 구직자",
    university_student: "대학생",
    newlywed_family: "신혼 가구",
    single_parent: "한부모 가구",
    senior: "시니어",
    general: "일반",
  };
  return labels[id] ?? id;
}

function recommendationStatusLabel(status: unknown): string {
  switch (status) {
    case "needs_more_info":
      return "추가 정보 확인이 필요한 후보";
    case "not_applicable":
      return "구조화 조건과 충돌 가능성 · 공식 요건 확인 필요";
    default:
      return "검토할 혜택 후보";
  }
}

function relativeScoreLabel(score: number): string {
  return `상대 관련도 ${Math.round(score * 100)}/100 · 자격 확률 아님`;
}

function safeHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    return new URL(value).protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}

function scoreBreakdownLabel(items: unknown[]): string {
  const explanations = items.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    return typeof record.explanation === "string" ? [record.explanation] : [];
  });
  return explanations.length > 0
    ? `점수 근거: ${explanations.join(" · ")}`
    : "점수 근거가 제공되지 않았습니다.";
}

function assertNever(value: never): never {
  throw new Error(`unsupported catalog card: ${JSON.stringify(value)}`);
}
