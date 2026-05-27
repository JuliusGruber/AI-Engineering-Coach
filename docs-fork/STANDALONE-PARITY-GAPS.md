# Standalone Parity Gaps (upstream → fork)

Features that exist in the upstream extension (`microsoft/AI-Engineering-Coach`
main) but are **not yet exposed by this fork's standalone build**. Scope:
*portable* gaps only — things that could run in a browser. VS Code-only
surfaces (activity-bar sidebar) and pure infra (devcontainer, CI, dep bumps,
security CSP/XSS branches) are excluded.

**Derived:** 2026-05-27, against upstream HEAD `abc0a6c`. The fork is
additive-only — it ships all upstream source untouched, then exposes it
through a frozen 40-method allowlist (`src/standalone/v1-allowed.ts`) plus a
trimmed nav. Everything below is in upstream's `RpcMethodMap` /
`ExtensionMethodMap` (`src/core/types/rpc-types.ts`) but off the allowlist or
hidden from nav. Difficulty tags are estimates; each item names the blocker.

~18 gaps across 5 buckets.

## A. Quick wins — data already flows, just gated/hidden

- **Data Explorer** — ad-hoc field distributions & filters. Only
  `getDataExplorer` is off the allowlist (`getDataExplorerFields` is *on*).
  **Easy** — add one method, unhide nav.
- **Burndown page** — monthly token-budget progress + projections.
  `getBurndown` / `getAiCreditBurndown` are allowlisted, but the shim
  redirects `burndown → dashboard` (`webview-shim.ts`). **Easy** — UI
  re-enable only.
- **Output token breakdown** — per-model / language token volume.
  `getTokenCoverage` is allowlisted; the README marks the UI section
  "temporarily hidden." **Easy** — un-hide (confirm there wasn't a
  data-quality reason).
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
- **Import registry rules** — pull catalog rules into your rule set.
  `importRegistryRules`. **Med** — write path.

## C. Project-scoped analysis — needs a project route + browser trust

- **Project-scoped rules** (`coach --project <path>`) — evaluate a specific
  repo against project-layer rules. Core `rule-loader` already accepts
  `workspaceRoot`; just needs a route to set it. **Med**.
- **Local-rule trust approval** — `reviewLocalRules`; gate untrusted local
  rule files. Was a VS Code quick-pick → reimplement as a browser modal backed
  by `trust.json`. **Med** (tied to project rules).

## D. LLM-backed tier — blocked on a standalone model provider

- **LLM provider wiring** *(enabler)* — v1 dropped VS Code's built-in Copilot
  LM API with no replacement. An `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` path
  unblocks everything below. **Med–High**.
- **Learning Center** — quizzes, code-comparison rounds, did-you-know.
  `generateLearningQuiz` / `generateCodeComparison` / `generateDidYouKnow` /
  `generateLearningResources`. No read-only path. **After enabler**.
- **Skill discovery / triage / generation** — `discoverCatalog` /
  `triageCatalog` / `triageSkills` + `generateSkillContent` / `createSkill`
  (Skill Finder is currently browse-only via `getRegistryCatalog`).
  **After enabler**.
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

- Fastest visible parity bump: **bucket A** (4 items, mostly allowlist / nav
  one-liners).
- Biggest single unlock: **D's LLM enabler** — lights up ~9 methods across 4
  pages on its own.

## Explicitly excluded (out of scope: not portable / not a feature)

- VS Code activity-bar sidebar (no browser equivalent).
- Infra: devcontainer setup, metric/rule-engine unit-test branch, security
  CSP / XSS fixes, dependency bumps.
