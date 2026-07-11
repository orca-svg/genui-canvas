import { describe, expect, it } from "vitest";
import searchSuccessJson from "@mcp-gen-ui/schema/fixtures/v2/search-success.json";
import searchPartialJson from "@mcp-gen-ui/schema/fixtures/v2/search-partial.json";
import allSourcesFailedJson from "@mcp-gen-ui/schema/fixtures/v2/search-all-sources-failed.json";
import detailProvenanceJson from "@mcp-gen-ui/schema/fixtures/v2/detail-provenance.json";
import deadlinesStaleJson from "@mcp-gen-ui/schema/fixtures/v2/deadlines-stale.json";
import personasJson from "@mcp-gen-ui/schema/fixtures/v2/personas.json";
import hostileDisplayTextJson from "@mcp-gen-ui/schema/fixtures/v2/hostile-display-text.json";
import {
  BenefitSearchResponseSchema,
  GetBenefitDetailResponseSchema,
  HostileDisplayTextFixtureSchema,
  ListPersonasResponseSchema,
  StableMcpErrorSchema,
  UpcomingDeadlinesResponseSchema,
} from "./gateway.js";

describe("published gateway v2 golden contract", () => {
  it("validates every versioned producer fixture from the installed package", () => {
    expect(BenefitSearchResponseSchema.parse(searchSuccessJson).schemaVersion).toBe(
      "benefit-search.v2",
    );
    expect(BenefitSearchResponseSchema.parse(searchPartialJson).dataStatus.partial).toBe(true);
    expect(StableMcpErrorSchema.parse(allSourcesFailedJson).error.code).toBe(
      "all_sources_failed",
    );
    expect(GetBenefitDetailResponseSchema.parse(detailProvenanceJson).schemaVersion).toBe(
      "benefit-detail.v2",
    );
    expect(UpcomingDeadlinesResponseSchema.parse(deadlinesStaleJson).schemaVersion).toBe(
      "upcoming-deadlines.v2",
    );
    expect(ListPersonasResponseSchema.parse(personasJson).schemaVersion).toBe("persona-list.v2");
    expect(
      HostileDisplayTextFixtureSchema.parse(hostileDisplayTextJson).normalizedResponse
        .schemaVersion,
    ).toBe("benefit-search.v2");
  });

  it("keeps fixture mode and source/adapter versions visible to the consumer", () => {
    const response = BenefitSearchResponseSchema.parse(searchSuccessJson);
    expect(response.dataStatus.mode).toBe("fixture");
    expect(response.dataStatus.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: expect.any(String),
          adapterVersion: expect.any(String),
        }),
      ]),
    );
    expect(response.rankingPolicy.scoreMeaning).toBe(
      "relative_relevance_not_eligibility",
    );
  });
});
