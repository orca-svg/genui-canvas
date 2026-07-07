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
      messages: [{ version: "v0.9", type: "createSurface", surfaceId: "c1" }],
    });
    expect(ok.success).toBe(true);
  });

  it("accepts an error event", () => {
    expect(ServerEventSchema.safeParse({ kind: "error", message: "구성 실패" }).success).toBe(true);
  });

  it("rejects an unknown event kind", () => {
    expect(ServerEventSchema.safeParse({ kind: "explode" }).success).toBe(false);
  });
});
