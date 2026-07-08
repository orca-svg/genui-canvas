import { describe, it, expect } from "vitest";
import { createProvider } from "./factory.js";

describe("createProvider (BYOK)", () => {
  it("defaults to the rule-based provider when no key is set", () => {
    expect(createProvider({}).name).toBe("rule-based");
  });

  it("selects gemini when GEMINI_API_KEY is present", () => {
    expect(createProvider({ GEMINI_API_KEY: "test-key" }).name).toBe("gemini");
  });

  it("throws when gemini is requested without a key (no bundled key)", () => {
    expect(() => createProvider({ LLM_PROVIDER: "gemini" })).toThrow(/GEMINI_API_KEY/);
  });

  it("rejects an unknown provider", () => {
    expect(() => createProvider({ LLM_PROVIDER: "nope" })).toThrow(/Unknown/);
  });
});
