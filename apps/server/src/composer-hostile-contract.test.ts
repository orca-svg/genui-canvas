import { describe, expect, it } from "vitest";
import {
  BenefitSearchResponseSchema,
  GetBenefitDetailResponseSchema,
  HostileDisplayTextFixtureSchema,
  ListPersonasResponseSchema,
  UpcomingDeadlinesResponseSchema,
} from "@genui-canvas/contracts";
import searchSuccessJson from "@mcp-gen-ui/schema/fixtures/v2/search-success.json";
import hostileJson from "@mcp-gen-ui/schema/fixtures/v2/hostile-display-text.json";
import detailJson from "@mcp-gen-ui/schema/fixtures/v2/detail-provenance.json";
import deadlinesJson from "@mcp-gen-ui/schema/fixtures/v2/deadlines-stale.json";
import personasJson from "@mcp-gen-ui/schema/fixtures/v2/personas.json";
import { composeTurn } from "./composer.js";
import type { GatewayClient } from "./mcp/gateway-client.js";
import { RuleBasedProvider } from "./llm/provider.js";

function gatewayWith(search: ReturnType<typeof BenefitSearchResponseSchema.parse>): GatewayClient {
  const detail = GetBenefitDetailResponseSchema.parse(detailJson);
  const deadlines = UpcomingDeadlinesResponseSchema.parse(deadlinesJson);
  const personas = ListPersonasResponseSchema.parse(personasJson);
  return {
    async searchBenefits() {
      return search;
    },
    async getBenefitDetail() {
      return detail;
    },
    async buildChecklist(benefitId: string) {
      return {
        schemaVersion: "application-checklist.v2",
        dataStatus: detail.dataStatus,
        benefitId,
        items: [],
        caveats: ["공식 출처를 확인하세요."],
        provenance: detail.result.provenance,
        links: detail.result.links,
        generatedAt: detail.generatedAt,
      };
    },
    async getUpcomingDeadlines() {
      return deadlines;
    },
    async listPersonas() {
      return personas;
    },
  } as unknown as GatewayClient;
}

function structuralProjection(result: Awaited<ReturnType<typeof composeTurn>>) {
  if (!result.ok) return result;
  return {
    cards: result.spec.cards.map((card) => ({
      cardId: card.cardId,
      componentType: card.componentType,
      entityRef: card.entityRef,
      emphasis: card.emphasis,
      props: card.props,
    })),
    order: result.spec.order,
    wire: result.messages.map((message) => {
      if ("createSurface" in message) return { createSurface: message.createSurface };
      if ("updateComponents" in message) return { updateComponents: message.updateComponents };
      const update = message.updateDataModel as { surfaceId: string; value: Record<string, unknown> };
      return {
        updateDataModel: {
          surfaceId: update.surfaceId,
          keys: Object.keys(update.value).sort(),
          sourceUrl: update.value.sourceUrl,
        },
      };
    }),
    actions: result.cardMetadata.map(({ cardId, sourceUrl, sourceCheckedAt }) => ({
      cardId,
      sourceUrl,
      sourceCheckedAt,
    })),
  };
}

describe("hostile gateway display-text projection", () => {
  it("cannot change component types, order, IDs, catalog messages, or actions", async () => {
    const normal = BenefitSearchResponseSchema.parse(searchSuccessJson);
    const hostile = HostileDisplayTextFixtureSchema.parse(hostileJson).normalizedResponse;
    const turn = {
      trigger: { type: "query.submit", text: normal.query } as const,
      profile: normal.profile,
      traceSummary: { entityEngagement: [], recentEvents: [], turnCount: 0 },
      currentComposition: { cards: [] },
    };

    const normalResult = await composeTurn(
      { gateway: gatewayWith(normal), provider: new RuleBasedProvider() },
      turn,
    );
    const hostileResult = await composeTurn(
      { gateway: gatewayWith(hostile), provider: new RuleBasedProvider() },
      turn,
    );

    expect(normalResult.ok).toBe(true);
    expect(hostileResult.ok).toBe(true);
    expect(structuralProjection(hostileResult)).toEqual(structuralProjection(normalResult));
    if (normalResult.ok && hostileResult.ok) {
      expect(JSON.stringify(hostileResult.messages)).not.toContain(
        HostileDisplayTextFixtureSchema.parse(hostileJson).raw.fakeGovernmentUrl,
      );
      expect(JSON.stringify(hostileResult.messages)).not.toBe(
        JSON.stringify(normalResult.messages),
      );
    }
  });
});
