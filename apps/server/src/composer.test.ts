import { describe, it, expect, afterAll } from "vitest";
import { GatewayClient } from "./mcp/gateway-client.js";
import { RuleBasedProvider, type LlmProvider, type ComposeRequest } from "./llm/provider.js";
import { composeTurn } from "./composer.js";

const gateway = new GatewayClient();
afterAll(async () => {
  await gateway.close();
});

const turn = {
  trigger: { type: "query.submit", text: "서울 대학생 지원" } as const,
  profile: { region: "서울", studentStatus: "student" as const },
  traceSummary: { entityEngagement: [], recentEvents: [], turnCount: 0 },
  currentComposition: { cards: [] },
};

describe("composeTurn (live gateway + rule-based provider)", () => {
  it("searches the gateway, composes, and expands to A2UI surfaces", async () => {
    await gateway.connect();
    const result = await composeTurn({ gateway, provider: new RuleBasedProvider() }, turn);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const surfaces = result.messages.filter((m) => "createSurface" in m);
      expect(surfaces.length).toBeGreaterThan(0);
      expect(result.spec.cards.length).toBe(surfaces.length);
    }
  }, 30000);

  it("rejects a provider that references a benefit the gateway never returned", async () => {
    await gateway.connect();
    const hallucinating: LlmProvider = {
      name: "bad",
      async compose(_req: ComposeRequest) {
        return {
          intentSummary: "환각",
          cards: [
            {
              cardId: "x",
              componentType: "BenefitCard",
              entityRef: { toolResult: "searchBenefits", entityId: "made-up-benefit" },
              rationale: "존재하지 않는 혜택",
            },
          ],
          order: ["x"],
        };
      },
    };
    const result = await composeTurn({ gateway, provider: hallucinating }, turn);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/made-up-benefit/);
  }, 30000);

  it("keeps a pinned card first even when the provider ignores the pin (server enforcement)", async () => {
    await gateway.connect();
    // A provider that returns candidates in reverse score order (ignores pins).
    const contrarian: LlmProvider = {
      name: "contrarian",
      async compose(req: ComposeRequest) {
        const cards = [...req.candidates].reverse().map((cand) => ({
          cardId: `card-${cand.entityId}`,
          componentType: "BenefitCard",
          entityRef: { toolResult: "searchBenefits", entityId: cand.entityId },
          rationale: "무시",
        }));
        return { intentSummary: "무시", cards, order: cards.map((c) => c.cardId) };
      },
    };
    const pinnedTurn = {
      ...turn,
      currentComposition: {
        cards: [
          {
            cardId: "card-national-scholarship",
            entityId: "national-scholarship",
            componentType: "BenefitCard",
            state: "pinned" as const,
          },
        ],
      },
    };
    const result = await composeTurn({ gateway, provider: contrarian }, pinnedTurn);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.spec.order[0]).toBe("card-national-scholarship");
    }
  }, 30000);
});
