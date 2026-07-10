import { describe, expect, it } from "vitest";
import {
  CATALOG_TOOL_RESULT_BY_COMPONENT,
  CATALOG_COMPONENT_TYPES,
  CatalogComponentTypeSchema,
  validateCatalogProps,
} from "./catalog.js";

describe("catalog registry", () => {
  it("lists the six v1 domain components", () => {
    expect([...CATALOG_COMPONENT_TYPES].sort()).toEqual(
      ["BenefitCard", "Checklist", "DeadlineList", "PersonaSelector", "ScoreBreakdown", "SourceNotice"].sort(),
    );
  });

  it("enum schema rejects an unlisted component", () => {
    expect(CatalogComponentTypeSchema.safeParse("BenefitCard").success).toBe(true);
    expect(CatalogComponentTypeSchema.safeParse("RawHtml").success).toBe(false);
  });

  it("publishes the gateway result that supplies each semantic component", () => {
    expect(CATALOG_TOOL_RESULT_BY_COMPONENT).toEqual({
      BenefitCard: "searchBenefits",
      ScoreBreakdown: "searchBenefits",
      Checklist: "buildChecklist",
      DeadlineList: "getUpcomingDeadlines",
      PersonaSelector: "listPersonas",
      SourceNotice: "getBenefitDetail",
    });
  });
});

describe("validateCatalogProps", () => {
  it("accepts valid scalar props for a known component", () => {
    const result = validateCatalogProps("BenefitCard", { showScore: true });
    expect(result.ok).toBe(true);
  });

  it("rejects an unknown component type", () => {
    const result = validateCatalogProps("RawHtml", {});
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown prop key (strict catalog)", () => {
    const result = validateCatalogProps("BenefitCard", { injectHtml: "<script>" });
    expect(result.ok).toBe(false);
  });

  it("rejects a non-scalar prop value", () => {
    const result = validateCatalogProps("BenefitCard", { showScore: { nested: true } as unknown as boolean });
    expect(result.ok).toBe(false);
  });
});
