import { GoogleGenAI } from "@google/genai";
import type { ComposeRequest, LlmProvider } from "./provider.js";
import { SYSTEM_PROMPT, buildComposePrompt } from "./prompts.js";

export interface GeminiProviderOptions {
  apiKey: string;
  model?: string;
}

// Structured-output schema: forces Gemini to emit a CompositionSpec-shaped JSON
// object (no prose, no malformed JSON). `props` is intentionally omitted — it
// defaults to {} in the Zod schema and would need an open-ended map here.
const COMPOSITION_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    intentSummary: { type: "STRING" },
    cards: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          cardId: { type: "STRING" },
          componentType: {
            type: "STRING",
            enum: [
              "BenefitCard",
              "ScoreBreakdown",
              "Checklist",
              "DeadlineList",
              "PersonaSelector",
              "SourceNotice",
            ],
          },
          entityRef: {
            type: "OBJECT",
            properties: {
              toolResult: {
                type: "STRING",
                enum: [
                  "searchBenefits",
                  "getBenefitDetail",
                  "getUpcomingDeadlines",
                  "buildChecklist",
                  "getApplicationGuide",
                ],
              },
              entityId: { type: "STRING" },
            },
            required: ["toolResult", "entityId"],
            propertyOrdering: ["toolResult", "entityId"],
          },
          emphasis: { type: "STRING", enum: ["primary", "secondary"] },
          rationale: { type: "STRING" },
        },
        required: ["cardId", "componentType", "entityRef", "rationale"],
        propertyOrdering: ["cardId", "componentType", "entityRef", "emphasis", "rationale"],
      },
    },
    order: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["intentSummary", "cards", "order"],
  propertyOrdering: ["intentSummary", "cards", "order"],
} as const;

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
    // "-latest" tracks the current stable flash model; pinned versions get
    // retired for new keys over time (e.g. gemini-2.5-flash → 404).
    this.model = options.model ?? "gemini-flash-latest";
  }

  async compose(request: ComposeRequest): Promise<unknown> {
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: `${SYSTEM_PROMPT}\n\n${buildComposePrompt(request)}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: COMPOSITION_RESPONSE_SCHEMA,
        temperature: 0,
        maxOutputTokens: 2048,
      },
    });
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
