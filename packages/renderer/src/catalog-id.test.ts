import { describe, it, expect } from "vitest";
import { basicCatalog } from "@a2ui/react/v0_9";
import { BASIC_CATALOG_ID } from "@genui-canvas/contracts";

describe("catalog id guard", () => {
  it("BASIC_CATALOG_ID matches the installed basicCatalog.id", () => {
    // If this fails, the server's createSurface catalogId will not resolve in
    // the renderer — bump BASIC_CATALOG_ID in @genui-canvas/contracts.
    expect(BASIC_CATALOG_ID).toBe(basicCatalog.id);
  });
});
