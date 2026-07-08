import { RuleBasedProvider, type LlmProvider } from "./provider.js";
import { GeminiProvider } from "./gemini.js";

export interface ProviderEnv {
  LLM_PROVIDER?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
}

/**
 * BYOK provider selection. Zero-config default = rule-based (no key, runs
 * offline). Set LLM_PROVIDER=gemini + your own GEMINI_API_KEY (free tier) to
 * compose with an LLM. No key is ever bundled or shipped.
 */
export function createProvider(env: ProviderEnv = process.env): LlmProvider {
  const kind = env.LLM_PROVIDER ?? (env.GEMINI_API_KEY ? "gemini" : "rule-based");

  switch (kind) {
    case "gemini": {
      if (!env.GEMINI_API_KEY) {
        throw new Error(
          "LLM_PROVIDER=gemini requires GEMINI_API_KEY (free tier: https://aistudio.google.com/apikey)",
        );
      }
      return new GeminiProvider({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL });
    }
    case "rule-based":
      return new RuleBasedProvider();
    default:
      throw new Error(`Unknown LLM_PROVIDER: ${kind}`);
  }
}
