import { describe, it, expect, afterAll } from "vitest";
import { GatewayClient } from "../mcp/gateway-client.js";
import { RuleBasedProvider, type LlmProvider } from "../llm/provider.js";
import { groupedOrderHolds, runManipulationCheck } from "./manipulation-check.js";

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
      "session.start",
      "query.submit",
      "tool.called",
      "composition.applied",
      "card.pin",
      "card.hide",
      "card.reorder",
      "card.expand",
      "query.submit",
      "tool.called",
      "composition.applied",
    ]);
    expect(report.controlComponentTypes).toEqual(["BenefitCard", "DeadlineList"]);
    expect(report.manipulatedComponentTypes).toEqual([
      "BenefitCard",
      "Checklist",
      "DeadlineList",
      "ScoreBreakdown",
      "SourceNotice",
    ]);
    expect(report.subCardsComposed).toBe(true);
    expect(report.groupedOrderPreserved).toBe(true);
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

  it("keeps candidate groups whole and DeadlineList last for a provider that scrambles its order", async () => {
    await gateway.connect();
    const ruleBased = new RuleBasedProvider();
    // Non-compliant provider: the rule-based cards, emitted back to front.
    const scrambling: LlmProvider = {
      name: "scrambling",
      async compose(request) {
        const spec = (await ruleBased.compose(request)) as { cards: Array<{ cardId: string }> };
        const cards = [...spec.cards].reverse();
        return { ...spec, cards, order: cards.map((card) => card.cardId) };
      },
    };
    const report = await runManipulationCheck(
      { gateway, provider: scrambling },
      { query: "서울 대학생 지원", profile: { regionCode: "KR-11", studentStatus: "student" } },
    );

    expect(report.groupedOrderPreserved).toBe(true);
    expect(report.pinnedMovedToTop).toBe(true);
    expect(report.hiddenRemoved).toBe(true);
    expect(report.subCardsComposed).toBe(true);
  }, 30000);
});

describe("groupedOrderHolds", () => {
  const card = (componentType: string, entityId: string) => ({ componentType, entityId });
  const pinned = new Set(["p"]);

  it("accepts PersonaSelector first, pinned group, other groups, DeadlineList last", () => {
    expect(
      groupedOrderHolds(
        [
          card("PersonaSelector", "personas"),
          card("BenefitCard", "p"),
          card("ScoreBreakdown", "p"),
          card("BenefitCard", "r"),
          card("Checklist", "r"),
          card("SourceNotice", "r"),
          card("DeadlineList", "upcoming-deadlines"),
        ],
        pinned,
      ),
    ).toBe(true);
  });

  it("rejects a split group, a wrong in-group order, a buried pin, and a misplaced singleton", () => {
    const split = [card("BenefitCard", "p"), card("BenefitCard", "r"), card("ScoreBreakdown", "p")];
    const inGroup = [card("BenefitCard", "p"), card("SourceNotice", "p"), card("Checklist", "p")];
    const buried = [card("BenefitCard", "r"), card("BenefitCard", "p")];
    const personaLate = [card("BenefitCard", "p"), card("PersonaSelector", "personas")];
    const deadlineEarly = [card("DeadlineList", "upcoming-deadlines"), card("BenefitCard", "p")];
    for (const cards of [split, inGroup, buried, personaLate, deadlineEarly]) {
      expect(groupedOrderHolds(cards, pinned)).toBe(false);
    }
  });
});
