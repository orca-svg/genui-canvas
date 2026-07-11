import { describe, it, expect, afterAll } from "vitest";
import { BenefitSearchResponseSchema } from "@genui-canvas/contracts";
import searchSuccessJson from "@mcp-gen-ui/schema/fixtures/v2/search-success.json";
import {
  GatewayCompatibilityError,
  GatewayClient,
  createGatewayEnvironment,
  parseGatewayToolResult,
} from "./gateway-client.js";

describe("gateway output boundary", () => {
  it("does not pass provider credentials to the LLM-free gateway child", () => {
    const previous = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "sensitive-test-key";
    try {
      const env = createGatewayEnvironment("/tmp/gateway-test.db");
      expect(env.GEMINI_API_KEY).toBeUndefined();
      expect(env.MCP_GEN_UI_DB_PATH).toBe("/tmp/gateway-test.db");
      expect(env.MCP_GEN_UI_REPOSITORY_MODE).toBe("fixture");
    } finally {
      if (previous === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = previous;
    }
  });

  it("rejects text output that does not satisfy the shared gateway schema", () => {
    expect(() =>
      parseGatewayToolResult(
        { content: [{ type: "text", text: JSON.stringify({ results: [{ id: "partial" }] }) }] },
        BenefitSearchResponseSchema,
      ),
    ).toThrow();
  });

  it("rejects inconsistent structuredContent and legacy text fallback", () => {
    const payload = {
      query: "지원",
      profile: {},
      results: [],
      generatedAt: "2026-07-10T00:00:00.000Z",
    };
    expect(() =>
      parseGatewayToolResult(
        {
          structuredContent: payload,
          content: [
            { type: "text", text: JSON.stringify({ ...payload, query: "다른 값" }) },
          ],
        },
        BenefitSearchResponseSchema,
      ),
    ).toThrow("inconsistent structured and text output");
  });

  it("returns an explicit compatibility error for an unsupported schemaVersion", () => {
    const incompatible = {
      ...structuredClone(searchSuccessJson),
      schemaVersion: "benefit-search.v999",
    };
    expect(() =>
      parseGatewayToolResult(
        {
          structuredContent: incompatible,
          content: [{ type: "text", text: JSON.stringify(incompatible) }],
        },
        BenefitSearchResponseSchema,
      ),
    ).toThrow(GatewayCompatibilityError);
  });
});

// Live integration: spawns the real published @mcp-gen-ui/mcp-server over stdio.
// The gateway is LLM-free and serves fixtures offline, so this is deterministic
// and needs no network or API key — it verifies the actual MCP connection.
describe("GatewayClient (live MCP stdio)", () => {
  const client = new GatewayClient();

  afterAll(async () => {
    await client.close();
  });

  it("connects to the spawned gateway and returns benefit search results", async () => {
    await client.connect();
    const res = (await client.searchBenefits("서울 대학생 지원", {
      regionCode: "KR-11",
      studentStatus: "student",
    })) as { results: Array<{ id: string; title: string }> };

    expect(Array.isArray(res.results)).toBe(true);
    expect(res.results.length).toBeGreaterThan(0);
    expect(typeof res.results[0]?.id).toBe("string");
    expect(typeof res.results[0]?.title).toBe("string");
  }, 30000);

  it("returns a structured detail for a known benefit id", async () => {
    const search = await client.searchBenefits("지원");
    const id = search.results[0]?.id;
    expect(id).toEqual(expect.any(String));
    const detail = await client.getBenefitDetail(id!);
    expect(detail.schemaVersion).toBe("benefit-detail.v2");
    expect(detail.result.id).toBe(id);
    expect(
      detail.result.links.some(
        (link) => link.rel === "source" && link.official && link.url.startsWith("https://"),
      ),
    ).toBe(true);
  }, 30000);
});
