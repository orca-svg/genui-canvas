# Verification criteria

This project is built milestone-by-milestone with TDD. Each milestone ends in a
**demonstrable** state and must pass the automated gate (`pnpm build && pnpm
typecheck && pnpm test`) before the next begins. The local agent harness
(`.claude/`, not committed) orchestrates the same checks; this document is the
public, authoritative version.

## Automated gate (every milestone, CI-enforced)

- `pnpm build` — all workspace packages compile.
- `pnpm typecheck` — no type errors (strict TS).
- `pnpm test` — all Vitest suites green, output pristine.
- Tests use **no live network**: gateway tool calls and LLM calls are covered by
  golden/record-replay fixtures in CI.

## Milestone acceptance

| Milestone | Done when |
| --- | --- |
| **M0 contracts** | Every contract has round-trip (parse→serialize) tests; valid and invalid fixtures for `CompositionSpec`; catalog prop schemas reject unknown components/props. |
| **M1 static render** | Hardcoded A2UI message fixtures render each catalog component with correct data bindings (@testing-library/react). |
| **M2 shell + logging** | Pin/hide/expand/reorder apply instantly; reducer invariant *pinned cards stay on top* holds under property tests; every manipulation is logged with the correct `context.compositionId`. |
| **M3 orchestrator** | Chat input → real gateway tool calls → LLM `CompositionSpec` → rendered cards. Validation pipeline rejects unknown components, unknown `entityId` (hallucinated data), and non-gateway URLs. `expand()` is byte-deterministic for a fixed input. |
| **M4 closed loop** | `summarize()` is deterministic and within the token cap; the pinned-preservation invariant is enforced server-side regardless of LLM output; persona switch is a working composition point. |
| **M5 public** | `pnpm demo:replay` reproduces the scenario; error recovery keeps the prior composition; safety-boundary lint passes; README quick-start reproduces for a third party. |

## `trace → composition` verification (three layers)

The central claim — *interaction reshapes the UI* — is verified at three levels
so it is reproducible, not anecdotal:

1. **Deterministic layer (CI, no LLM).** Fixed trace fixtures A (no
   manipulation) vs B (pin card X + hide card Y + reorder) → `summarize()` output
   diff is a snapshot test asserting exactly those signals surfaced.
2. **Contract layer (CI, LLM replay).** With a recorded LLM response, assert the
   resulting `CompositionSpec` (a) keeps pinned cards, (b) does not resurface
   hidden entities, (c) cites the relevant trace signal in each `rationale`. The
   server-side pinned-preservation invariant is tested independently of LLM
   output.
3. **Live layer (manual / nightly, real API).** `pnpm demo:replay` injects a
   fixed scripted scenario (query → pin/hide/reorder → re-query) and **diffs the
   resulting composition against a control run that skips the manipulation
   steps.** The delta (pinned position preserved, hidden entity absent,
   deadline list surfaced) is the demo and the prototype of a study
   manipulation-check. Every run's `InteractionEvent` JSONL is the reproduction
   artifact.

## Safety-boundary checks (automated)

- Every rendered external link is a subset of the URL set returned by the
  gateway (no model-invented URLs).
- No free-text is logged except `query.submit.text`.
- UI copy contains no definitive-eligibility phrasing ("you qualify"); copy is
  centralized and lint-tested against a banned-phrase list.
