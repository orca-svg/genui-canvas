import { describe, expect, it } from "vitest";
import { ServerEventSchema } from "./sse-protocol.js";

describe("ServerEventSchema", () => {
  it("accepts a status event", () => {
    expect(ServerEventSchema.safeParse({ kind: "status", message: "searchBenefits 호출 중" }).success).toBe(true);
  });

  it("accepts an intent delta event", () => {
    expect(ServerEventSchema.safeParse({ kind: "intent", text: "주거 우선으로 재구성" }).success).toBe(true);
  });

  it("accepts a composition event carrying a2ui messages", () => {
    const ok = ServerEventSchema.safeParse({
      kind: "composition",
      compositionId: "comp2",
      messages: [
        {
          version: "v0.9",
          createSurface: {
            surfaceId: "c1",
            catalogId: "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
          },
        },
      ],
    });
    expect(ok.success).toBe(true);
  });

  it("rejects unsupported A2UI components before they reach the renderer", () => {
    const event = {
      kind: "composition",
      compositionId: "comp2",
      messages: [
        {
          version: "v0.9",
          updateComponents: {
            surfaceId: "c1",
            components: [{ id: "raw", component: "RawHtml", html: "<script />" }],
          },
        },
      ],
    };
    expect(ServerEventSchema.safeParse(event).success).toBe(false);
  });

  it("accepts trusted presentation metadata and rejects a non-HTTPS source link", () => {
    const base = {
      kind: "composition",
      compositionId: "comp2",
      messages: [],
      cards: [
        {
          cardId: "c1",
          entityId: "benefit-1",
          componentType: "BenefitCard",
          title: "사람이 읽는 혜택명",
          sourceUrl: "https://www.gov.kr/benefit/1",
          sourceCheckedAt: "2026-07-10T00:00:00.000Z",
        },
      ],
    };
    expect(ServerEventSchema.safeParse(base).success).toBe(true);
    expect(
      ServerEventSchema.safeParse({
        ...base,
        cards: [{ ...base.cards[0], sourceUrl: "http://insecure.example/benefit" }],
      }).success,
    ).toBe(false);
  });

  it("accepts an error event", () => {
    expect(ServerEventSchema.safeParse({ kind: "error", message: "구성 실패" }).success).toBe(true);
  });

  it("rejects an unknown event kind", () => {
    expect(ServerEventSchema.safeParse({ kind: "explode" }).success).toBe(false);
  });
});
