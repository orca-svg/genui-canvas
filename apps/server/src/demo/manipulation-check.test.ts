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
      { query: "서울 대학생 지원", profile: { regionCode: "KR-11", studentStatus: "student" } },
    );

    expect(report.pinnedMovedToTop).toBe(true);
    expect(report.hiddenRemoved).toBe(true);
    expect(report.orderChanged).toBe(true);
    expect(report.httpBoundaryVerified).toBe(true);
    expect(report.traceClosedLoop).toBe(true);
    expect(report.recordedEventTypes).toEqual([
      "query.submit",
      "composition.applied",
      "card.pin",
      "card.hide",
      "card.reorder",
      "card.expand",
      "query.submit",
      "composition.applied",
    ]);
    expect(report.observedTraceSummary).toMatchObject({
      orderingSignal: { userReordered: true },
      turnCount: 2,
    });
    expect(report.observedTraceSummary.entityEngagement).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityId: report.pinnedEntityId, pinned: true }),
        expect.objectContaining({ entityId: report.hiddenEntityId, hidden: true }),
      ]),
    );
    // the control included the entity that gets hidden; the manipulated run does not
    expect(report.controlOrder).toContain(report.hiddenEntityId);
    expect(report.manipulatedOrder).not.toContain(report.hiddenEntityId);
  }, 30000);
});
