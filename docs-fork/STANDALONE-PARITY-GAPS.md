# Standalone Parity Gaps (upstream → fork)

Features that exist in the upstream extension (`microsoft/AI-Engineering-Coach`
main) but are **not yet exposed by this fork's standalone build**. Scope:
*portable* gaps only — things that could run in a browser. VS Code-only
surfaces (activity-bar sidebar, the `@aicoach` chat participant, MCP tools) and
pure infra (devcontainer, CI, dep bumps, security CSP/XSS branches) are
excluded.

**Derived & re-verified** `3a41450` (merge-base **==** upstream/main), **0 behind**;
**gap = 10** (universe 75 \ exposed 65, `parity-gap.mjs`, 2026-05-30, post-merge). If
`git rev-parse upstream/main` ≠ `3a41450`, regenerate. (The 2026-05-27 derivation was
against the older upstream head `abc0a6c`; the merge-base advanced to `1fef41a`, then to
`3a41450` once PR #12 merged `upstream/main`.) Every claim below was re-checked against
the actual code.

**Foundational correction (2026-05-30, updated post-merge).** Earlier revisions claimed
the fork was *"additive-only — `git diff upstream/main` is empty across `src/` outside
`src/standalone/`."* That briefly stopped being true when upstream moved ahead of the
fork's base — but the fork has now **merged the delta** (PR #12, `f50fa13`), so the
merge-base equals `upstream/main` again and **Bucket F merge debt is paid**. The only
remaining drift outside `src/standalone/` is **2 fork-*ahead* deliberate edits**
(`metric-engine.ts` locale pin, `parser-codex.test.ts` timeout — commit `44e9532`),
which the drift gate classifies `DELIBERATE` → upstream-it. They are not merge debt. The
fork is once again *additive on top of current upstream*, plus those 2 known fork-ahead fixes.

How the standalone build is assembled: the fork exposes upstream's RPC surface
through a frozen allowlist (`src/standalone/v1-allowed.ts`) — 52 read/registry
methods — plus a 12-method LLM service bridge (`v1-service-allowed.ts`) and one
native method (`openExternal`). It reuses upstream's nav verbatim
(`standalone-html.ts` swaps the CSP, token, and script tags, then injects an
"Explore" group with Data Explorer + Rule Playground). What looks "trimmed" is
usually upstream's own doing: the burndown link is gated by
`FF_TOKEN_REPORTING_ENABLED`, and several routes (Data Explorer, Rule
Playground, Rule Editor, SDLC) are deep-link-only with no nav link upstream.

**Status (2026-05-30):** buckets A, B, and D are SHIPPED; **bucket F (merge debt) is
RESOLVED** — the fork merged `upstream/main` (PR #12), so #53 and #67 are now in the
tree. Gaps remain across bucket C (project-scoped analysis) and bucket E (agentic SDLC).
Several "shipped" pages also carry residual per-method degradations now tracked inline
(see **Per-method degradations**).

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

## F. Merge debt — RESOLVED 2026-05-30 (was: fork is behind upstream)

**Status: paid.** The fork has since merged `upstream/main` up to `3a41450`
(PR #12 — `f50fa13`, branch `sync/upstream-20260530`, merging `959ec59`).
`git merge-base HEAD upstream/main` now **equals** `upstream/main` (`3a41450`);
`fetch-upstream.sh` and `parity-gap.mjs` both report **0 behind**. The two portable
items below were flagged while the fork was still branched at the older `abc0a6c`
base; both are now in the tree (verified against the code 2026-05-30). Kept for history.

- **#53 — blank dashboard for non-VS-Code harnesses** ✅ **RESOLVED.** Upstream's
  `hasExternalHarnessSources()` (`src/core/parser-harnesses.ts:86`) and the load gate
  are now present: `panel.ts:12` imports it, `panel.ts:207` calls it, and the abort
  at `panel.ts:213` fires only when `dirs.length === 0 && !hasExternal`. The old
  unconditional `"No Copilot chat log directories found."` abort is gone — replaced by
  `"No AI coding session logs found. Looked for VS Code, GitHub Copilot…, Claude Code,
  Codex, and OpenCode sessions."` A standalone box with **only** Claude Code / Codex /
  OpenCode logs (`~/.claude/projects`, etc.) and no VS Code workspace storage now loads
  the dashboard.
- **#67 — Codex `skillsUsed` undercount** ✅ **RESOLVED.** Codex skill extraction is
  merged: `collectSkillsFromArgs` (`parser-codex.ts:242`) and `extractSkillPathsFromText`
  (`parser-shared.ts:320`). Standalone Dashboard / Tool-Mastery metrics no longer
  undercount skill invocations for Codex sessions.
- **~~Locale-pinned rule serialization~~ — CORRECTED 2026-05-30: fork-*ahead* drift, not debt.**
  The prior revision claimed upstream pinned `toLocaleString('en-US')` in `metric-engine.ts`
  and the fork lacked it. The reverse is true: the **fork** pinned it (commit `44e9532`,
  2026-05-28) and **upstream HEAD is still unpinned** —
  `git diff 1fef41a upstream/main -- src/core/metric-engine.ts` is empty. It is a
  fork-authored correctness fix to **upstream**, tracked below under *Fork-authored drift*.
  A merge will NOT touch this hunk (upstream never changed the file). The drift gate
  (2026-05-30) flags it as `DELIBERATE` → upstream-it.
- **VS Code-only delta (excluded, listed for completeness):** `src/chat/*`
  (`@aicoach` chat participant) and `src/mcp/*` (13 Language Model tools) — the
  fork is missing these too, but they require the VS Code chat sidebar / MCP host
  and have no standalone equivalent. Not a standalone-UI gap.

> **Merge-cleanliness note (post-merge):** the merge landed clean. The one expected
> conflict — `parser-codex.test.ts` (upstream +86 lines, #67) — was resolved keeping the
> fork's timeout *and* upstream's new tests. `metric-engine.ts` did not conflict (upstream
> never touched it since the merge-base). The standalone constants `onResolve` override and
> the `standalone-html.ts` nav-boundary assertions still hold (drift gate + build self-guard
> green, 2026-05-30).

### Fork-authored drift outside `src/standalone/` (upstream-it candidates — fork is *ahead*)

Two deliberate edits live in shared `src/` (drift gate, 2026-05-30). **Neither is merge
debt** — both are portable fixes the fork should PR to `microsoft/AI-Engineering-Coach`
rather than carry indefinitely. The drift gate classifies both as `DELIBERATE` and proposes
upstream-it; **never auto-revert** them — each keeps an upstream test green locally.

- `src/core/metric-engine.ts` — `toLocaleString('en-US')` locale pin (commit `44e9532`).
  Without it `metric-engine.test.ts:435` goes red on non-en-US locales (this machine's Node
  default formats `1234` as `1 234`, not `1,234`). No upstream overlap → merges clean.
- `src/core/parser-codex.test.ts` — 120s timeout on the `>MAX_FILE_SIZE` Codex test (commit
  `44e9532`); the global `testTimeout` is 15s but the test needs ~60s on Windows/slow disks.
  **Conflict risk:** upstream added +86 lines to this same test file (#67) — keep the fork's
  timeout *and* upstream's new tests.

> **Reverted 2026-05-30:** `src/webview/panel-request-service.ts`'s Windows `path.join`
> separator fix (commit `e3be742`) was reverted to match upstream byte-for-byte.
> `vscode.Uri.file` normalizes separators, so no test depended on it — the fork no longer
> carries it, and this file is back inside the additive-only invariant.

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

- **~~Highest leverage: merge `upstream/main` (bucket F)~~ — DONE 2026-05-30.** PR #12
  (`f50fa13`) merged the delta: #53 (blank-dashboard gap) and #67 are fixed, and the
  "additive on top of current upstream" invariant is restored. (Locale pinning was **not**
  part of this — the fork has it and upstream does not; upstream-it instead.)
- **Biggest visible broken surface now: the SDLC tab (bucket E)** — allowlist
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
