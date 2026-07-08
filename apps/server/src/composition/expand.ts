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
    const data = card.entityRef ? cache.get(card.entityRef) : undefined;
    // A referenced-but-uncached entity was already rejected by validate; guard
    // here too so expand never emits a surface with no data to bind.
    if (card.entityRef && data === undefined) continue;
    messages.push(...expandCard(card, data));
  }

  return messages;
}

function expandCard(card: CardSpec, data: unknown): A2uiMessage[] {
  const { components, value } = buildCardBody(card, data);
  return [
    { version: "v0.9", createSurface: { surfaceId: card.cardId, catalogId: BASIC_CATALOG_ID } },
    { version: "v0.9", updateComponents: { surfaceId: card.cardId, components } },
    { version: "v0.9", updateDataModel: { surfaceId: card.cardId, path: "/", value } },
  ];
}

function buildCardBody(card: CardSpec, data: unknown): CardBody {
  switch (card.componentType) {
    case "BenefitCard":
      return benefitCardBody(card, data);
    default:
      return genericBody(card, data);
  }
}

function benefitCardBody(card: CardSpec, data: unknown): CardBody {
  const benefit = (data ?? {}) as Record<string, unknown>;
  const score = typeof benefit.score === "number" ? benefit.score : 0;
  const showScore = card.props.showScore !== false;

  const value: Record<string, unknown> = {
    title: String(benefit.title ?? ""),
    provider: String(benefit.provider ?? ""),
    summary: String(benefit.summary ?? ""),
    scoreLabel: `${Math.round(score * 100)}%`,
  };

  const childIds = ["title", "provider", "summary", ...(showScore ? ["score"] : [])];
  const components: Array<Record<string, unknown>> = [
    { id: "root", component: "Column", children: childIds },
    { id: "title", component: "Text", text: { path: "/title" } },
    { id: "provider", component: "Text", text: { path: "/provider" } },
    { id: "summary", component: "Text", text: { path: "/summary" } },
  ];
  if (showScore) {
    components.push({ id: "score", component: "Text", text: { path: "/scoreLabel" } });
  }

  return { components, value };
}

function genericBody(card: CardSpec, data: unknown): CardBody {
  const record = (data ?? {}) as Record<string, unknown>;
  const value: Record<string, unknown> = {
    title: String(record.title ?? card.componentType),
    summary: String(record.summary ?? ""),
  };
  const components: Array<Record<string, unknown>> = [
    { id: "root", component: "Column", children: ["title", "summary"] },
    { id: "title", component: "Text", text: { path: "/title" } },
    { id: "summary", component: "Text", text: { path: "/summary" } },
  ];
  return { components, value };
}
