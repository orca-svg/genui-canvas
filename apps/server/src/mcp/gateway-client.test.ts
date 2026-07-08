import { describe, it, expect, afterAll } from "vitest";
import { GatewayClient } from "./gateway-client.js";

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
      region: "서울",
      studentStatus: "student",
    })) as { results: Array<{ id: string; title: string }> };

    expect(Array.isArray(res.results)).toBe(true);
    expect(res.results.length).toBeGreaterThan(0);
    expect(typeof res.results[0]?.id).toBe("string");
    expect(typeof res.results[0]?.title).toBe("string");
  }, 30000);

  it("returns a structured detail for a known benefit id", async () => {
    const detail = (await client.getBenefitDetail("national-scholarship")) as {
      id: string;
      sourceUrl: string;
    };
    expect(detail.id).toBe("national-scholarship");
    expect(detail.sourceUrl).toMatch(/^https?:\/\//);
  }, 30000);
});
