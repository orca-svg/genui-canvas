import { loadDotenv } from "../config/env.js";
import { GatewayClient } from "../mcp/gateway-client.js";
import { createProvider } from "../llm/factory.js";
import { RuleBasedProvider } from "../llm/provider.js";
import { runManipulationCheck } from "./manipulation-check.js";

/**
 * HTTP manipulation-check CLI. The default is deterministic and key-free;
 * --live explicitly opts into the local BYOK provider.
 *
 *   pnpm demo:replay "서울 대학생 지원"
 */
const live = process.argv.includes("--live");
const query = process.argv.slice(2).find((argument) => !argument.startsWith("--")) ?? "서울 대학생 지원";
if (live) loadDotenv();

const gateway = new GatewayClient();
await gateway.connect();
// The default is a deterministic, key-free control suitable for CI and
// research reproduction. `--live` explicitly opts into the local BYOK model.
const provider = live ? createProvider() : new RuleBasedProvider();

try {
  const report = await runManipulationCheck(
    { gateway, provider },
    { query, profile: { region: "서울", studentStatus: "student" } },
  );

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(report, null, 2));
  const passed =
    report.httpBoundaryVerified &&
    report.traceClosedLoop &&
    report.pinnedMovedToTop &&
    report.hiddenRemoved &&
    report.orderChanged;
  // eslint-disable-next-line no-console
  console.log(
    passed
      ? `\n✅ [${provider.name}] HTTP trace closed and reshaped the composition.`
      : `\n❌ [${provider.name}] HTTP trace/composition verification failed.`,
  );
  process.exitCode = passed ? 0 : 1;
} finally {
  await gateway.close();
}
