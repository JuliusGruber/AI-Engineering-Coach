# Standalone Parity Gaps (upstream → fork)

Features that exist in the upstream extension (`microsoft/AI-Engineering-Coach`
main) but are **not yet exposed by this fork's standalone build**. Scope:
*portable* gaps only — things that could run in a browser. VS Code-only
surfaces (activity-bar sidebar) and pure infra (devcontainer, CI, dep bumps,
security CSP/XSS branches) are excluded.

**Derived:** 2026-05-27, against upstream HEAD `abc0a6c`. The fork is
additive-only — it ships all upstream source untouched (verified: `git diff
upstream/main` is empty across `src/` outside `src/standalone/`), then exposes
it through a frozen 40-method allowlist (`src/standalone/v1-allowed.ts`). It
reuses upstream's nav verbatim — `standalone-html.ts` only swaps the CSP,
token, and script tags. What looks "trimmed" is upstream's own doing: the
burndown link is gated by `FF_TOKEN_REPORTING_ENABLED`, and several routes
(Data Explorer, Rule Playground, Rule Editor, SDLC) are deep-link-only with no
nav link upstream. Everything below is in upstream's `RpcMethodMap` /
`ExtensionMethodMap` (`src/core/types/rpc-types.ts`) but off the allowlist,
flag-gated, or deep-link-only. Difficulty tags are estimates; each item names
the blocker.

~18 gaps across 5 buckets.

## A. Quick wins — SHIPPED (2026-05-27)

All four exposed in the standalone build. Note: only two were genuinely
"no new infra"; the token items required a standalone-only build override.

- **Data Explorer** ✅ — `getDataExplorer` added to the allowlist (40 → 42) and a
  nav link injected in `standalone-html.ts` (deep-link-only upstream). Pure-core,
  no infra.
- **Rule Playground (eval)** ✅ — `evaluateExpression` added to the allowlist and a
  nav link injected (same "Explore" group). Pure-core. `compileNlRule` (NL→rule,
  bucket D) and `saveRule` (bucket B) remain disabled and degrade gracefully.
- **Burndown** ✅ — NOT an allowlist gap (its RPC methods were already allowlisted);
  gated by `FF_TOKEN_REPORTING_ENABLED = false` in shared core. Exposed via a
  **standalone-only** override: `src/standalone/standalone-constants.ts` re-exports
  core constants with the flag flipped, and an esbuild `onResolve` plugin redirects
  `core/constants` to it for the standalone CLI bundle + a new
  `dist/standalone/webview/app.js`. The published extension stays FF=false. (So the
  original "flip the one flag" framing was wrong — the flag is shared between the
  extension and standalone via one bundle.)
- **Output token breakdown** ✅ — same `FF_TOKEN_REPORTING_ENABLED` override; the
  Output page now renders its "Token Usage" tab in standalone.

## B. Rule & skill authoring — needs a write path (v1 is read-only)

- **Rule Editor** — create / edit / tune / live-test rules.
  `getRuleEditor` / `getRuleSource` / `saveRule` / `updateRuleThreshold` /
  `testRuleLive`. **Med** — write to `~/.ai-engineer-coach/rules/` + shim the
  `require('vscode')` in `getRuleEditor`.
- **Anti-Patterns Editor** — editable markdown rules + threshold tuning (the
  read-only Anti-Patterns page already ships). Shares `saveRule` /
  `updateRuleThreshold`. **Med**.
- **Export Summary** — Markdown / JSON summary export. `exportSummary` is
  neither allowlisted nor reimplemented natively (only `openExternal` is in
  `STANDALONE_NATIVE`). The README "Share" export claim is inherited from the
  extension. **Easy–Med** — replace the VS Code save-dialog with a browser
  download / dir-write.
- **Skill install** — install a skill / catalog item to disk.
  `installSkill` / `installCatalogItem`. **Med** — write path.
- **Import registry rules** — surface built-in catalog rules for import/review.
  `importRegistryRules` is off the allowlist, but (exception to this bucket's
  "needs write path" premise) its handler is **read-only** — it returns the
  built-in rules list and writes nothing (`panel-rpc.ts:1242`) — and is not
  currently wired to any webview page. **Easy** — allowlist it as-is; a true
  "import into your rule set" write flow would reuse `saveRule` (Med).

## C. Project-scoped analysis — needs a project route + browser trust

- **Project-scoped rules** (`coach --project <path>`) — evaluate a specific
  repo against project-layer rules. Core `rule-loader` already accepts
  `workspaceRoot`; just needs a route to set it. **Med**.
- **Local-rule trust approval** — `reviewLocalRules`; gate untrusted local
  rule files. Was a VS Code quick-pick (`extension.ts:79`) backed by the
  extension's `globalState` Memento (`rule-trust.ts:44`, key
  `aiEngineerCoach.ruleTrust.v1`) — *not* a file. Reimplement as a browser
  modal with a standalone-side store (e.g. a `trust.json`). **Med** (tied to
  project rules).

## D. LLM-backed tier — SHIPPED (2026-05-27)

The "LLM provider wiring" enabler plus all four feature groups are exposed in the
standalone build. The four groups were NOT uniform: they split across two delivery
mechanisms behind a single seam (the `vscode` stub).

- **Enabler** ✅ — `vscode.lm` is implemented in `src/standalone/vscode-stub.ts` over a new
  `src/standalone/llm-provider.ts` (Anthropic/OpenAI, non-streaming single-fetch, auto-detected
  by `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`; `COACH_LLM_MODEL` / `COACH_LLM_BASE_URL` /
  `COACH_LLM_MAX_TOKENS` overrides). One seam lights up BOTH `panel-llm.ts` and
  `core/rule-compiler.ts` with zero edits to either.
- **NL-rule features** ✅ — `explainOccurrence` / `generateRule` / `compileNlRule` are
  registry handlers, now allowlisted (`V1_ALLOWED` 42 → 45). `compileNlRule` degrades to a
  heuristic template offline (never errors); `generateRule` has a template fallback.
- **Learning Center** ✅ — `generateLearningQuiz` / `generateCodeComparison` /
  `generateDidYouKnow` / `generateLearningResources`, exposed via the new
  `PanelRequestService` bridge (`src/standalone/request-service-bridge.ts`, gated by
  `V1_SERVICE_ALLOWED`).
- **Skill discovery / triage / generation** ✅ — `discoverCatalog` / `triageCatalog` /
  `triageSkills` / `generateSkillContent` via the same bridge. `createSkill` stays degraded
  (it opens VS Code chat — not an LLM call).
- **AI context-file review** ✅ — `reviewContextFiles` via the bridge; its `reviewProgress`
  event is forwarded over WebSocket to the requesting socket (per-socket `emitEvent`).

**Out of scope (documented degradations, not regressions):** `createSkill` (VS Code chat);
`installSkill` / `installCatalogItem` / `exportSummary` (bucket B write path);
`getWorkspaceDeps` / `getSdlc*` (bucket E — the bridge enables these later but they are not
allowlisted here). With no API key, LLM-backed methods surface a standalone hint — *"Set
ANTHROPIC_API_KEY or OPENAI_API_KEY to enable AI features."* (the upstream "No language model
available … Copilot" string is rewritten by `src/standalone/llm-unavailable.ts`); `compileNlRule`
and `generateRule` silently fall back to a heuristic/template instead. `generateRule` is reachable
via the anti-patterns "New Rule" modal, but its Save/Test actions stay degraded (write path /
`runRuleTests` not allowlisted).

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
  lived in the dropped `PanelRequestService`; the page currently renders
  empty. **Med–High** — rebuild the bridge.
- **SDLC GitHub data** — `getSdlcGitHubData`. Needs GitHub auth / network.
  **Hard** — distinct from the local scans.

## Priority notes

- Fastest visible parity bump: **bucket A** (4 items: 2 allowlist/nav
  additions, 2 covered by flipping `FF_TOKEN_REPORTING_ENABLED`).
- Biggest single unlock: **D's LLM enabler** — lights up ~13 methods (4 learning
  + 5 skill + 1 context + 3 NL-rule) across 4 pages on its own.

## Explicitly excluded (out of scope: not portable / not a feature)

- VS Code activity-bar sidebar (no browser equivalent).
- Infra: devcontainer setup, metric/rule-engine unit-test branch, security
  CSP / XSS fixes, dependency bumps.
