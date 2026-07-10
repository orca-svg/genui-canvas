# Research grounding and claim boundaries

Reviewed: 2026-07-10 (Asia/Seoul)

This document explains which research informed `genui-canvas`, what was actually
implemented, and what the cited work does **not** prove. It is not a claim that
this prototype improves access to public benefits; that requires the user study
and operational evidence described below.

## Source-selection method

The requested [Pusnow venue gist](https://gist.github.com/Pusnow/6eb933355b5cb8d31ef1abcb3c3e1206)
is a personal conference-ranking CSV, not a paper list, peer-review record, or
quality guarantee. It was used only as a secondary venue filter. Paper identity,
publication status, methods, and limitations were checked against primary
publisher, proceedings, standards-body, or author sources.

Venue prestige does not replace problem fit, reproducibility, representative
participants, or external validity. In particular, a CHI Extended Abstract is
not treated as a CHI full paper, and the IAAI deployed-application track is not
silently treated as the general AAAI technical track.

## Evidence-to-implementation matrix

| Primary source | Relevant finding | Implemented response | Claim boundary |
| --- | --- | --- | --- |
| [Jelly: *Generative and Malleable User Interfaces with Generative and Evolving Task-Driven Data Model*, CHI 2025](https://doi.org/10.1145/3706598.3713285) | Natural language and direct manipulation can update an evolving intermediate task model. | `CompositionSpec`, stable card/entity references, deterministic shell state, trace events, and composition points separate local edits from model recomposition. | Jelly's exploratory study had eight participants. This project does not implement its full object relationship/dependency model, and “composition point” is this project's design choice. |
| [DynaVis, CHI 2024](https://doi.org/10.1145/3613904.3642639) | Persistent widgets enabled rapid, repeated direct edits and were preferred over NLI-only editing in a 24-person visualization study. | Pin, hide, expand/collapse, and keyboard reorder are local reducer operations; the model/network is called only at a composition point. | The local-action target of p95 `<100 ms` is a project QA threshold, not a number reported by DynaVis. Public-benefit discovery is a different task. |
| [*Generative Interfaces for Language Models*, Findings of ACL 2026](https://aclanthology.org/2026.findings-acl.74/) | GenUI was evaluated across query-interface consistency, task efficiency, usability, learnability, information clarity, aesthetics, and interaction satisfaction. | The UI exposes query, persona, status, source, rationale, and reversible manipulation paths; the seven dimensions are retained as future study outcomes. | The paper does not show that every query benefits from GenUI, nor that an attractive generated UI is correct. This project still lacks a chat/static/GenUI routing experiment. |
| [UICrit, UIST 2024](https://doi.org/10.1145/3654777.3676381) | Structured expert critique data improved LLM UI feedback. | Release QA includes reflow, focus, contrast, status, readable labels, and button/keyboard checks; browser inspection complements automated tests. | An LLM or automated accessibility checker is not the sole release oracle. |
| [Appropriate Reliance, CSCW 2024](https://doi.org/10.1145/3637318) | Calibrated uncertainty displays alone did not eliminate over-reliance on wrong advice. | Scores are labeled “relative relevance, not eligibility probability”; `not_applicable` is displayed as a possible constraint conflict; candidate and source-verification notices remain adjacent to results. | A medical decision study cannot be directly generalized to Korean public benefits. It motivates a reliance test; it does not validate this wording. |
| [Prompt Injection Benchmark, USENIX Security 2024](https://www.usenix.org/conference/usenixsecurity24/presentation/liu-yupei) | Prompt-injection attacks and defenses require systematic evaluation. | Raw query text, benefit title/summary, profile strings, and URLs are excluded from the model prompt. Only bounded opaque IDs, enums, ranks, scores, component references, and trace flags are projected. Hostile-text regression tests protect the boundary. | String filtering is not presented as a complete defense. |
| [StruQ, USENIX Security 2025](https://www.usenix.org/conference/usenixsecurity25/presentation/chen-sizhe) | Separating instruction and data channels can improve prompt-injection resistance. | Gateway display data is cached outside the provider prompt and joined deterministically only after schema/reference validation. Opaque entity IDs have a restricted grammar. | A closed commercial model is not assumed to provide StruQ's trained-model guarantee. |
| [Wello and the Korean Government, IAAI 2025](https://ojs.aaai.org/index.php/AAAI/article/view/35140) | A deployed Korean benefit recommender reports Recall/NDCG results using large interaction and document datasets. | The project documents Recall/NDCG and application outcomes as future metrics, while keeping the present gateway deterministic and LLM-free. | No learning-based ranking is justified without consent, ground truth, retention/deletion controls, and subgroup fairness evaluation. |
| [Horvitz, *Principles of Mixed-Initiative User Interfaces*, CHI 1999](https://doi.org/10.1145/302979.303030) | System initiative should be balanced with understandable user control. | System composition proposals coexist with immediate user manipulation; server invariants prevent a provider from undoing pin, hide, and explicit reorder intent. | This is a design principle, not empirical proof of this product's usability. |

## Protocol and standards basis

- [A2UI](https://a2ui.org/) currently identifies v0.9.1 as the production
  release and v1.0 as candidate. This repository intentionally pins the v0.9
  basic catalog supported by its installed renderer, validates the exact
  `createSurface`, `updateComponents`, and `updateDataModel` subset, and does
  not claim v0.9.1 conformance. Upgrade requires a cross-package protocol test.
- [MCP revision 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
  defines `outputSchema`, `structuredContent`, and tool annotations. The canvas
  validates today's text JSON and is ready to cross-check structured/text
  equality; the gateway work needed to publish those outputs is specified in
  [gateway-requirements.md](gateway-requirements.md).
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/) informs 320 CSS-pixel reflow,
  non-drag reorder controls, visible focus, status announcement, target sizing,
  and reduced-motion handling. Automated checks must be supplemented with
  keyboard and screen-reader inspection.
- [NIST AI 600-1](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence)
  informs provenance, pre-deployment testing, red teaming, monitoring, and
  recourse. It is voluntary risk guidance, not a compliance certificate.
- [OECD, *Modernising Access to Social Protection* (2024)](https://www.oecd.org/en/publications/modernising-access-to-social-protection_af31746d-en.html)
  supplies domain context on take-up, exclusion, discrimination, and trust; it
  is not a ranking-model validation study.

## What is verified in the repository

1. Direct manipulations update the shell immediately and do not call the model.
2. A server-issued UUID session and monotonic event sequence back every trace;
   exact event retries are idempotent and different duplicate/gap events fail.
3. `pnpm demo:replay` passes through Hono HTTP session/event/turn endpoints,
   persists eight events, verifies the second provider request received the
   server-derived trace, and checks pin/hide/reorder effects.
4. Gateway tool outputs are parsed with the shared published Zod contracts.
   If future MCP `structuredContent` is also present it must equal the text
   fallback exactly.
5. The provider sees no raw user query, gateway title/summary, profile string,
   or URL. Its result must satisfy strict component/tool/entity/order schemas.
6. A2UI is reduced to trusted `Column` and `Text` primitives, all gateway text
   is HTML-escaped, and model-produced URLs/HTML are impossible by contract.
7. Scores and statuses are framed as candidate-ranking signals, and the UI
   does not call a gateway URL “official” without a future verification field.

The authoritative executable checks are in [verification.md](verification.md).

## Known evidence gaps

- The installed gateway MCP entry currently serves fixtures. No claim about
  live benefit coverage, timeliness, recall, or official-source availability is
  supported.
- The gateway v0.2 summary contract lacks field-level provenance, source
  health, verified-link state, and freshness on every search result. The canvas
  must fetch detail per candidate and labels links as gateway-provided.
- There is no completed comparative user study, accessibility participant
  study, deployment outcome, or calibrated reliance experiment.
- The project has not measured the local-action p95 threshold in a browser lab;
  the reducer and visual behavior are functionally tested.
- Composition-level diff history, GenUI necessity routing, and
  feedback/recourse remain product-research work. Local card manipulations now
  have tested undo/redo with inverse trace events.

## Required product study before effectiveness claims

Compare at least four conditions: chat-only, fixed benefit UI, GenUI without
visible trace/provenance, and GenUI with trace/provenance and reversible edits.
Pre-register primary outcomes and choose sample size using power analysis.

Measure:

- correct candidate selection, official-source visit, application-step
  completion, completion time, and error recovery;
- the seven ACL 2026 interface dimensions;
- score-as-probability misunderstanding, response to a deliberately wrong top
  result, source/freshness recall, and verification choice under uncertainty;
- schema rejection, fallback success, source-partial display accuracy, and
  model latency;
- keyboard-only and screen-reader task completion at 320 CSS pixels;
- failure rates for relevant demographic and disability subgroups.

Include Korean benefit seekers and users with low vision, screen-reader use, or
motor constraints. Publish negative results and rollback criteria; do not use
Jelly's exploratory sample size as the target.
