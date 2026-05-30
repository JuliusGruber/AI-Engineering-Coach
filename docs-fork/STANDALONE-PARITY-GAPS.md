# Standalone Parity Gaps (upstream → fork)

Features that exist in the upstream extension (`microsoft/AI-Engineering-Coach`
main) but are **not yet exposed by this fork's standalone build**. Scope:
*portable* gaps only — things that could run in a browser. VS Code-only
surfaces (activity-bar sidebar, the `@aicoach` chat participant, MCP tools) and
pure infra (devcontainer, CI, dep bumps, security CSP/XSS branches) are
excluded.

**Derived & re-verified** `3a41450` (merge-base **==** upstream/main), **0 behind**;
**gap = 10** (universe 75 \ exposed 65, `parity-gap.mjs`, 2026-05-30). If
`git rev-parse upstream/main` ≠ `3a41450`, regenerate. Every claim below was re-checked
against the actual code.

**Scope (what this report is — and isn't).** This tracks **functional parity only**:
upstream functionality not exposed/implemented by the standalone build. Git *sync status*
— how far behind `upstream/main` the fork is — is **not** a parity gap and is **not** tracked
here; the merge workflow's `fetch-upstream.sh` (behind count) and `drift-gate.sh` own that.
The fork is **purely additive**: every fork-authored line lives in `src/standalone/`, so
`git diff $(git merge-base HEAD upstream/main) HEAD -- src/ ':(exclude)src/standalone/'` is
empty. There is **no** fork-*ahead* drift in shared `src/` — behavior overrides go through the
build seam (esbuild redirect / `vscode` stub), never an edit to a shared file, and
`drift-gate.sh` enforces this on every sync.

**Bucket convention (append-only ledger).** Buckets (A, B, C, …) are append-only: each is a
unit of upstream functionality. When a merge surfaces genuinely new upstream functionality the
standalone build doesn't implement, it is **appended** as a new lettered bucket — never folded
into an existing bucket, never renumbered, never deleted. An implemented bucket is marked
`SHIPPED`/implemented **in place** by the implementing agent and kept as history. (Bug fixes,
refactors, dep bumps, tests, infra, and VS Code-only surfaces are not functionality gaps and
get no bucket.)

How the standalone build is assembled: the fork exposes upstream's RPC surface
through a frozen allowlist (`src/standalone/v1-allowed.ts`) — 52 read/registry
methods — plus a 12-method LLM service bridge (`v1-service-allowed.ts`) and one
native method (`openExternal`). It reuses upstream's nav verbatim
(`standalone-html.ts` swaps the CSP, token, and script tags, then injects an
"Explore" group with Data Explorer + Rule Playground). What looks "trimmed" is
usually upstream's own doing: the burndown link is gated by
`FF_TOKEN_REPORTING_ENABLED`, and several routes (Data Explorer, Rule
Playground, Rule Editor, SDLC) are deep-link-only with no nav link upstream.

**Status (2026-05-30):** buckets A, B, and D are SHIPPED. Gaps remain across bucket C
(project-scoped analysis) and bucket E (agentic SDLC). Several "shipped" pages also carry
residual per-method degradations now tracked inline (see **Per-method degradations**).

## A. Quick wins — SHIPPED (2026-05-27)

All four exposed in the standalone build. Note: only two were genuinely
"no new infra"; the token items required a standalone-only build override.

- **Data Explorer** ✅ — `getDataExplorer` added to the allowlist (40 → 42) and a
  nav link injected in `standalone-html.ts` (deep-link-only upstream). Pure-core,
  no infra.
- **Rule Playground (eval)** ✅ — `evaluateExpression` added to the allowlist and a
  nav link injected (same "Explore" group). Pure-core. `compileNlRule` (NL→rule,
  bucket D) and `saveRule` (bucket B) are also shipped.
- **Burndown (chart)** ✅ — NOT an allowlist gap (its read RPC methods were already
  allowlisted); gated by `FF_TOKEN_REPORTING_ENABLED = false` in shared core. Exposed
  via a **standalone-only** override: `src/standalone/standalone-constants.ts` re-exports
  core constants with the flag flipped, and an esbuild `onResolve` plugin redirects
  `core/constants` to it for the standalone CLI bundle + a new
  `dist/standalone/webview/app.js`. The published extension stays FF=false.
  **Caveat:** the chart renders, but **model-budget save/load is still degraded** —
  see Per-method degradations (`saveModelBudgets` / `loadModelBudgets`).
- **Output token breakdown** ✅ — same `FF_TOKEN_REPORTING_ENABLED` override; the
  Output page now renders its "Token Usage" tab in standalone.

## B. Rule & skill authoring — SHIPPED (2026-05-27, write path landed)

The earlier version of this section described every item below as an unshipped
gap. That was stale: the write path landed and all of these are now allowlisted.
Corrected status:

- **Rule Editor** ✅ — create / edit / tune / live-test rules.
  `getRuleEditor` / `getRuleSource` / `getRulePreview` / `saveRule` /
  `updateRuleThreshold` / `testRuleLive` all in `V1_ALLOWED` (`v1-allowed.ts`).
  `saveRule` writes via Node fs; `getRuleEditor` accepts the graceful
  `require('vscode')` fallback (`workspaceRoot → undefined → personal+builtin`).
- **Anti-Patterns Editor** ✅ — editable markdown rules + threshold tuning via the
  same `saveRule` / `updateRuleThreshold`. Reached by the rule-editor modal
  (`page-antipatterns-editor.ts`).
- **Export Summary** ✅ — `exportSummary` is allowlisted in `v1-service-allowed.ts`
  and routed through the request-service bridge (writes via `COACH_EXPORT_DIR` /
  browser download). *(Correction: the prior claim "neither allowlisted nor
  reimplemented natively" was wrong.)*
- **Skill install** ✅ — `installSkill` / `installCatalogItem` allowlisted in
  `v1-service-allowed.ts` and routed through the bridge.
- **Import registry rules** ✅ — `importRegistryRules` allowlisted (read-only handler,
  `panel-rpc.ts:1242`). Exposed forward-only; no standalone UI page calls it yet.

> A true "import into your rule set" write flow would still reuse `saveRule`
> (already shipped) — only the UI wiring is missing, not the capability.

## C. Project-scoped analysis — needs a project route + browser trust

- **Project-scoped rules** (`coach --project <path>`) — evaluate a specific
  repo against project-layer rules. Core `rule-loader` already accepts
  `workspaceRoot`; just needs a route to set it. **Med**.
- **Local-rule trust approval** — `reviewLocalRules` (NOT allowlisted; verified
  absent from all three tiers). Was a VS Code quick-pick (`extension.ts:79`)
  backed by the extension's `globalState` Memento (`rule-trust.ts:44`, key
  `aiEngineerCoach.ruleTrust.v1`) — *not* a file. Reimplement as a browser modal
  with a standalone-side store (e.g. a `trust.json`). **Med**.
  **Note:** this isn't purely project-scoped — it is wired to a live button on
  the already-shipped Anti-Patterns page (`page-antipatterns.ts:1025`), so its
  absence degrades a shipped surface (see Per-method degradations).

## D. LLM-backed tier — SHIPPED (2026-05-27)

The "LLM provider wiring" enabler plus all four feature groups are exposed in the
standalone build. The four groups split across two delivery mechanisms behind a
single seam (the `vscode` stub).

- **Enabler** ✅ — `vscode.lm` is implemented in `src/standalone/vscode-stub.ts` over a new
  `src/standalone/llm-provider.ts` (Anthropic/OpenAI, non-streaming single-fetch, auto-detected
  by `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`; `COACH_LLM_MODEL` / `COACH_LLM_BASE_URL` /
  `COACH_LLM_MAX_TOKENS` overrides). One seam lights up BOTH `panel-llm.ts` and
  `core/rule-compiler.ts` with zero edits to either.
- **NL-rule features** ✅ — `explainOccurrence` / `generateRule` / `compileNlRule` are
  registry handlers, allowlisted (`V1_ALLOWED`). `compileNlRule` degrades to a
  heuristic template offline (never errors); `generateRule` has a template fallback.
- **Learning Center** ✅ — `generateLearningQuiz` / `generateCodeComparison` /
  `generateDidYouKnow` / `generateLearningResources`, exposed via the
  `PanelRequestService` bridge (`src/standalone/request-service-bridge.ts`, gated by
  `V1_SERVICE_ALLOWED`). **Caveat:** the Learning page also calls `getWorkspaceDeps`
  (bucket E, NOT allowlisted) — quiz personalization degrades to generic content
  (see Per-method degradations).
- **Skill discovery / triage / generation** ✅ — `discoverCatalog` / `triageCatalog` /
  `triageSkills` / `generateSkillContent` via the same bridge. `createSkill` stays degraded
  (it opens VS Code chat — not an LLM call).
- **AI context-file review** ✅ — `reviewContextFiles` via the bridge; its `reviewProgress`
  event is forwarded over WebSocket to the requesting socket (per-socket `emitEvent`).

**Documented degradations (not regressions):** `createSkill` (VS Code chat). With no API key,
LLM-backed methods surface a standalone hint — *"Set ANTHROPIC_API_KEY or OPENAI_API_KEY to enable
AI features."* (the upstream "No language model available … Copilot" string is rewritten by
`src/standalone/llm-unavailable.ts`); `compileNlRule` and `generateRule` silently fall back to a
heuristic/template instead.

**Data flow & configuration (transparency).** AI features send your prompts, code snippets, and —
for context review — your instruction-file contents (`CLAUDE.md` and friends) to the configured LLM
provider; this is the same data flow as the VS Code extension's Copilot path. Provider and key are
auto-detected from `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`. `COACH_LLM_BASE_URL` redirects requests
(carrying your API key) to that host — intended for proxies and local models, so point it only at a
host you trust. `COACH_LLM_MODEL` / `COACH_LLM_MAX_TOKENS` / `COACH_LLM_TIMEOUT_MS` tune the model,
output ceiling, and request timeout.

## E. Agentic SDLC — needs the dropped data service rebuilt

- **SDLC local scans** — repo / tool / dependency analysis across the
  lifecycle. `getSdlcRepoScan` / `getSdlcToolAnalysis` / `getWorkspaceDeps`
  are all off every allowlist (verified absent from `v1-allowed.ts`,
  `v1-service-allowed.ts`, `standalone-native.ts`). The **SDLC tab renders an
  endless loading state and never resolves** (`page-sdlc.ts:91-92`); the
  Level-Up SDLC badge call (`page-experiments.ts:221`) silently no-ops. **Med–High**
  — route these through the request-service bridge. Biggest visible broken surface.
- **SDLC GitHub data** — `getSdlcGitHubData`. Needs GitHub auth / network.
  **Hard** — distinct from the local scans.

## Per-method degradations (within otherwise-shipped pages)

Methods called by a shipping page but absent from all three exposure tiers
(`V1_ALLOWED` / `V1_SERVICE_ALLOWED` / `STANDALONE_NATIVE`). Verified by grep
against the allowlist files, 2026-05-30:

| Page (shipped) | Missing method | Call site | Effect | Bucket |
|---|---|---|---|---|
| Burndown | `saveModelBudgets`, `loadModelBudgets` | `page-burndown.ts:95,103` | chart works; budgets don't persist across reloads | A |
| Anti-Patterns | `reviewLocalRules` | `page-antipatterns.ts:1025` | "review pending rules" button errors offline | C |
| Learning | `getWorkspaceDeps` | `page-learning.ts:686` | quiz personalization falls back to generic content | E |
| SDLC tab | `getSdlcRepoScan`, `getSdlcToolAnalysis` | `page-sdlc.ts:91-92` | tab loads forever, never renders | E |

## Priority notes

- **Biggest visible broken surface: the SDLC tab (bucket E)** — allowlist
  `getSdlcRepoScan` + `getSdlcToolAnalysis` through the request-service bridge.
- **Cheap finishers:** `saveModelBudgets`/`loadModelBudgets` (Burndown),
  `getWorkspaceDeps` (Learning), `reviewLocalRules` (Anti-Patterns) — small write/
  read paths that complete already-shipped pages.

## Explicitly excluded (out of scope: not portable / not a feature)

- VS Code activity-bar sidebar (no browser equivalent).
- `@aicoach` chat participant (`src/chat/*`) and MCP Language Model tools
  (`src/mcp/*`) — require the VS Code chat sidebar / MCP host.
- Infra: devcontainer setup, metric/rule-engine unit-test branch, security
  CSP / XSS fixes, dependency bumps.
