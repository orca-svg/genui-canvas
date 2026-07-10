import { describe, it, expect, afterAll } from "vitest";
import { GatewayClient } from "./mcp/gateway-client.js";
import { RuleBasedProvider } from "./llm/provider.js";
import { composeTurn } from "./composer.js";

const gateway = new GatewayClient();
afterAll(async () => {
  await gateway.close();
});

// Definitive-eligibility phrasing is banned in generated copy — recommendations
// are candidates, never eligibility decisions.
const BANNED_PHRASES = ["받을 수 있습니다", "자격이 됩니다", "확정", "수급 자격"];

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value)) collectStrings(v, out);
}

describe("safety boundaries", () => {
  it("emits no external URL that did not come from the gateway data", async () => {
    await gateway.connect();
    const result = await composeTurn(
      { gateway, provider: new RuleBasedProvider() },
      {
        trigger: { type: "query.submit", text: "서울 대학생 지원" },
        profile: { region: "서울", studentStatus: "student" },
        traceSummary: { entityEngagement: [], recentEvents: [], turnCount: 0 },
        currentComposition: { cards: [] },
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Only the user-facing data model can leak a URL into the UI; the A2UI
    // protocol's catalogId (in createSurface) is a constant, not an external link.
    const strings: string[] = [];
    for (const message of result.messages) {
      const dataModel = (message as { updateDataModel?: { value: unknown } }).updateDataModel;
      if (dataModel) collectStrings(dataModel.value, strings);
    }
    const urls = strings.flatMap((s) => s.match(/https?:\/\/\S+/g) ?? []);
    const entityIds = [...new Set(result.spec.cards.map((card) => card.entityRef.entityId))].filter(
      (entityId) => entityId !== "upcoming-deadlines" && entityId !== "personas",
    );
    const details = await Promise.all(
      entityIds.map((entityId) => gateway.getBenefitDetail(entityId) as Promise<{ sourceUrl: string }>),
    );
    const retrievedGatewayUrls = new Set(details.map((detail) => detail.sourceUrl));

    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((url) => retrievedGatewayUrls.has(url))).toBe(true);
  }, 30000);

  it("uses no definitive-eligibility phrasing in composed copy", async () => {
    const raw = (await new RuleBasedProvider().compose({
      context: {
        trigger: { type: "query.submit", text: "지원" },
        currentComposition: { cards: [] },
        traceSummary: { entityEngagement: [], recentEvents: [], turnCount: 0 },
        profile: {},
      },
      candidates: [
        { toolResult: "searchBenefits", entityId: "a", category: "education", score: 0.9, status: "candidate" },
      ],
      resources: [],
    })) as { intentSummary: string; cards: Array<{ rationale: string }> };

    const copy = [raw.intentSummary, ...raw.cards.map((c) => c.rationale)].join(" ");
    for (const phrase of BANNED_PHRASES) {
      expect(copy).not.toContain(phrase);
    }
    expect(copy).toContain("자격 확률 아님");
  });
});
