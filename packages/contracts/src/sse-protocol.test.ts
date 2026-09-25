import { describe, expect, it } from "vitest";
import { CanvasActionSchema, ServerEventSchema, A2uiMessageSchema } from "./sse-protocol.js";

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

  it("accepts nextSeq: 0 as a valid boundary, not a falsy omission", () => {
    expect(ServerEventSchema.safeParse({ kind: "error", message: "x", nextSeq: 0 }).success).toBe(true);
    expect(
      ServerEventSchema.safeParse({ kind: "composition", compositionId: "comp2", messages: [], nextSeq: 0 })
        .success,
    ).toBe(true);
  });

  it("accepts itemCount: 0 on a card with no checklist rows yet", () => {
    const event = {
      kind: "composition",
      compositionId: "comp2",
      messages: [],
      cards: [{ cardId: "c1", componentType: "Checklist", entityId: "a", itemCount: 0 }],
    };
    expect(ServerEventSchema.safeParse(event).success).toBe(true);
  });

  it("rejects an unknown event kind", () => {
    expect(ServerEventSchema.safeParse({ kind: "explode" }).success).toBe(false);
  });
});

const CATALOG = "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json";
const update = (components: unknown[]) => ({
  version: "v0.9",
  updateComponents: { surfaceId: "c1", components },
});

describe("interactive A2UI subset", () => {
  it("accepts Card, Row, Divider, a persona.select Button, and a bound CheckBox", () => {
    const ok = A2uiMessageSchema.safeParse(
      update([
        { id: "root", component: "Card", child: "body" },
        { id: "body", component: "Column", children: ["row", "hr", "btn", "cb"] },
        { id: "row", component: "Row", children: ["t"], align: "center" },
        { id: "t", component: "Text", text: { path: "/t" }, variant: "h4" },
        { id: "hr", component: "Divider" },
        {
          id: "btn",
          component: "Button",
          child: "t",
          variant: "primary",
          action: { event: { name: "persona.select", context: { personaId: "senior" } } },
        },
        { id: "cb", component: "CheckBox", label: { path: "/item0Text" }, value: { path: "/checked0" } },
      ]),
    );
    expect(ok.success).toBe(true);
  });

  it("rejects a Button whose action is not a known canvas action", () => {
    const bad = A2uiMessageSchema.safeParse(
      update([
        { id: "t", component: "Text", text: { path: "/t" } },
        { id: "btn", component: "Button", child: "t", action: { event: { name: "open.url", context: { url: "https://x" } } } },
      ]),
    );
    expect(bad.success).toBe(false);
  });

  it("rejects persona.select with a persona outside the gateway enum", () => {
    expect(
      CanvasActionSchema.safeParse({ name: "persona.select", context: { personaId: "hacker" } }).success,
    ).toBe(false);
    expect(
      CanvasActionSchema.safeParse({ name: "persona.select", context: { personaId: "senior" } }).success,
    ).toBe(true);
  });

  it("accepts an empty children array on Column and Row", () => {
    expect(
      A2uiMessageSchema.safeParse(update([{ id: "col", component: "Column", children: [] }])).success,
    ).toBe(true);
    expect(
      A2uiMessageSchema.safeParse(update([{ id: "row", component: "Row", children: [] }])).success,
    ).toBe(true);
  });

  it("rejects a CheckBox with a literal value instead of a data binding", () => {
    const bad = A2uiMessageSchema.safeParse(
      update([{ id: "cb", component: "CheckBox", label: { path: "/l" }, value: true }]),
    );
    expect(bad.success).toBe(false);
  });

  it("drops the reserved composition.partial kind and carries nextSeq on terminal events", () => {
    expect(
      ServerEventSchema.safeParse({ kind: "composition.partial", compositionId: "c", messages: [] }).success,
    ).toBe(false);
    expect(
      ServerEventSchema.safeParse({
        kind: "composition",
        compositionId: "comp2",
        messages: [{ version: "v0.9", createSurface: { surfaceId: "c1", catalogId: CATALOG } }],
        cards: [{ cardId: "c1", componentType: "Checklist", entityId: "a", hidden: true, emphasis: "secondary", itemCount: 3 }],
        nextSeq: 7,
      }).success,
    ).toBe(true);
    expect(ServerEventSchema.safeParse({ kind: "error", message: "x", nextSeq: 2 }).success).toBe(true);
  });

  it("carries bounded trace-derived checked rows on Checklist card metadata", () => {
    const composition = (checkedItems: unknown) =>
      ServerEventSchema.safeParse({
        kind: "composition",
        compositionId: "comp3",
        messages: [],
        cards: [{ cardId: "c1", componentType: "Checklist", entityId: "a", itemCount: 90, checkedItems }],
      }).success;

    expect(composition([])).toBe(true);
    expect(composition([0, 2, 89])).toBe(true);
    expect(composition(Array.from({ length: 90 }, (_, i) => i))).toBe(true);
    expect(composition([90])).toBe(false);
    expect(composition([-1])).toBe(false);
    expect(composition([1.5])).toBe(false);
    expect(composition(Array.from({ length: 91 }, () => 0))).toBe(false);
    expect(composition("0")).toBe(false);
  });
});
