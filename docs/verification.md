# Verification criteria

This file is the public release gate. `.claude/` and `.agents/` are local,
gitignored harnesses and are not authoritative.

## One-command automated gate

```bash
pnpm install --frozen-lockfile
pnpm verify
```

`pnpm verify` must exit zero and performs, in order:

1. `pnpm lint`
   - strict TypeScript checks for every package;
   - built-in tests for the safety-policy scanner;
   - source inspection for raw HTML/eval, browser persistence, definitive
     eligibility copy, raw display text entering the model prompt, unsafe
     `_blank` links, credential-like strings, tracked `.env`, and tracked local
     harness files.
2. `pnpm test`
   - contract, renderer, server, and web Vitest suites.
3. `pnpm build`
   - production compilation/bundling for every workspace package.
4. `pnpm demo:replay`
   - deterministic, key-free, real Hono HTTP + MCP fixture replay.

CI also runs `git diff --check`. The Linux CI job has read-only repository
permissions and a 15-minute timeout.

Tests spawn `@mcp-gen-ui/mcp-server@0.2.0` over local stdio. That published
entry serves fixtures, so no external data request or LLM key is needed. Node
may print its expected experimental SQLite warning; this is not a test failure.

## Acceptance matrix

| Area | Automated evidence required |
| --- | --- |
| Contracts | Strict valid/invalid fixtures for `CompositionSpec`, exact card/order set, component↔tool discriminants, opaque IDs, bounded query/profile/trace, type-specific interaction payloads, HTTPS source metadata, and the supported A2UI subset. |
| Renderer | Escaped A2UI text renders; empty/late surfaces work; shell order and hidden filtering work; preview/expanded wrappers and IDs remain stable; tests finish without React `act` warnings. |
| Shell UX | Custom query and persona are composition points; pin/hide/preview/reorder are immediate; pinned-first invariant holds; manipulation acknowledgement is serialized before recomposition; failure preserves the previous canvas. |
| Trace/API | Server-issued UUID session, no path traversal, seq starts at zero, gap/different duplicate rejected, exact retry idempotent, unknown sessions rejected, request objects strict, error details hidden, CORS allowlisted. |
| Gateway boundary | Current TextContent JSON is parsed with published gateway Zod schemas; malformed output fails; future `structuredContent` must deep-equal the text fallback. |
| Model boundary | Prompt contains no raw query, title, summary, URL, or profile string; only safe semantic projection; strict structured output and hallucinated references are rejected. |
| Manipulation invariants | Hidden cards cannot be resurfaced, pinned cards cannot be dropped/buried, explicit reorder survives, and deterministic expansion preserves trusted tool data. |
| Trust copy | Scores say “relative relevance, not eligibility probability”; `not_applicable` is a possible conflict; candidate/source-verification caveats remain visible; no definitive eligibility wording. |
| CI replay | Actual session→event→turn routes persist the exact eight-event sequence and the second provider request observes server-derived pin/hide/reorder/expand signals. |

## Closed-loop proof

The central claim is tested at three levels.

### 1. Deterministic state and trace

- reducer tests prove pin/hide/expand/reorder behavior and pinned-first order;
- trace tests prove deterministic summarization, bounded recent history,
  engagement flags, and ordering signal;
- event contracts reject payloads outside the privacy allowlist.

### 2. Provider and server invariants

- provider tests prove score-default ordering and user-reorder preservation;
- validation rejects unknown component/tool/entity/order/prop fields;
- server enforcement restores pins, removes hidden semantic cards, and applies
  current semantic order even for a non-compliant provider;
- hostile gateway display text cannot alter the model prompt projection.

### 3. HTTP persisted replay

```bash
pnpm demo:replay "서울 대학생 지원"
```

The replay must report all of the following as `true`:

- `httpBoundaryVerified`
- `traceClosedLoop`
- `pinnedMovedToTop`
- `hiddenRemoved`
- `orderChanged`

It must persist these types in this order:

```text
query.submit
composition.applied
card.pin
card.hide
card.reorder
card.expand
query.submit
composition.applied
```

`observedTraceSummary.turnCount` must be `2`; its ordering signal must be true;
the pinned and hidden entity flags must match the scripted actions. This is not
a direct state→composer injection: session validation, event persistence,
server summarization, SSE contract parsing, and both HTTP turns are exercised.

The optional `demo:replay:live` is diagnostic only and must never replace the
deterministic release gate.

## Browser and accessibility gate

Automated tests are necessary but insufficient. Before a public demo, run the
app and record evidence for both a desktop viewport and a `320×568` or `390×844`
mobile viewport.

Required manual/browser checks:

1. No horizontal document overflow at 320 CSS pixels and 400% zoom; the sidebar
   becomes a normal block above the result canvas.
2. Tab order begins with the visible-on-focus “추천 결과로 건너뛰기” link,
   then query, persona, scenarios, source links, and card controls logically.
3. Every action has a visible focus ring. Reorder works with the up/down buttons
   without drag. The expand button has `aria-controls` and `aria-expanded`.
4. Status changes are announced politely without moving focus. A failed turn
   leaves existing cards visible and provides a recovery instruction.
5. Touch targets are at least 44 CSS pixels at the mobile breakpoint.
6. Long Korean titles, URLs, caveats, and 200% text spacing do not overlap or
   become inaccessible.
7. Reduced-motion preference removes non-essential transitions.
8. A source link opens the exact HTTPS metadata URL in a new tab with
   `noopener noreferrer`; it is labeled “출처 페이지,” not verified official.
9. Keyboard and VoiceOver/NVDA users can identify query, persona, result region,
   card state, reorder, hide/unhide, pin/unpin, and preview/expand actions.
10. Browser console contains no application errors during query, manipulation,
    recomposition, persona switch, source opening, and simulated server failure.

Retain screenshots and console/overflow measurements with the release record;
do not infer this gate from unit tests alone.

## Safety and privacy checks

- `git ls-files apps/server/.env .claude .agents` returns no sensitive/local
  artifact.
- Only `query.submit.payload.text` may contain user-authored free text and it is
  capped at 300 characters. No test should imply complete PII detection; the UI
  must tell users not to enter identifiers.
- The app never stores browser data, authenticates, performs identity
  verification, or submits an application.
- External gateway data is untrusted display text and never an instruction.
- Model output cannot introduce a URL, HTML, arbitrary component, unknown ID,
  duplicate surface, missing order entry, or wrong tool/component pair.
- Gateway/provider failures expose stable user-facing messages, not internal
  errors, upstream bodies, API keys, or paths.

## Current claim limits

Passing this gate proves the fixture-backed prototype's contract, safety
boundary, deterministic manipulation, and replay behavior. It does **not**
prove:

- live benefit coverage, source completeness, or current eligibility data;
- that a gateway link is an official or healthy link;
- user task success, accessibility for disabled participants, appropriate
  reliance, fairness, or take-up improvement;
- live-model quality, latency, availability, or reproducibility;
- A2UI v0.9.1 or v1.0 conformance.

Those gaps and the required study are documented in
[research-grounding.md](research-grounding.md). Gateway producer work is in
[gateway-requirements.md](gateway-requirements.md).
