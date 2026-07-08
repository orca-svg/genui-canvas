import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInteractionEvent } from "@genui-canvas/contracts";
import { GatewayClient } from "./mcp/gateway-client.js";
import { RuleBasedProvider } from "./llm/provider.js";
import { TraceStore } from "./trace/store.js";
import { createApp } from "./app.js";

const gateway = new GatewayClient();
const traceDir = mkdtempSync(join(tmpdir(), "genui-app-"));
const traceStore = new TraceStore(traceDir);
const app = createApp({ gateway, provider: new RuleBasedProvider(), traceStore });

beforeAll(async () => {
  await gateway.connect();
});
afterAll(async () => {
  await gateway.close();
  rmSync(traceDir, { recursive: true, force: true });
});

describe("POST /api/session", () => {
  it("issues a session id", async () => {
    const res = await app.request("/api/session", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessionId: string };
    expect(body.sessionId).toMatch(/[0-9a-f-]{36}/);
  });
});

describe("POST /api/events", () => {
  it("accepts a valid event and appends it to the trace", async () => {
    const event = createInteractionEvent({
      sessionId: "s-http",
      seq: 0,
      actor: "user",
      type: "card.pin",
      target: { cardId: "c1" },
      context: { compositionId: "comp1", visibleCardIds: ["c1"] },
    });
    const res = await app.request("/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
    });
    expect(res.status).toBe(200);
    expect(traceStore.read("s-http")).toHaveLength(1);
  });

  it("rejects a malformed event with 400", async () => {
    const res = await app.request("/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nope: true }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/turn", () => {
  it("streams a composition with A2UI surfaces", async () => {
    const res = await app.request("/api/turn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        trigger: { type: "query.submit", text: "서울 대학생 지원" },
        profile: { region: "서울", studentStatus: "student" },
        traceSummary: { entityEngagement: [], recentEvents: [], turnCount: 0 },
        currentComposition: { cards: [] },
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("composition");
    expect(text).toContain("createSurface");
  }, 30000);
});
