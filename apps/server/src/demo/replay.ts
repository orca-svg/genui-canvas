import { loadDotenv } from "../config/env.js";
import { GatewayClient } from "../mcp/gateway-client.js";
import { createProvider } from "../llm/factory.js";
import { runManipulationCheck } from "./manipulation-check.js";

// BYOK: load the operator's key so demo:replay can run live (Gemini) or offline
// (rule-based) depending on apps/server/.env.
loadDotenv();

/**
 * Live manipulation-check CLI. Runs the same query with and without card
 * manipulations and prints the diff — the reproducible demo that interaction
 * reshapes the composition. Uses the BYOK provider (rule-based with no key).
 *
 *   pnpm demo:replay "서울 대학생 지원"
 */
const query = process.argv[2] ?? "서울 대학생 지원";

const gateway = new GatewayClient();
await gateway.connect();
const provider = createProvider();

try {
  const report = await runManipulationCheck(
    { gateway, provider },
    { query, profile: { region: "서울", studentStatus: "student" } },
  );

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(report, null, 2));
  const passed = report.pinnedMovedToTop && report.hiddenRemoved && report.orderChanged;
  // eslint-disable-next-line no-console
  console.log(
    passed
      ? `\n✅ [${provider.name}] interaction reshaped the composition (pinned→top, hidden removed).`
      : `\n❌ [${provider.name}] manipulation had no visible effect.`,
  );
  process.exitCode = passed ? 0 : 1;
} finally {
  await gateway.close();
}
