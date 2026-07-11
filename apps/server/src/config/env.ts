import { existsSync } from "node:fs";

/**
 * BYOK: load the operator's local .env into process.env if it exists. The key
 * (e.g. GEMINI_API_KEY) lives only in this gitignored file — never bundled,
 * never committed. Uses Node's built-in env-file parser (no dotenv dependency).
 * A missing file is a no-op: zero config means the rule-based provider runs.
 */
export function loadDotenv(path = ".env"): void {
  if (!existsSync(path)) return;
  process.loadEnvFile(path);
}
