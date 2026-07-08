import { describe, it, expect, afterAll } from "vitest";
import { GatewayClient } from "../mcp/gateway-client.js";
import { RuleBasedProvider } from "../llm/provider.js";
import { runManipulationCheck } from "./manipulation-check.js";

const gateway = new GatewayClient();
afterAll(async () => {
  await gateway.close();
});

describe("runManipulationCheck (live gateway, rule-based)", () => {
  it("shows the pinned card rising to the top and the hidden card removed vs the control", async () => {
    await gateway.connect();
    const report = await runManipulationCheck(
      { gateway, provider: new RuleBasedProvider() },
      { query: "서울 대학생 지원", profile: { region: "서울", studentStatus: "student" } },
    );

    expect(report.pinnedMovedToTop).toBe(true);
    expect(report.hiddenRemoved).toBe(true);
    expect(report.orderChanged).toBe(true);
    // the control included the entity that gets hidden; the manipulated run does not
    expect(report.controlOrder).toContain(report.hiddenEntityId);
    expect(report.manipulatedOrder).not.toContain(report.hiddenEntityId);
  }, 30000);
});
