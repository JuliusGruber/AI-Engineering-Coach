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

## A. Quick wins — allowlist/flag flips, no new infra

- **Data Explorer** — ad-hoc field distributions & filters. Only
  `getDataExplorer` is off the allowlist (`getDataExplorerFields` is *on*); the
  handler is pure-core (`panel-rpc.ts:1175`). **Easy** — add one method, plus a
  nav link (Data Explorer is deep-link-only upstream — there's no nav item to
  unhide).
- **Burndown page** — monthly token-budget progress + projections.
  `getBurndown` / `getAiCreditBurndown` are allowlisted, but gated by the
  upstream feature flag `FF_TOKEN_REPORTING_ENABLED = false`
  (`core/constants.ts:127`) — *not* the shim. The flag redirects
  `burndown → dashboard` (`app.ts:27`), removes the nav link (`app.ts:32-34`,
  `panel-html.ts:34`), and makes the handlers return `errorResult('Token
  reporting is temporarily disabled')` (`panel-rpc.ts:641-649`). **Easy** —
  flip the one flag (re-enables data + UI together).
- **Output token breakdown** — per-model / language token volume.
  `getTokenCoverage` is allowlisted but, like Burndown, gated by the same
  `FF_TOKEN_REPORTING_ENABLED` flag: the handler returns "Token reporting is
  temporarily disabled" (`panel-rpc.ts:650`) and the README marks the section
  "temporarily hidden." **Easy** — same flag flip (the flag *is* the
  data-quality hold).
- **Rule Playground (eval)** — DSL REPL. Reference panels already work
  (`getFieldSchema` / `getMetricPrimitives` / `getFunctionCatalog` /
  `getMetricList` are allowlisted); only `evaluateExpression` /
  `calibrateRule` / `runRuleTests` are gated (pure-core). **Easy–Med** —
  `compileNlRule` (NL→rule) stays LLM (bucket D).

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

## D. LLM-backed tier — blocked on a standalone model provider

- **LLM provider wiring** *(enabler)* — v1 dropped VS Code's built-in Copilot
  LM API with no replacement. An `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` path
  unblocks everything below. **Med–High**.
- **Learning Center** — quizzes, code-comparison rounds, did-you-know.
  `generateLearningQuiz` / `generateCodeComparison` / `generateDidYouKnow` /
  `generateLearningResources`. No read-only path. **After enabler**.
- **Skill discovery / triage / generation** — `discoverCatalog` /
  `triageCatalog` / `triageSkills` + `generateSkillContent` / `createSkill`.
  The Skill Finder page (`page-skills.ts`) drives discovery via `discoverCatalog`
  (LLM, line 352) and `triageCatalog` (line 366), both disabled in standalone —
  so it has **no browse-only fallback** today. (`getRegistryCatalog` is
  allowlisted but called by no page.) **After enabler**.
- **AI context-file review** — `reviewContextFiles` in Context Health
  (scores / checklist / map already work). **After enabler**.
- **NL rule features** — `compileNlRule`, `generateRule`, `explainOccurrence`.
  **After enabler**.

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
