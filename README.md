# genui-canvas

Interaction-driven generative UI for the
[`orca-svg/mcp-gateway-genui`](https://github.com/orca-svg/mcp-gateway-genui)
public-benefit MCP gateway.

The gateway remains deterministic and LLM-free. `genui-canvas` searches its
typed benefit data, lets a provider select from a strict semantic card catalog,
expands the selection into a bounded A2UI message subset, and gives the user
immediate control over the resulting canvas.

> **Current status: fixture-backed research prototype.** The installed
> `@mcp-gen-ui/mcp-server@0.2.0` entry currently serves fixture data. Results are
> candidates, not eligibility decisions; relative relevance scores are not
> probabilities. A gateway-provided link is not called official unless a future
> gateway contract supplies verified-link provenance. Do not use this build for
> production benefit coverage or automated applications.

## Interaction model

- A query submit or persona switch is a **composition point**. The server calls
  the gateway and then the selected rule-based or BYOK provider.
- Pin, hide, preview/expand, keyboard reorder, and their undo/redo are
  deterministic local operations. They do not call a model or wait for the
  network.
- Every accepted action is a bounded, structured event. The next composition
  reads a server-derived trace; the client cannot replace that summary.
- Server invariants preserve hidden, pinned, and explicitly reordered cards
  even when a provider ignores the user's manipulation.
- Failed recomposition keeps the previous canvas and records a
  `composition.rejected` event when the trace endpoint remains available.

The model does not write markup or URLs. It sees only opaque IDs, enums, ranks,
relative scores, allowed component references, and bounded trace flags. Raw
query text, profile strings, benefit titles/summaries, and URLs remain outside
the model instruction channel and are joined after strict validation.

## Trusted semantic catalog

| Component | Trusted gateway result | Purpose |
| --- | --- | --- |
| `BenefitCard` | `searchBenefits` | Candidate summary, status, relative score, reasons, missing information |
| `ScoreBreakdown` | `searchBenefits` | Transparent relative-ranking dimensions |
| `Checklist` | `buildChecklist` | Required/optional preparation items and caveats |
| `DeadlineList` | `getUpcomingDeadlines` | Dated candidate deadlines with uncertainty intact |
| `PersonaSelector` | `listPersonas` | Visible ranking-weight presets; never an eligibility switch |
| `SourceNotice` | `getBenefitDetail` | Gateway source, fetch time, and user-verification notice |

The deterministic expander emits only A2UI v0.9 `Column` and `Text` primitives.
The wire contract rejects unknown catalogs/components before rendering, and all
display text is HTML-escaped. The repository intentionally pins v0.9 because
that is what its installed renderer supports; [A2UI v0.9.1 is the current
production release](https://a2ui.org/), so an upgrade requires an explicit
cross-package protocol test.

## Architecture

```text
apps/web (Vite + React)               apps/server (Hono)
  ├─ query + persona controls           ├─ server-issued session / strict event API
  ├─ deterministic shell reducer        ├─ MCP stdio client ─▶ @mcp-gen-ui/mcp-server
  ├─ accessible CardFrame controls      ├─ strict output cache + semantic projection
  └─ validated SSE/A2UI client ◀────────┤─ rule-based or BYOK Gemini provider
                                        └─ trace store + server-side summarizer

packages/contracts                     packages/renderer
  ├─ strict Zod domain/wire schemas      ├─ A2UI v0.9 processor
  └─ gateway package re-exports          └─ escaped basic-catalog rendering
```

The canvas consumes the gateway's published npm packages; it does not fork or
modify the gateway repository. Required gateway changes are handed off in
[`docs/gateway-requirements.md`](docs/gateway-requirements.md).

## Quick start

Requirements: Node.js `>=22.5` and pnpm `10.17.1`.

```bash
pnpm install --frozen-lockfile
pnpm verify
```

`pnpm verify` performs real type/static safety checks, all tests, production
builds, and the deterministic HTTP trace replay. Tests spawn the published
fixture gateway over local MCP stdio; they make no external data request and
need no LLM key.

Run the application in two terminals:

```bash
# Terminal 1 — Hono orchestrator on http://localhost:8787
pnpm --filter @genui-canvas/server dev

# Terminal 2 — Vite SPA on http://localhost:5180
pnpm --filter @genui-canvas/web dev
```

Enter a benefit query or use a sample scenario. Manipulate cards locally, then
select **조작 반영해 재구성** to pass the persisted trace into the next
composition.

## Provider configuration (BYOK)

No key is committed or bundled. With no configuration the server uses the
deterministic rule-based provider. To opt into Gemini, copy
`apps/server/.env.example` to the gitignored `apps/server/.env`:

```dotenv
LLM_PROVIDER=gemini
GEMINI_API_KEY=your-own-key
GEMINI_MODEL=gemini-flash-latest
```

The default follows the requested `gemini-flash-latest` alias documented on
[Google's model page](https://ai.google.dev/gemini-api/docs/models). Google
documents that a `latest` alias can move to a stable, preview, or experimental
release. This prototype does not persist Gemini's resolved `modelVersion`, so
controlled-experiment operators must record the resolved version and date
separately.
The Gemini response is still treated as untrusted and must pass the same strict
catalog, reference, and order validation.

## Reproduce the closed loop

```bash
pnpm demo:replay "서울 대학생 지원"
```

The default replay is deterministic and key-free. It passes through actual
Hono session, event, and turn routes, persists this sequence, and checks that
the second provider request received the server-derived summary:

```text
query.submit → composition.applied → card.pin → card.hide
→ card.reorder → card.expand → query.submit → composition.applied
```

It fails unless the pinned card moves first, the hidden card stays absent, the
order changes, and the trace closes the loop. To investigate a locally
configured model separately (not a CI/reproduction gate):

```bash
pnpm --filter @genui-canvas/server demo:replay:live -- "서울 대학생 지원"
```

## Privacy and safety boundary

- Session IDs are server-issued UUIDs; path traversal, unknown sessions,
  sequence gaps, and different duplicate events are rejected.
- Exact retry of an already accepted immutable event is idempotent, supporting
  response-loss recovery without duplicate trace rows.
- Only `query.submit.text` may contain user-authored free text, bounded to 300
  characters. Other event payloads are type-specific and strict. Do not enter
  personal identifiers in a query.
- Unknown profile fields are rejected; the schema has no name, resident number,
  email, phone, detailed address, credential, login, or submission field.
- Local traces default to `apps/server/data/sessions` and are gitignored. The
  application performs no login, identity verification, or application submit.
- CORS is an explicit allowlist; internal provider errors and rejected model
  output are not returned to the browser.
- HTTPS source links are opened by the user in a new tab with opener isolation.

## Verification and research claims

- [`docs/verification.md`](docs/verification.md) — executable gates, test layers,
  browser checks, and known limitations.
- [`docs/research-grounding.md`](docs/research-grounding.md) — primary research,
  implementation mapping, and claim boundaries. The requested venue gist is
  used only as a secondary filter, not as evidence.
- [`docs/gateway-requirements.md`](docs/gateway-requirements.md) — P0/P1/P2
  gateway contracts and acceptance tests for the other repository's developer.

## License

[Apache-2.0](LICENSE)
