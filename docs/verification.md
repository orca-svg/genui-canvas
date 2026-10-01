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

Tests spawn `@mcp-gen-ui/mcp-server@0.3.0` over local stdio in explicit fixture
mode. No external data request or LLM key is needed. Node
may print its expected experimental SQLite warning; this is not a test failure.

## Acceptance matrix

| Area | Automated evidence required |
| --- | --- |
| Contracts | Strict valid/invalid fixtures for `CompositionSpec`, exact card/order set, component↔tool discriminants, opaque IDs, bounded query/profile/trace, type-specific interaction payloads, HTTPS source metadata, and the supported A2UI subset. |
| Renderer | Escaped A2UI text renders; empty/late surfaces work; shell order and hidden filtering work; candidate groups render their cards into fixed columns with the chrome before the body and a missing column kept as an empty cell; preview/expanded wrappers and IDs remain stable; tests finish without React `act` warnings. |
| Interactive catalog | Wire schema accepts only `Card`/`Column`/`Row`/`Divider`/`Text`, `Button` with a named canvas action, and `CheckBox` bound to a path; renderer relays Button actions and CheckBox edits to the shell and writes shell-owned values back; the shell re-validates every action before mapping it to `persona.switch`. |
| Shell UX | Custom query and persona are composition points; pin/hide/expand/reorder are immediate and act on the candidate row (drag handle, on-card buttons that are always visible, P/H/E on a focused row, or the card list); pinned-first invariant holds and pinned rows move only among pinned rows; exactly one DragOverlay runs per drop, so a dropped row is never left dimmed; a hide from the card or with H leaves a six-second 되돌리기 strip that takes focus, and a hide from the card list does not; the card list opens 150ms after the pointer rests on the edge, closes 400ms after it leaves, stays open when locked, and leaves keyboard focus alone on a hover open; manipulation acknowledgement is serialized before recomposition; failure preserves the previous canvas; the notice line names the gateway's data mode, composer, and fallback from the session response, and a composition composed by the fallback says so. |
| Trace/API | Server-issued UUID session, no path traversal, seq starts at zero, gap/different duplicate rejected, exact retry idempotent only while the retried event is still the session's latest row (ends when a turn's `tool.called` row lands), sequence conflicts return the server's `nextSeq` for one client re-sync retry, unknown sessions rejected, request objects strict, error details hidden, CORS allowlisted. |
| Trace bookkeeping | `session.start` at seq 0, one `tool.called` per turn, `nextSeq` on terminal events, client events continue the server sequence, bookkeeping rows excluded from the provider's recent history. |
| Gateway boundary | Published v2 Zod schemas validate every response; malformed or unsupported versions fail visibly; `structuredContent` must deep-equal the JSON TextContent fallback. |
| Model boundary | Prompt contains no raw query, title, summary, URL, or profile string; only safe semantic projection; strict structured output and hallucinated references are rejected; the streamed intent sentence passes the same markup/URL and definitive-eligibility rule as card rationales or is omitted. |
| Provider fallback | When a fallback provider is configured, a primary that throws, exceeds the 12-second timeout, or returns an invalid spec is logged with its cause and the rule-based provider composes the turn; the composition frame carries `composedBy` with `fallbackFrom`; without a fallback the primary's behaviour is unchanged; `/api/session` reports `gateway.provider`, `fallbackProvider`, `dataMode`, and the MCP handshake `version`. |
| Manipulation invariants | Hidden cards never enter the visible order but ship in a hidden tail the shell can unhide; pinned cards cannot be dropped/buried; explicit reorder survives; the visible order is grouped by candidate (`PersonaSelector` first, pinned groups next, fixed `BenefitCard → ScoreBreakdown → Checklist → SourceNotice` inside a group) — `enforce.test.ts`'s `candidate groups` suite proves this per-composition, and the CI replay's `groupedOrderPreserved` proves it holds on both the control and the manipulated composition of a live turn pair; `DeadlineList` last regardless of pin state (pinning it only guarantees it stays present) is proven by `enforce.test.ts`'s "keeps a pinned DeadlineList present but still last even though the provider led with it" and "restores a pinned DeadlineList the provider omitted entirely, placing it last" — the replay's fixture never pins `DeadlineList`, so it doesn't exercise that case; expanded → Checklist+SourceNotice, pinned → ScoreBreakdown, ticked rows keep Checklist; deterministic expansion preserves trusted tool data. |
| Trust copy | Scores say “relative relevance, not eligibility probability”; `conflict_detected` remains a candidate-level verification warning; source health/freshness and non-adjudication caveats remain visible; no definitive eligibility wording. |
| CI replay | Actual session→event→turn routes persist the full eleven-event sequence (including `session.start` and `tool.called` bookkeeping rows) and the second provider request observes server-derived pin/hide/reorder/expand signals. |

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
- server enforcement restores pins, moves hidden semantic cards to the hidden
  tail, and rebuilds the visible order by candidate group (pinned groups, then
  the user's order) on every composition, not only after a manipulation, even
  for a non-compliant provider;
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
- `subCardsComposed`
- `groupedOrderPreserved`

It must persist these types in this order:

```text
session.start
query.submit
tool.called
composition.applied
card.pin
card.hide
card.reorder
card.expand
query.submit
tool.called
composition.applied
```

`observedTraceSummary.turnCount` must be `2`; its ordering signal must be true;
the pinned and hidden entity flags must match the scripted actions.
`controlComponentTypes` must be `["BenefitCard", "DeadlineList"]` and
`manipulatedComponentTypes` must add `Checklist`, `ScoreBreakdown`, and
`SourceNotice`. This is not a direct state→composer injection: session
validation, event persistence, server summarization, SSE contract parsing, and
both HTTP turns are exercised.

The optional `demo:replay:live` is diagnostic only and must never replace the
deterministic release gate.

## Browser and accessibility gate

Automated tests are necessary but insufficient. Before a public demo, run the
app and record evidence for both a desktop viewport and a `320×568` or `390×844`
mobile viewport.

Required manual/browser checks:

1. No horizontal document overflow at 320 CSS pixels and 400% zoom; the toolbar
   wraps onto several lines above the canvas and the candidate rows stack into
   one column.
2. Tab order begins with the visible-on-focus “추천 결과로 건너뛰기” link,
   then the toolbar controls (scenarios, search, 추천 관점, history, 재구성;
   Tab lands on one roving toolbar item, then the 추천 관점 select, and Arrow
   keys move among the toolbar items), the candidate rows with their card
   controls and source links, and the 카드 목록 handle, logically.
3. Every action has a visible focus ring. Reorder works without drag: by
   keyboard on the handle (item 15) or with 위로 이동 / 아래로 이동 in the card
   list. 더 알아보기 has `aria-controls` and `aria-expanded`.
4. Status changes are announced politely without moving focus. A failed turn
   leaves existing cards visible and provides a recovery instruction.
5. Canvas buttons are at least 44 CSS pixels tall (`min-height: 2.75rem`) at
   the mobile breakpoint; the CheckBox box grows to 24 CSS pixels there
   (`1.5rem`, up from 20 CSS pixels on desktop). Toolbar and card controls meet
   the same 44-CSS-pixel (`2.75rem`) target at that breakpoint: every toolbar
   button, the search input, and the persona `select` get
   `min-height: 2.75rem`; the on-card buttons and 출처 link get
   `min-height: 2.75rem` and the drag handle is `2.75rem` square; and each
   card list entry's action buttons (`[data-slot="attachment-action"]`) and
   source link get both `min-width` and `min-height: 2.75rem` (`styles.css`'s
   `@media (max-width: 48rem)` blocks).
6. Long Korean titles, URLs, caveats, and 200% text spacing do not overlap or
   become inaccessible.
7. Reduced-motion preference removes non-essential transitions.
8. A source link opens the exact structured HTTPS metadata URL in a new tab with
   `noopener noreferrer`; only `official: true` links receive an official-source
   label, and stale/unchecked health remains visible.
9. Keyboard and VoiceOver/NVDA users can identify query, persona, result region,
   card state, reorder, hide/unhide, pin/unpin, and expand/collapse actions.
10. Browser console contains no application errors during query, manipulation,
    recomposition, persona switch, source opening, and simulated server failure.
11. Persona buttons inside a `PersonaSelector` card are reachable by keyboard,
    have a visible focus ring, and meet the button target from item 5.
    Checklist CheckBoxes are reachable by keyboard and show a 3-CSS-pixel
    focus ring even though their box stays below that target. Clicking a
    persona button changes the toolbar's 추천 관점 control to the same value
    and starts a composition.
12. After "조작 반영해 재구성", a card hidden earlier still appears in the
    card list as hidden and "다시 보기" shows it immediately.
13. At 1920 CSS pixels the canvas spans the viewport width inside the page
    padding; a candidate with a `ScoreBreakdown`, `Checklist`, or
    `SourceNotice` is one row with those cards in aligned columns, while a
    candidate with nothing composed beside its `BenefitCard` gives the card
    the whole row width; empty slots draw nothing, and one line under the row
    names what the next recomposition adds ("고정 후 재구성 → 점수 분석" on an
    unpinned candidate, "재구성 → 점수 분석" once it is pinned, "재구성 →
    체크리스트·출처 안내 · 고정 후 재구성 → 점수 분석" on an expanded unpinned
    one; a row without a `BenefitCard`, or with nothing pending, shows no
    line).
14. Dragging a row by its handle shows a ghost and a placeholder; dropping it
    records one `card.reorder`; a pinned row cannot be dropped among unpinned
    rows (the placeholder stops and the hint "고정된 카드는 고정 그룹 안에서만
    이동합니다" appears).
15. Keyboard reorder: focus the handle, press Space, ArrowDown, then Enter; the
    Korean announcement is read at each step, and Esc cancels the move.
16. P, H, and E on a focused row pin, hide, or expand it, also under a Korean
    input source; 숨기기 leaves the 되돌리기 strip in the row's place for six
    seconds, with focus on 되돌리기.
17. Resting the pointer on the right edge opens the card list after about
    150ms; leaving closes it after about 400ms; 열어 두기 keeps it open; the
    카드 목록 handle toggles it; Esc closes it.
18. Under 48rem the rows stack, the card buttons stay visible and are at least
    44 CSS pixels tall (item 5), and the card list is a bottom sheet opened from
    the toolbar's 카드 목록 button; the edge handle is not shown.
19. With `prefers-reduced-motion: reduce`, these are off: the drawer and
    handle slide, the row-shift transitions while dragging, the dragged
    ghost's drop animation (the overlays pass `dropAnimation={null}`; dnd-kit
    plays it through the Web Animations API, which CSS cannot reach), and the
    fade of the jump flash; the card list's jump scrolls instantly.
20. A hover-open of the card list leaves keyboard focus where it was; a
    handle or toolbar open moves focus into the list.
21. Sub-card bodies are never clipped: at 1440 and 1024 CSS pixels, a
    candidate that was expanded and pinned and then recomposed shows its
    `ScoreBreakdown`, `Checklist`, and `SourceNotice` in full (only a
    collapsed `BenefitCard` or band is capped at an 18rem preview).
22. The 카드 목록 handle does not cover a canvas column: above 48rem it is a
    vertical tab no wider than 2rem inside the page's right padding, which is
    at least 2.5rem there.
23. 고정/고정 해제, 숨기기, and 출처 are visible on every candidate card
    without hovering or focusing it, at 1440px and at 375px.
24. After a mouse drag and after a keyboard drag (Space, arrow, Enter), the
    dropped row's computed opacity is 1 once the drop animation ends; no
    inline `opacity` remains on `.canvas-row-item`.
25. A collapsed `BenefitCard` preview shows the title, agency, status, the
    whole summary, and the one-line score before the 18rem clip; no 점수 근거
    text appears on the BenefitCard at any width.
26. The notice line reads the session response: with the rule-based provider
    it says "추천 구성은 규칙 기반입니다", and with `LLM_PROVIDER=gemini` plus
    a failing key the composition still arrives and the status line ends with
    "Gemini 응답을 받지 못해 규칙 기반으로 구성했습니다."

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
- Because server-originated rows (`session.start`, `tool.called`) share the
  session sequence, "exact retry is idempotent" holds only while the retried
  event is still the session's latest row; a turn's `tool.called` row ends
  that window. The web client awaits the triggering event's
  acknowledgement before starting a turn and disables every manipulation
  control while a turn is busy. If the turn's response is still lost (timeout
  or dropped stream) after the server recorded `tool.called`, the client's
  next event receives a sequence-conflict reply carrying `nextSeq`; the client
  re-synchronises from it and retries that event once. An identity conflict
  carries no `nextSeq` and is never retried.

## Current claim limits

Passing this gate proves the fixture-backed prototype's contract, safety
boundary, deterministic manipulation, and replay behavior. It does **not**
prove:

- live benefit coverage, source completeness, or current eligibility data;
- live verification continuity for every configured government source or the
  current completeness of a deliberately bounded adapter page;
- user task success, accessibility for disabled participants, appropriate
  reliance, fairness, or take-up improvement;
- live-model quality, latency, availability, or reproducibility;
- A2UI v0.9.1 or v1.0 conformance.

Those gaps and the required study are documented in
[research-grounding.md](research-grounding.md). Gateway producer work is in
[gateway-requirements.md](gateway-requirements.md).
