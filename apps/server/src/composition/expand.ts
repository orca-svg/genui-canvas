import {
  BASIC_CATALOG_ID,
  CHECKLIST_MAX_ITEMS,
  RecommendationPersonaSchema,
  type A2uiBasicComponent,
  type CanvasAction,
  type CardSpec,
  type CompositionSpec,
} from "@genui-canvas/contracts";
import type { ToolResultCache } from "./tool-cache.js";

export interface A2uiMessage {
  version: "v0.9";
  [key: string]: unknown;
}

/** Trace-derived state the deterministic expander needs beyond the tool cache. */
export interface ExpandContext {
  /** entityId → sorted checklist rows the user ticked (server trace summary). */
  checkedItemsByEntity: Record<string, readonly number[]>;
  /** Persona whose selector button renders as the current choice. */
  activePersonaId?: string;
}

export const EMPTY_EXPAND_CONTEXT: ExpandContext = { checkedItemsByEntity: {} };

type Component = A2uiBasicComponent;

interface CardBody {
  components: Component[];
  value: Record<string, unknown>;
}

/** Dynamic rows per card; fixed heading/divider/caveat children fit under the 100-child limit. */
const MAX_DYNAMIC_ROWS = CHECKLIST_MAX_ITEMS;
/** Persona rows use two children each (button + description). */
const MAX_PERSONA_ROWS = 40;

/**
 * Deterministically expand a validated CompositionSpec into A2UI v0.9 messages,
 * pulling real data from the tool cache. Each semantic card becomes a Card →
 * Column subtree of layout, text, and the two interactive primitives. The
 * provider chose *what*; this function decides *how*, reproducibly.
 */
export function expandComposition(
  spec: CompositionSpec,
  cache: ToolResultCache,
  context: ExpandContext = EMPTY_EXPAND_CONTEXT,
): A2uiMessage[] {
  const byId = new Map(spec.cards.map((card) => [card.cardId, card]));
  const messages: A2uiMessage[] = [];

  for (const cardId of spec.order) {
    const card = byId.get(cardId);
    if (!card) continue;
    const data = cache.get(card.entityRef);
    if (data === undefined) continue;
    messages.push(...expandCard(card, data, cache, context));
  }

  return messages;
}

function expandCard(
  card: CardSpec,
  data: unknown,
  cache: ToolResultCache,
  context: ExpandContext,
): A2uiMessage[] {
  const { components, value } = buildCardBody(card, data, cache, context);
  return [
    { version: "v0.9", createSurface: { surfaceId: card.cardId, catalogId: BASIC_CATALOG_ID } },
    { version: "v0.9", updateComponents: { surfaceId: card.cardId, components } },
    { version: "v0.9", updateDataModel: { surfaceId: card.cardId, path: "/", value } },
  ];
}

function buildCardBody(
  card: CardSpec,
  data: unknown,
  cache: ToolResultCache,
  context: ExpandContext,
): CardBody {
  switch (card.componentType) {
    case "BenefitCard":
      return benefitCardBody(card, data, cache);
    case "ScoreBreakdown":
      return scoreBreakdownBody(card, data);
    case "Checklist":
      return checklistBody(card, data, context);
    case "DeadlineList":
      return deadlineListBody(card, data);
    case "PersonaSelector":
      return personaSelectorBody(card, data, context);
    case "SourceNotice":
      return sourceNoticeBody(card, data);
    default:
      return assertNever(card);
  }
}

// --- primitive builders -----------------------------------------------------

type TextVariant = "h1" | "h2" | "h3" | "h4" | "h5" | "caption" | "body";

function text(id: string, path: string, variant?: TextVariant): Component {
  return { id, component: "Text", text: { path }, ...(variant ? { variant } : {}) };
}
function column(id: string, children: string[]): Component {
  return { id, component: "Column", children };
}
function row(id: string, children: string[]): Component {
  return { id, component: "Row", children, align: "center" };
}
function divider(id: string): Component {
  return { id, component: "Divider" };
}
function checkbox(id: string, labelPath: string, valuePath: string): Component {
  return { id, component: "CheckBox", label: { path: labelPath }, value: { path: valuePath } };
}
function button(
  id: string,
  child: string,
  action: CanvasAction,
  variant: "default" | "primary" = "default",
): Component {
  return { id, component: "Button", child, variant, action: { event: action } };
}
/** Every surface is a Card whose single child is the body Column. */
function shell(children: string[], rest: Component[]): Component[] {
  return [{ id: "root", component: "Card", child: "body" }, column("body", children), ...rest];
}

// --- card bodies ------------------------------------------------------------

function benefitCardBody(
  card: Extract<CardSpec, { componentType: "BenefitCard" }>,
  data: unknown,
  cache: ToolResultCache,
): CardBody {
  const benefit = asRecord(data);
  const detailResponse = asRecord(
    cache.get({ toolResult: "getBenefitDetail", entityId: card.entityRef.entityId }),
  );
  const detail = asRecord(detailResponse.result);
  const assessment = asRecord(benefit.assessment);
  const ranking = asRecord(benefit.ranking);
  const score = typeof ranking.score === "number" ? ranking.score : 0;
  const showScore = card.props.showScore !== false;
  const showReasons = card.props.showReasons !== false;
  const reasons = Array.isArray(assessment.constraints)
    ? assessment.constraints
        .filter(isRecord)
        .flatMap((constraint) => stringValue(constraint.explanation) ?? [])
        .slice(0, MAX_DYNAMIC_ROWS)
    : [];
  const missingInfo = stringArray(assessment.missingInfo).slice(0, MAX_DYNAMIC_ROWS);
  const scoreBreakdown = Array.isArray(ranking.breakdown)
    ? ranking.breakdown.slice(0, MAX_DYNAMIC_ROWS)
    : [];
  const sourceLink = preferredOfficialLink(detail.links, "source");
  const sourceUrl = sourceLink?.url;

  const value: Record<string, unknown> = {
    title: String(benefit.title ?? ""),
    provider: String(benefit.provider ?? ""),
    summary: String(benefit.summary ?? ""),
    status: String(assessment.status ?? "candidate"),
    statusLabel: recommendationStatusLabel(assessment.status),
    scoreLabel: relativeScoreLabel(score),
    scoreValueText: scoreText(score).value,
    scoreCaveatText: scoreText(score).caveat,
    reasons,
    reasonsText: reasons.length > 0 ? `추천 근거: ${reasons.join(" · ")}` : "추천 근거: 제공되지 않음",
    missingInfo,
    missingInfoText:
      missingInfo.length > 0 ? `확인 필요: ${missingInfo.join(" · ")}` : "추가로 확인할 정보가 없습니다.",
    scoreBreakdown,
    scoreBreakdownText: scoreBreakdownLabel(scoreBreakdown),
    rationale: card.rationale,
    rationaleText: `구성 이유: ${card.rationale}`,
    candidateCaveat:
      "이 추천은 자격 판정이 아닌 후보 안내입니다. 출처 링크가 해당 기관 공식 주소인지 확인한 뒤 최신 요건을 확인하세요.",
  };
  if (sourceUrl) {
    value.sourceUrl = sourceUrl;
    value.sourceText = `공식 출처 · 상태 ${sourceLink?.health ?? "unknown"}: ${sourceUrl}`;
  }

  const children = [
    "title",
    "provider",
    "status",
    "summary",
    "divider-1",
    ...(showScore ? ["scoreRow", "scoreBreakdown"] : []),
    ...(showReasons ? ["reasons"] : []),
    "missingInfo",
    "divider-2",
    "rationale",
    "candidateCaveat",
    ...(sourceUrl ? ["source"] : []),
  ];
  const components: Component[] = [
    text("title", "/title", "h3"),
    text("provider", "/provider", "caption"),
    text("status", "/statusLabel", "body"),
    text("summary", "/summary", "body"),
    divider("divider-1"),
    text("reasons", "/reasonsText", "body"),
    text("missingInfo", "/missingInfoText", "body"),
    divider("divider-2"),
    text("rationale", "/rationaleText", "caption"),
    text("candidateCaveat", "/candidateCaveat", "caption"),
  ];
  if (showScore) {
    components.push(
      row("scoreRow", ["scoreValue", "scoreCaveat"]),
      text("scoreValue", "/scoreValueText", "h4"),
      text("scoreCaveat", "/scoreCaveatText", "caption"),
      text("scoreBreakdown", "/scoreBreakdownText", "caption"),
    );
  }
  if (sourceUrl) components.push(text("source", "/sourceText", "caption"));

  return { components: shell(children, components), value };
}

function scoreBreakdownBody(
  card: Extract<CardSpec, { componentType: "ScoreBreakdown" }>,
  data: unknown,
): CardBody {
  const benefit = asRecord(data);
  const ranking = asRecord(benefit.ranking);
  const score = typeof ranking.score === "number" ? ranking.score : 0;
  const rawItems = Array.isArray(ranking.breakdown) ? ranking.breakdown.filter(isRecord) : [];
  const maxItems =
    typeof card.props.maxItems === "number"
      ? Math.min(MAX_DYNAMIC_ROWS, Math.max(1, Math.floor(card.props.maxItems)))
      : MAX_DYNAMIC_ROWS;
  const items = rawItems.slice(0, maxItems);

  const value: Record<string, unknown> = {
    heading: "상대 관련도 구성",
    benefitTitle: String(benefit.title ?? ""),
    score,
    scoreLabel: relativeScoreLabel(score),
    scoreText: relativeScoreLabel(score),
    scoreValueText: scoreText(score).value,
    scoreCaveatText: scoreText(score).caveat,
    items,
    rationale: card.rationale,
    rationaleText: `표시 이유: ${card.rationale}`,
  };
  const itemIds = items.map((item, index) => {
    value[`item${index}Text`] = scoreDimensionText(item);
    return `item-${index}`;
  });

  return {
    value,
    components: shell(
      ["heading", "benefitTitle", "scoreRow", "divider-1", ...itemIds, "rationale"],
      [
        text("heading", "/heading", "h3"),
        text("benefitTitle", "/benefitTitle", "h4"),
        row("scoreRow", ["scoreValue", "scoreCaveat"]),
        text("scoreValue", "/scoreValueText", "h4"),
        text("scoreCaveat", "/scoreCaveatText", "caption"),
        divider("divider-1"),
        ...itemIds.map((id, index) => text(id, `/item${index}Text`, "body")),
        text("rationale", "/rationaleText", "caption"),
      ],
    ),
  };
}

function checklistBody(
  card: Extract<CardSpec, { componentType: "Checklist" }>,
  data: unknown,
  context: ExpandContext,
): CardBody {
  const checklist = asRecord(data);
  const items = Array.isArray(checklist.items)
    ? checklist.items.filter(isRecord).slice(0, MAX_DYNAMIC_ROWS)
    : [];
  const caveats = stringArray(checklist.caveats).slice(0, MAX_DYNAMIC_ROWS);
  const compact = card.props.compact === true;
  const checked = new Set(context.checkedItemsByEntity[card.entityRef.entityId] ?? []);
  const requiredCount = items.filter((item) => item.required === true).length;
  const checkedCount = items.filter((_, index) => checked.has(index)).length;
  const value: Record<string, unknown> = {
    heading: "신청 준비 체크리스트",
    benefitId: String(checklist.benefitId ?? card.entityRef.entityId),
    items,
    requiredCount,
    checkedCount,
    progressText: `필수 ${requiredCount}개 · 전체 ${items.length}개 · 체크 ${checkedCount}개`,
    caveats,
    caveatText:
      caveats.length > 0 ? `확인 사항: ${caveats.join(" · ")}` : "체크리스트는 공식 공고와 대조해 확인하세요.",
    memoNotice: "체크는 이 기기에서의 준비 메모이며 신청 상태가 아닙니다.",
    rationale: card.rationale,
    rationaleText: `표시 이유: ${card.rationale}`,
  };
  const rowIds = items.map((item, index) => {
    value[`item${index}Text`] = checklistItemText(item, compact);
    value[`checked${index}`] = checked.has(index);
    return `check-${index}`;
  });

  return {
    value,
    components: shell(
      ["heading", "progress", "divider-1", ...rowIds, "divider-2", "caveat", "memoNotice", "rationale"],
      [
        text("heading", "/heading", "h3"),
        text("progress", "/progressText", "caption"),
        divider("divider-1"),
        ...rowIds.map((id, index) => checkbox(id, `/item${index}Text`, `/checked${index}`)),
        divider("divider-2"),
        text("caveat", "/caveatText", "caption"),
        text("memoNotice", "/memoNotice", "caption"),
        text("rationale", "/rationaleText", "caption"),
      ],
    ),
  };
}

function deadlineListBody(
  card: Extract<CardSpec, { componentType: "DeadlineList" }>,
  data: unknown,
): CardBody {
  const response = asRecord(data);
  const allResults = Array.isArray(response.results) ? response.results.filter(isRecord) : [];
  const responseWindow = typeof response.withinDays === "number" ? response.withinDays : undefined;
  const requestedWindow =
    typeof card.props.withinDays === "number" ? card.props.withinDays : undefined;
  const withinDays = requestedWindow ?? responseWindow;
  const generatedAt = typeof response.generatedAt === "string" ? response.generatedAt : "";
  const results = filterDeadlineResults(allResults, requestedWindow, generatedAt).slice(
    0,
    MAX_DYNAMIC_ROWS,
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
  const rowIds = results.map((result, index) => {
    value[`deadline${index}Text`] = deadlineResultText(result);
    return `deadline-${index}`;
  });

  return {
    value,
    components: shell(
      ["heading", "count", "divider-1", ...rowIds, "candidateCaveat", "rationale"],
      [
        text("heading", "/heading", "h3"),
        text("count", "/countText", "caption"),
        divider("divider-1"),
        ...rowIds.map((id, index) => text(id, `/deadline${index}Text`, "body")),
        text("candidateCaveat", "/candidateCaveat", "caption"),
        text("rationale", "/rationaleText", "caption"),
      ],
    ),
  };
}

function personaSelectorBody(
  card: Extract<CardSpec, { componentType: "PersonaSelector" }>,
  data: unknown,
  context: ExpandContext,
): CardBody {
  const response = asRecord(data);
  const personas = (Array.isArray(response.personas) ? response.personas.filter(isRecord) : [])
    .flatMap((persona) => {
      const parsed = RecommendationPersonaSchema.safeParse(persona.id);
      return parsed.success ? [{ persona, personaId: parsed.data }] : [];
    })
    .slice(0, MAX_PERSONA_ROWS);
  const value: Record<string, unknown> = {
    heading: "추천 관점 선택",
    activePersonaId: context.activePersonaId ?? "",
    personas: personas.map(({ persona }) => persona),
    rationale: card.rationale,
    rationaleText: `표시 이유: ${card.rationale}`,
    caveat: "관점 전환은 추천 점수의 우선순위만 바꾸며, 실제 신청 자격을 결정하지 않습니다.",
  };
  const rowIds: string[] = [];
  const components: Component[] = [];
  personas.forEach(({ persona, personaId }, index) => {
    const active = personaId === context.activePersonaId;
    value[`persona${index}Label`] = `${personaLabel(personaId)}${active ? " · 현재 관점" : ""}`;
    value[`persona${index}Text`] = personaText(persona);
    rowIds.push(`persona-${index}`, `persona-${index}-desc`);
    components.push(
      button(
        `persona-${index}`,
        `persona-${index}-label`,
        { name: "persona.select", context: { personaId } },
        active ? "primary" : "default",
      ),
      text(`persona-${index}-label`, `/persona${index}Label`, "body"),
      text(`persona-${index}-desc`, `/persona${index}Text`, "caption"),
    );
  });

  return {
    value,
    components: shell(
      ["heading", "caveat", "divider-1", ...rowIds, "divider-2", "rationale"],
      [
        text("heading", "/heading", "h3"),
        text("caveat", "/caveat", "caption"),
        divider("divider-1"),
        ...components,
        divider("divider-2"),
        text("rationale", "/rationaleText", "caption"),
      ],
    ),
  };
}

function sourceNoticeBody(
  card: Extract<CardSpec, { componentType: "SourceNotice" }>,
  data: unknown,
): CardBody {
  const detailResponse = asRecord(data);
  const detail = asRecord(detailResponse.result);
  const sourceLink = preferredOfficialLink(detail.links, "source");
  const applicationLink = preferredOfficialLink(detail.links, "apply");
  const sourceUrl = sourceLink?.url ?? "";
  const applicationUrl = applicationLink?.url;
  const freshness = asRecord(detail.freshness);
  const observedAt = stringValue(freshness.observedAt) ?? "";
  const dataStatus = asRecord(detailResponse.dataStatus);
  const sourceObservations = Array.isArray(dataStatus.sources)
    ? dataStatus.sources.filter(isRecord).slice(0, MAX_DYNAMIC_ROWS)
    : [];
  const value: Record<string, unknown> = {
    heading: "출처와 최신성",
    benefitId: String(detail.id ?? card.entityRef.entityId),
    benefitTitle: String(detail.title ?? ""),
    provider: String(detail.provider ?? ""),
    sourceUrl,
    sourceText: sourceLink
      ? `공식 출처 · 상태 ${sourceLink.health}: ${sourceUrl}`
      : "구조화된 공식 출처 링크를 확인할 수 없습니다.",
    observedAt,
    freshnessText: observedAt
      ? `데이터 최신성 ${String(freshness.status ?? "unknown")} · 관측 ${observedAt}`
      : "최신성 관측 시각 정보 없음",
    sourceHealthText: sourceObservationText(dataStatus, sourceObservations),
    rationale: card.rationale,
    rationaleText: `표시 이유: ${card.rationale}`,
    safetyNotice:
      "추천은 후보 안내입니다. 링크가 해당 기관 공식 주소인지 확인한 뒤 최신 자격과 마감을 직접 확인하고, 로그인·본인인증·제출은 사용자가 수행하세요.",
  };
  if (applicationUrl) {
    value.applicationUrl = applicationUrl;
    value.applicationText = `공식 신청 경로 · 상태 ${applicationLink?.health ?? "unknown"}: ${applicationUrl}`;
  }

  return {
    value,
    components: shell(
      [
        "heading",
        "benefitTitle",
        "provider",
        "divider-1",
        "source",
        ...(applicationUrl ? ["application"] : []),
        "sourceHealth",
        "freshness",
        "divider-2",
        "safetyNotice",
        "rationale",
      ],
      [
        text("heading", "/heading", "h3"),
        text("benefitTitle", "/benefitTitle", "h4"),
        text("provider", "/provider", "caption"),
        divider("divider-1"),
        text("source", "/sourceText", "body"),
        ...(applicationUrl ? [text("application", "/applicationText", "body")] : []),
        text("sourceHealth", "/sourceHealthText", "caption"),
        text("freshness", "/freshnessText", "caption"),
        divider("divider-2"),
        text("safetyNotice", "/safetyNotice", "caption"),
        text("rationale", "/rationaleText", "caption"),
      ],
    ),
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

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
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
  return `[${required}] ${label}${source}`;
}

function deadlineResultText(result: Record<string, unknown>): string {
  const deadline = typeof result.applicationDeadline === "string"
    ? result.applicationDeadline.slice(0, 10)
    : "날짜 미정";
  const title = typeof result.title === "string" ? result.title : "이름 없는 혜택";
  const provider = typeof result.provider === "string" ? ` · ${result.provider}` : "";
  const assessment = asRecord(result.assessment);
  const status = ` · ${recommendationStatusLabel(assessment.status)}`;
  const missing = stringArray(assessment.missingInfo);
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
    case "conflict_detected":
      return "구조화된 공식 조건과 충돌 감지 · 공식 요건 확인 필요";
    default:
      return "검토할 혜택 후보";
  }
}

/** The score caption pair shared by BenefitCard and ScoreBreakdown — kept as one
 *  source so the trust-copy wording ("relative relevance, never an eligibility
 *  probability") can't drift between the two call sites. */
function scoreText(score: number): { value: string; caveat: string } {
  return { value: `상대 관련도 ${Math.round(score * 100)}/100`, caveat: "자격 확률 아님" };
}

function relativeScoreLabel(score: number): string {
  const { value, caveat } = scoreText(score);
  return `${value} · ${caveat}`;
}

function preferredOfficialLink(
  value: unknown,
  relation: "source" | "apply",
): { url: string; health: string } | undefined {
  if (!Array.isArray(value)) return undefined;
  for (const candidate of value) {
    const link = asRecord(candidate);
    if (link.official !== true || link.rel !== relation || typeof link.url !== "string") {
      continue;
    }
    try {
      if (new URL(link.url).protocol !== "https:") continue;
      return {
        url: link.url,
        health: stringValue(link.health) ?? "unknown",
      };
    } catch {
      // Defensive only; published schemas already reject malformed URLs.
    }
  }
  return undefined;
}

function sourceObservationText(
  dataStatus: Record<string, unknown>,
  sources: Record<string, unknown>[],
): string {
  const mode = stringValue(dataStatus.mode) ?? "unknown";
  const coverage = dataStatus.partial === true ? "일부 출처 응답" : "구성 출처 응답";
  const summary = sources
    .map((source) => `${String(source.sourceId ?? "unknown")}:${String(source.status ?? "unknown")}`)
    .join(", ");
  return `데이터 모드 ${mode} · ${coverage}${summary ? ` · ${summary}` : ""}`;
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
