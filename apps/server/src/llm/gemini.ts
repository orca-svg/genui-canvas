import { GoogleGenAI } from "@google/genai";
import { CATALOG_TOOL_RESULT_BY_COMPONENT } from "@genui-canvas/contracts";
import type { ComposeRequest, LlmProvider } from "./provider.js";
import { SYSTEM_PROMPT, buildComposePrompt } from "./prompts.js";

export interface GeminiProviderOptions {
  apiKey: string;
  model?: string;
}

/** Rolling Flash alias requested for BYOK composition. */
export const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";

// Structured-output schema: forces Gemini to emit a CompositionSpec-shaped JSON
// object (no prose, malformed JSON, or component/tool mismatches). Each variant
// exposes only that catalog component's scalar presentation props.
function cardResponseVariant(
  componentType: string,
  toolResult: string,
  props: Record<string, Record<string, unknown>>,
  fixedEntityId?: string,
) {
  return {
    type: "OBJECT",
    properties: {
      cardId: { type: "STRING" },
      componentType: { type: "STRING", enum: [componentType] },
      entityRef: {
        type: "OBJECT",
        properties: {
          toolResult: { type: "STRING", enum: [toolResult] },
          entityId: {
            type: "STRING",
            ...(fixedEntityId ? { enum: [fixedEntityId] } : {}),
          },
        },
        required: ["toolResult", "entityId"],
        propertyOrdering: ["toolResult", "entityId"],
      },
      props: { type: "OBJECT", properties: props },
      emphasis: { type: "STRING", enum: ["primary", "secondary"] },
      rationale: { type: "STRING" },
    },
    required: ["cardId", "componentType", "entityRef", "rationale"],
    propertyOrdering: ["cardId", "componentType", "entityRef", "props", "emphasis", "rationale"],
  } as const;
}

export const COMPOSITION_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    intentSummary: { type: "STRING" },
    cards: {
      type: "ARRAY",
      items: {
        anyOf: [
          cardResponseVariant("BenefitCard", CATALOG_TOOL_RESULT_BY_COMPONENT.BenefitCard, {
            showScore: { type: "BOOLEAN" },
            showReasons: { type: "BOOLEAN" },
          }),
          cardResponseVariant("ScoreBreakdown", CATALOG_TOOL_RESULT_BY_COMPONENT.ScoreBreakdown, {
            maxItems: { type: "INTEGER", minimum: 1, maximum: 96 },
          }),
          cardResponseVariant("Checklist", CATALOG_TOOL_RESULT_BY_COMPONENT.Checklist, {
            compact: { type: "BOOLEAN" },
          }),
          cardResponseVariant(
            "DeadlineList",
            CATALOG_TOOL_RESULT_BY_COMPONENT.DeadlineList,
            { withinDays: { type: "INTEGER", minimum: 1, maximum: 365 } },
            "upcoming-deadlines",
          ),
          cardResponseVariant(
            "PersonaSelector",
            CATALOG_TOOL_RESULT_BY_COMPONENT.PersonaSelector,
            {},
            "personas",
          ),
          cardResponseVariant("SourceNotice", CATALOG_TOOL_RESULT_BY_COMPONENT.SourceNotice, {}),
        ],
      },
    },
    order: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["intentSummary", "cards", "order"],
  propertyOrdering: ["intentSummary", "cards", "order"],
} as const;

export function buildGeminiGenerateRequest(model: string, request: ComposeRequest) {
  return {
    model,
    contents: buildComposePrompt(request),
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: "application/json",
      responseSchema: COMPOSITION_RESPONSE_SCHEMA,
      temperature: 0,
      maxOutputTokens: 2048,
    },
  } as const;
}

/**
 * BYOK Gemini provider (free tier recommended). Returns raw JSON; the composer
 * validates it as a CompositionSpec, so a malformed or hallucinated response is
 * rejected rather than rendered.
 */
export class GeminiProvider implements LlmProvider {
  readonly name = "gemini";
  private readonly ai: GoogleGenAI;
  private readonly model: string;

  constructor(options: GeminiProviderOptions) {
    this.ai = new GoogleGenAI({ apiKey: options.apiKey });
    this.model = options.model ?? DEFAULT_GEMINI_MODEL;
  }

  async compose(request: ComposeRequest): Promise<unknown> {
    const response = await this.ai.models.generateContent(
      buildGeminiGenerateRequest(this.model, request),
    );
    return JSON.parse(stripCodeFences(response.text ?? "{}"));
  }
}

function stripCodeFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}
