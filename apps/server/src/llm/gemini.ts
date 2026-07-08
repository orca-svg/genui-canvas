import { GoogleGenAI } from "@google/genai";
import type { ComposeRequest, LlmProvider } from "./provider.js";
import { SYSTEM_PROMPT, buildComposePrompt } from "./prompts.js";

export interface GeminiProviderOptions {
  apiKey: string;
  model?: string;
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
    this.model = options.model ?? "gemini-2.5-flash";
  }

  async compose(request: ComposeRequest): Promise<unknown> {
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: `${SYSTEM_PROMPT}\n\n${buildComposePrompt(request)}`,
      config: { responseMimeType: "application/json", temperature: 0 },
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
