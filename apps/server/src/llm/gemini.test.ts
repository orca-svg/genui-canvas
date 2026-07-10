import { describe, expect, it } from "vitest";
import {
  COMPOSITION_RESPONSE_SCHEMA,
  DEFAULT_GEMINI_MODEL,
  buildGeminiGenerateRequest,
} from "./gemini.js";
import type { ComposeRequest } from "./provider.js";
import { SYSTEM_PROMPT } from "./prompts.js";

describe("Gemini composition response schema", () => {
  it("uses the requested rolling Flash alias", () => {
    expect(DEFAULT_GEMINI_MODEL).toBe("gemini-flash-latest");
  });

  it("keeps trusted instructions in the Gemini system channel", () => {
    const request: ComposeRequest = {
      context: {
        trigger: { type: "query.submit", text: "사용자 원문" },
        currentComposition: { cards: [] },
        traceSummary: { entityEngagement: [], recentEvents: [], turnCount: 0 },
        profile: {},
      },
      candidates: [],
      resources: [],
    };
    const generated = buildGeminiGenerateRequest(DEFAULT_GEMINI_MODEL, request);
    expect(generated.config.systemInstruction).toBe(SYSTEM_PROMPT);
    expect(generated.contents).not.toContain(SYSTEM_PROMPT);
  });

  it("encodes the same six component/tool discriminants as CompositionSpecSchema", () => {
    const cardItems = COMPOSITION_RESPONSE_SCHEMA.properties.cards.items as {
      anyOf?: Array<{
        properties: {
          componentType: { enum: string[] };
          entityRef: { properties: { toolResult: { enum: string[] } } };
        };
      }>;
    };
    const pairs = (cardItems.anyOf ?? []).map((variant) => [
      variant.properties.componentType.enum[0],
      variant.properties.entityRef.properties.toolResult.enum[0],
    ]);

    expect(pairs).toEqual([
      ["BenefitCard", "searchBenefits"],
      ["ScoreBreakdown", "searchBenefits"],
      ["Checklist", "buildChecklist"],
      ["DeadlineList", "getUpcomingDeadlines"],
      ["PersonaSelector", "listPersonas"],
      ["SourceNotice", "getBenefitDetail"],
    ]);
  });
});
