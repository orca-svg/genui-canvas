# genui-canvas

**Interaction-driven generative UI environment** for the
[`mcp-gen-ui-gateway`](https://github.com/orca-svg/mcp-gateway-genui) public-benefit MCP server.

Most "generative UI" today means *the model writes text and maybe picks a
component*. genui-canvas asks a sharper question: **what if every
interaction — not just chat, but pinning, hiding, expanding, reordering
cards — becomes an input that reshapes the interface?** The gateway supplies
deterministic, auditable public-benefit data; genui-canvas turns that data into
a surface the user and the model co-compose.

> **Status:** pre-alpha, building toward the v1 minimal closed loop. This is a
> companion project to the gateway and consumes its published npm packages
> (`@mcp-gen-ui/*`) — it does not fork the gateway.

## The core loop

genui-canvas uses a **composition-point hybrid** adaptation model:

- **Composition points** (a new query, a persona switch) are the only moments
  the LLM (re)composes the UI. It emits a constrained declarative spec, not raw
  markup.
- **Fine-grained manipulations** (pin / hide / expand / reorder) apply
  **deterministically and instantly** in the shell, and are structured-logged.
- The **accumulated interaction trace** feeds the *next* composition — so the
  UI adapts to how you actually used it (`trace → composition`).

The gateway stays **LLM-free**; the intelligence lives here, outside it. The LLM
never hand-writes UI: it selects from a **trusted component catalog** (Google
[A2UI](https://github.com/google/A2UI) declarative JSON — "safe like data,
expressive like code"), and the server deterministically expands the spec with
real tool-result data. Recommendations remain **candidates, not eligibility
decisions**, and no sensitive identifiers, logins, or submissions are ever
handled.

## Architecture

```
apps/web (Vite SPA)                    apps/server (Hono orchestrator)
  ├─ shell: CardFrame                    ├─ mcp/gateway-client ─▶ @mcp-gen-ui/mcp-server (stdio)
  │   (pin/hide/expand/reorder)          ├─ llm/composer (Anthropic tool-use loop)
  ├─ chat + persona switch               ├─ composition/{validate,expand,tool-cache}
  └─ SSE client ◀──────── SSE ───────────┤   (CompositionSpec → A2UI messages)
                                         └─ trace/{store,summarize}  (InteractionEvent JSONL)
        packages/renderer (A2UI catalog)     packages/contracts (shared types)
```

## Monorepo layout

| Package | Responsibility |
| --- | --- |
| `@genui-canvas/contracts` | Shared Zod contracts: `InteractionEvent`, `CompositionSpec`/`CompositionContext`, component catalog schemas, A2UI message types, SSE protocol. |
| `@genui-canvas/renderer` | Domain component catalog (BenefitCard, ScoreBreakdown, Checklist, DeadlineList, PersonaSelector) rendered via A2UI, with a fallback renderer consuming the same messages. |
| `apps/web` | Vite + React shell: card manipulation, chat, persona switch, SSE client, interaction logging. |
| `apps/server` | Hono orchestrator: MCP gateway client, LLM composer, composition validation/expansion, interaction-trace store. |

## Quick start

Requires **Node.js >= 22.5** and pnpm.

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

### Bring your own key (BYOK)

genui-canvas ships **no API key and no bundled provider**. You plug in your own
LLM through a small provider interface, configured entirely by environment
variables in `apps/server/.env` (gitignored — never committed, never shipped):

```bash
# Recommended zero-cost default: Google Gemini free tier
LLM_PROVIDER=gemini
GEMINI_API_KEY=your-own-free-key      # from https://aistudio.google.com/apikey

# Or bring another provider — same interface, your key:
# LLM_PROVIDER=anthropic
# ANTHROPIC_API_KEY=your-own-key
```

The gateway MCP server is spawned automatically from the published
`@mcp-gen-ui/mcp-server` package — it is **LLM-free**, so it needs no key of its
own. Deploying genui-canvas deploys only the code; each operator supplies their
own LLM credentials at run time.

## Verification

See [`docs/verification.md`](docs/verification.md) for the acceptance criteria of
each milestone and the three-layer `trace → composition` verification (including
the `pnpm demo:replay` manipulation-check that compares a composition with and
without the intervening manipulations).

## Research grounding

- *Generative and Malleable User Interfaces with a Task-Driven Data Model* (CHI 2025) — composition-point loop, task-driven spec.
- *Generative Interfaces for Language Models* (arXiv:2508.19227) — generative interfaces beyond chat.
- Google **A2UI** — declarative agent-to-UI JSON with a trusted component catalog.
- Horvitz, *Principles of Mixed-Initiative User Interfaces* — balancing user manipulation and system proposal.

## License

[Apache-2.0](LICENSE).
