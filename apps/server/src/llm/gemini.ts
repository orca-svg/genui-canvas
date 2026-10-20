import { GoogleGenAI } from "@google/genai";
import { CATALOG_TOOL_RESULT_BY_COMPONENT } from "@genui-canvas/contracts";
import type { ProviderFailureKind } from "@genui-canvas/contracts";
import { ProviderError, type ComposeRequest, type LlmProvider } from "./provider.js";
import { SYSTEM_PROMPT, buildComposePrompt } from "./prompts.js";

type GenerateRequest = ReturnType<typeof buildGeminiGenerateRequest>;
type Generate = (request: GenerateRequest) => Promise<{ text?: string | undefined }>;

export interface GeminiProviderOptions {
  apiKey: string;
  model?: string;
  /** Tried when `model` stays overloaded or rate limited after its retries, or does not exist. */
  fallbackModel?: string;
  /** Extra attempts per model for HTTP 429 and 5xx answers (default 2). */
  maxRetries?: number;
  /** Wait before the first retry; it doubles for each further retry (default 400ms). */
  retryDelayMs?: number;
  /** Receives one line when the fallback model answers (default: console.warn). */
  log?: (message: string) => void;
  /** Test seam: replaces the SDK's generateContent. */
  generate?: Generate;
  /** Test seam: replaces the wait between retries. */
  sleep?: (ms: number) => Promise<void>;
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
  private readonly generate: Generate;
  private readonly model: string;
  private readonly fallbackModel: string | undefined;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly log: (message: string) => void;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: GeminiProviderOptions) {
    if (options.generate) {
      this.generate = options.generate;
    } else {
      const ai = new GoogleGenAI({ apiKey: options.apiKey });
      this.generate = (request) => ai.models.generateContent(request);
    }
    this.model = options.model ?? DEFAULT_GEMINI_MODEL;
    this.fallbackModel = options.fallbackModel && options.fallbackModel !== this.model ? options.fallbackModel : undefined;
    this.maxRetries = options.maxRetries ?? 2;
    this.retryDelayMs = options.retryDelayMs ?? 400;
    this.log = options.log ?? ((message) => console.warn(message));
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /**
   * Asks `model`, retrying HTTP 429 and 5xx answers with growing waits. When
   * the model stays overloaded or rate limited, or does not exist for this
   * key, `fallbackModel` gets the same treatment. A refused key or a non-JSON
   * answer fails at once, since another attempt cannot fix either.
   */
  async compose(request: ComposeRequest): Promise<unknown> {
    try {
      return await this.composeWith(this.model, request);
    } catch (error) {
      if (!this.fallbackModel || !(error instanceof ProviderError) || !SWITCH_MODEL_ON.has(error.kind)) throw error;
      const answer = await this.composeWith(this.fallbackModel, request);
      this.log(
        `[genui-canvas] gemini model ${this.model} failed (${error.kind}); answered by fallback model ${this.fallbackModel}`,
      );
      return answer;
    }
  }

  private async composeWith(model: string, request: ComposeRequest): Promise<unknown> {
    for (let attempt = 0; ; attempt += 1) {
      let text: string;
      try {
        text = (await this.generate(buildGeminiGenerateRequest(model, request))).text ?? "{}";
      } catch (caught) {
        const failure = classifyGeminiError(caught, model);
        if (!RETRY_ON.has(failure.kind) || attempt >= this.maxRetries) throw failure;
        await this.sleep(this.retryDelayMs * 2 ** attempt);
        continue;
      }
      try {
        return JSON.parse(stripCodeFences(text));
      } catch {
        throw new ProviderError(`Gemini model ${model} answered with text that is not JSON`, "invalid_response");
      }
    }
  }
}

/** Kinds worth another attempt on the same model. */
const RETRY_ON = new Set<ProviderFailureKind>(["overloaded", "rate_limited"]);
/** Kinds the fallback model may fix (a refused key or a bad answer it cannot). */
const SWITCH_MODEL_ON = new Set<ProviderFailureKind>(["overloaded", "rate_limited", "model_unavailable"]);

/** Maps an SDK error (its ApiError carries the HTTP `status`) to a ProviderError. */
function classifyGeminiError(error: unknown, model: string): ProviderError {
  const status =
    error && typeof error === "object" && typeof (error as { status?: unknown }).status === "number"
      ? (error as { status: number }).status
      : undefined;
  const message = error instanceof Error ? error.message : String(error);
  const kind: ProviderFailureKind =
    status === 429
      ? "rate_limited"
      : status !== undefined && status >= 500
        ? "overloaded"
        : status === 404
          ? "model_unavailable"
          : status === 401 || status === 403 || (status === 400 && /api[ _-]?key/i.test(message))
            ? "auth"
            : "error";
  const label = status === undefined ? "request failed" : `HTTP ${status}`;
  return new ProviderError(`Gemini model ${model} ${label}: ${message.slice(0, 300)}`, kind, status);
}

function stripCodeFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}
