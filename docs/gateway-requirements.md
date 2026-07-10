# `mcp-gateway-genui` implementation handoff

Reviewed against gateway commit `10d4a8bfcbb743c7392cfef382c539da6c53583e`
and published packages `@mcp-gen-ui/*@0.2.0` on 2026-07-10.

This is an implementation-ready handoff for the developer working in
[`orca-svg/mcp-gateway-genui`](https://github.com/orca-svg/mcp-gateway-genui).
No gateway source was changed from this repository.

## Goal and non-goal

The gateway should be a source-aware **candidate discovery and explanation
layer**, not a final eligibility adjudicator. It remains LLM-free. It must
preserve evidence, uncertainty, source health, and version information so
`genui-canvas` can render trustworthy candidates without inventing facts.

Do not add clickstream personalization or RQ-VAE ranking in this phase. That
requires opt-in data, retention/deletion design, outcome ground truth, and
fairness evaluation.

## P0: external contract and misclassification prevention

### G0.1 — Publish a strict v2 response envelope

Primary files: `packages/schema/src/index.ts`, generated schemas under
`packages/schema/schema/`, and every tool return in `packages/core`.

Required shape (names may change; semantics may not):

```ts
type BenefitSearchResponseV2 = {
  schemaVersion: "benefit-search.v2";
  query: string;
  profile: StrictCoarseProfile;
  rankingPolicy: {
    id: string;
    version: string;
    persona?: RecommendationPersona;
    effectiveWeights: Record<RecommendationScoreDimension, number>;
    scoreMeaning: "relative_relevance_not_eligibility";
  };
  dataStatus: {
    mode: "fixture" | "live" | "mixed";
    partial: boolean;
    sources: SourceObservation[];
  };
  results: BenefitCandidateV2[];
  generatedAt: string;
};

type BenefitCandidateV2 = {
  id: string;                    // opaque: ^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$
  title: string;
  provider: string;
  category: BenefitCategory;
  summary: string;
  assessment: {
    status: "candidate" | "needs_more_info" | "conflict_detected";
    constraints: Array<{
      dimension: RecommendationScoreDimension;
      outcome: "match" | "conflict" | "unknown";
      basis: "authoritative_structured" | "derived_text" | "default";
      ruleId: string;
      ruleVersion: string;
      sourceFields: string[];
      explanation: string;
    }>;
    missingInfo: string[];
  };
  ranking: {
    score: number;               // [0,1], relative relevance only
    breakdown: ScoreBreakdownItem[];
  };
  provenance: ProvenanceRecord[];
  links: Array<{
    rel: "source" | "apply";
    url: string;
    official: boolean;
    verifiedAt?: string;
    verificationMethod?: string;
  }>;
};
```

All public Zod objects must use `.strict()`. Inputs must reject unknown fields
rather than strip them. Apply these bounds:

- `query`: NFC-normalized, trimmed, 1–300 characters; define control and
  zero-width-character policy;
- `withinDays`: integer `1..365`;
- coarse region code enum rather than a full address; prefer `ageBand` to birth
  date; no name, resident number, email, phone, detailed address, credential,
  or certificate field;
- finite, non-negative weights with documented range/sum behavior;
- opaque IDs matching the grammar above.

Acceptance:

- unknown `email`/`residentNumber` fields return a validation error;
- Zod and generated JSON Schema accept/reject the same golden fixtures;
- every response contains schema, ranking-policy, data-mode, source, and
  adapter versions;
- fixture mode is visible in the response and downstream UI.

### G0.2 — Separate assessment from ranking

Primary files: `packages/core/src/recommender.ts` and adapter derivation in
`packages/adapters/src/index.ts`.

Invariants:

1. `ranking.score` never means probability, eligibility, policy priority, or
   confidence.
2. `derived_text` and `default` evidence can influence retrieval/order but
   cannot create a hard conflict or exclusion.
3. Missing authoritative information produces `unknown` and
   `needs_more_info`.
4. A hard conflict requires explicit `authoritative_structured` evidence and is
   still returned as a candidate conflict for user verification.
5. Persona/weight changes may change ranking only. For the same record/profile,
   assessment status, constraints, and missing information are identical across
   personas.

Acceptance tests:

- a title containing “청년” without a structured age rule never becomes a hard
  age conflict;
- changing `general` to `youth_jobseeker` changes order/score but not assessment;
- every constraint includes basis, rule ID/version, source fields, and an
  explanation;
- legacy `not_applicable`, if retained during migration, is deprecated and can
  only be produced from authoritative structured conflicts.

### G0.3 — Expose source health, provenance, and link verification

Primary files: adapters, repository interfaces, tool service, and schema.

Replace `BenefitRecord[]` adapter returns with:

```ts
type AdapterResult = {
  records: BenefitRecord[];
  observation: {
    sourceId: string;
    status: "ok" | "partial" | "timeout" | "unavailable" | "invalid_payload";
    retrievedAt: string;
    recordCount: number;
    errorCode?: string;          // stable and non-sensitive
    adapterVersion: string;
  };
};
```

Requirements:

- timeout/AbortSignal, maximum payload, content-type check, and bounded retry;
- HTTPS source-specific origin registry; `source` and `apply` links are
  distinct; unknown origins are never marked official;
- field-level lineage with source ID/record ID/authority/content hash;
- partial source failure produces `dataStatus.partial=true` and source entries;
  all-source failure returns a stable MCP error, not a successful empty list;
- summary and deadline records carry provenance/freshness directly, avoiding a
  detail call per card;
- optionally add a batch detail tool if complete detail remains necessary.

Acceptance tests cover one-source failure, all-source failure, timeout, invalid
content type, oversized payload, HTTP link, unregistered HTTPS origin, and
stale/link-health states.

### G0.4 — Publish complete MCP tool contracts

Primary file: `packages/mcp-server/src/index.ts`.

Use the installed SDK's `registerTool(name, { inputSchema, outputSchema,
annotations }, handler)` for every tool. Do not use deprecated `server.tool`.

For all seven tools, including `listPersonas`:

- publish input and output schema;
- return the same object in `structuredContent` and JSON TextContent fallback;
- use `isError: true` with a stable JSON error for expected failures;
- never return stack traces, raw upstream bodies, credentials, or internal URLs;
- derive server metadata version from package metadata, not a hard-coded
  `0.1.0` value.

Publish a shared Zod/TypeScript `ListPersonasResponseSchema` containing
`{ personas: PersonaPreset[] }`. The current canvas has a temporary consumer
schema because v0.2 exports only the persona ID enum.

After query writes are removed (G1.1), annotations should be:

| Tools | readOnly | destructive | idempotent | openWorld |
| --- | ---: | ---: | ---: | ---: |
| search/detail/deadlines/checklist/guide | true | false | true | true |
| listPersonas/getChangeLog | true | false | true | false |

MCP integration acceptance:

1. Spawn the actual stdio server.
2. Assert `tools/list` exposes every input/output schema and annotation.
3. Call every tool.
4. Validate `structuredContent` with its published output schema.
5. Parse TextContent and assert deep equality with `structuredContent`.
6. Verify package/server versions agree.

### G0.5 — Make runtime repository mode explicit

`packages/mcp-server/src/index.ts` currently constructs
`FixtureBenefitRepository` unconditionally. Add explicit composition for
`fixture | live | mixed`, validate required adapter configuration at startup,
and put the selected mode in every response.

Defaults must be safe:

- development/test may default to `fixture` with an unmistakable status;
- production startup must not silently fall back from `live` to fixture;
- `mixed` reports source-by-source origin and partial status;
- a live adapter configuration error fails startup or returns a stable
  unavailable error—never fixture data labeled as live.

### G0.6 — Maintain a prompt-injection-safe consumer projection

Normalize raw display strings (NFC, length, control/zero-width policy) and URL
origins, but do not claim that deleting phrases such as “ignore previous” is a
security boundary. Publish opaque IDs and structured enums/numbers sufficient
for the canvas model projection.

Adversarial golden fixtures must include instruction-like titles, delimiter
spoofing, zero-width characters, HTML/Markdown, an overlong summary, and a fake
government URL. With normal vs hostile display text, the canvas composition's
component types, order, IDs, catalog, and actions must remain identical; only
deterministically rendered literal display text may differ.

## P1: reproducibility and operational trust

### G1.1 — Separate ingestion from reads

Primary files: `packages/core/src/tool-service.ts` and
`packages/core/src/sqlite-store.ts`.

- Search/detail/deadline/checklist/guide calls are pure reads.
- Snapshot/change writes occur only in an explicit sync/ingestion path.
- Hash canonical JSON with stable key order and exclude observation timestamps
  such as `lastFetchedAt`.
- Reobserving identical content creates no new change event; update only a
  `lastObservedAt` field if needed.
- Change events are `created | updated | deleted` and include changed JSON
  paths, source ID/revision, and content hash.
- A partial sync never emits deletion. Deletion requires a complete successful
  sync for that source.
- Add cursor pagination and a maximum limit to change-log reads.

Acceptance: two identical syncs yield zero additional changes; a field update
yields one change with exact paths; timestamp-only changes yield none; partial
sync yields no deletion.

### G1.2 — Move generated schemas to JSON Schema 2020-12

- Set `$schema` to `https://json-schema.org/draft/2020-12/schema` and stable
  `$id` values.
- Generate request/response/tool artifacts in CI and fail on a dirty diff.
- Validate golden fixtures with Ajv 2020 and format assertions.
- Add equivalence cases for unknown keys, defaults, bounds, enum, URL, and
  date-time between Zod and JSON Schema.

MCP revision 2025-11-25 defaults to JSON Schema 2020-12 and requires support
for it: [MCP schema rules](https://modelcontextprotocol.io/specification/2025-11-25/basic#json-schema-usage).

### G1.3 — Publish a cross-repository golden contract

Make `packages/schema` the only domain-contract source. Publish versioned
fixtures such as:

```text
packages/schema/fixtures/v2/
  search-success.json
  search-partial.json
  search-all-sources-failed.json
  detail-provenance.json
  deadlines-stale.json
  personas.json
  hostile-display-text.json
```

The gateway validates these in producer CI. `genui-canvas` pins the intended
package version and validates the same fixtures in consumer CI. An unsupported
`schemaVersion` must yield a visible compatibility fallback, not silent field
loss.

## P2: evidence before optimization

After P0/P1 and only with appropriate consent:

- evaluate Recall@k/NDCG@k against verified relevance plus source coverage;
- measure official-source visits and completed application steps, not clicks
  alone;
- measure score/eligibility misunderstanding and response to a wrong top result;
- report source, demographic, and accessibility subgroup failure rates;
- define monitoring, feedback/recourse, deletion, and rollback criteria before
  learned ranking.

## Migration and definition of done

1. Release the strict schema and golden fixtures as a new compatible prerelease
   or major/minor version with a migration note; do not mutate `0.2.0` behavior
   silently.
2. Keep deprecated v1 fields for at most one documented transition line, with
   v2 fields authoritative.
3. Update the canvas package pin only after producer and consumer contract tests
   pass together.
4. Preserve Apache-2.0 attribution and source-data license/attribution fields.

P0 is done only when all schema, core, adapter, MCP-stdio, hostile-data, and
canvas consumer-contract tests pass. P1 is done only when reads are pure,
change history is stable, and JSON Schema/Zod equivalence is demonstrated.
Until then, the combined system must remain labeled a fixture-backed research
prototype rather than a live eligibility service.

Research rationale and claim limits are in
[research-grounding.md](research-grounding.md).
