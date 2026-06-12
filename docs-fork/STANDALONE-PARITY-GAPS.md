# Standalone Feature Parity (upstream → fork)

A complete, user-facing **feature inventory** of the upstream `microsoft/AI-Engineering-Coach`
extension, each feature marked with its status in this fork's **standalone build**. Rebuilt
from a full re-analysis of both repos on every sync — the table is regenerated, not patched.
**Grounding:** every status below was established by reading code in both repos (the upstream
nav/pages/`contributes.*`/chat/mcp and the standalone allowlists, routes, pages, and stubs);
the grounding ref is in each Note.

**Staleness** — derived `9909b36` (merge-base) → re-verified `a06dd7e` (upstream/main),
**9 behind** (rebuilt 2026-06-12, pre-merge; the 9 upstream commits touch only `.github/`
agentic-workflow infra + 2 test files — no user-facing `src/` surface changed). If
`git rev-parse upstream/main` ≠ `a06dd7e`, regenerate (run the `merging-upstream` skill, step 4).

**Legend** — ✅ implemented · ⚠️ partial · ❌ not implemented · ⛔ VS Code-only

> **Scope.** Functional parity only. Git **sync status** (how far behind `upstream/main` the
> fork is) is **not** a feature row — it's owned by `fetch-upstream.sh` (behind count) and
> `drift-gate.sh`. The fork is **purely additive**: all fork code lives in `src/standalone/`,
> so `git diff $(git merge-base HEAD upstream/main) HEAD -- src/ ':(exclude)src/standalone/'`
> is empty.
>
> **How reachability was determined.** The standalone build reuses upstream's webview verbatim:
> the top nav (`src/webview/panel-html.ts`) drives a 13-case router (`src/webview/app.ts:621`
> `renderPage`), and `standalone-html.ts` injects one extra "Explore" nav group (Data Explorer +
> Rule Playground). A feature is **reachable** when a routed page (or a sub-component it imports)
> calls an exposed method. An allowlisted method whose only caller is an unrouted page is
> **⚠️ exposed-but-unreachable**, not ✅.

## Core dashboards & output
| Feature | Standalone | Note |
|---|---|---|
| Dashboard | ✅ | read getters in `v1-allowed.ts` (`getStats`/`getWorkspaces`/…); default nav route, `renderDashboard` (`app.ts:638`, Observe group) |
| Timeline | ✅ | `getDayTimeline`/`getSessions`/`getSessionDetail` (`v1-allowed.ts`); `timeline` route (`app.ts:643`) |
| Coding Moments (image gallery) | ✅ | `getImageGallery`/`getSessionImages` (`v1-allowed.ts`); `image-gallery` route (`app.ts:651`); standalone `image-route.ts` serves the images |
| Anti-Patterns (read view) | ✅ | `getAntiPatterns` (`v1-allowed.ts`); `anti-patterns` route (`app.ts:644`, Improve group). The heatmap sub-view (`page-antipatterns-heatmap.ts`, imported by `page-antipatterns.ts`) is reachable on the same route |
| Output (code production) | ✅ | `getCodeProduction` (`v1-allowed.ts`); `output` route (`app.ts:640`, Measure group) |
| Context Health | ✅ | `getConfigHealth` (`v1-allowed.ts`); `config-health` route (`app.ts:647`, Improve group) |
| Context Management | ✅ | `getContextManagement`/`getWorkspaceContextSessions`/`getContextRangeAvailability` (`v1-allowed.ts`); `page-context-mgmt.ts` is imported by `page-config.ts`, reachable via the `config-health` route |
| Workflow optimization | ✅ | `getWorkflowOptimization` (`v1-allowed.ts`), surfaced within Dashboard (`page-dashboard.ts:376`), Skills (`page-skills.ts:171`), and the Level Up Achievements view (`page-achievements.ts:503`). The dedicated `page-workflows.ts` is **unrouted** (no `workflows` case in `app.ts`), so the feature renders inside those reachable pages, not a standalone Workflows page |
| Level Up (experiments / achievements / SDLC / learning) | ✅ | `level-up` route → `renderLevelUp` (`page-experiments.ts`), the composition hub that mounts achievements, SDLC, Learning, and the share card; SDLC badge populates (`page-experiments.ts:223`) |
| Peers — social share card | ✅ | No peers/leaderboard page or RPC method exists upstream (none in `rpc-types.ts`; no `peers` route in `app.ts`/nav). The reachable social feature is the Level Up **Share** card (`renderShareCard`, registered `page-experiments.ts:70`), working in standalone via exposed getters (`getStats`/`getCodeProduction`/`getWorkLifeBalance`/`getFlowState`/`getDailyActivity`/`getAntiPatterns`) + `exportSummary` + `openExternal` |
| Insights | ⚠️ | `getInsights` is allowlisted (`v1-allowed.ts`) but **exposed-but-unreachable** — its only consumer `page-insights.ts:108` is not in the `app.ts` route switch and is imported by nothing (dead upstream too; no `data-page="insights"` nav). No working standalone UI path |

## Token & cost reporting
| Feature | Standalone | Note |
|---|---|---|
| Burndown chart | ⚠️ | renders via the `FF_TOKEN_REPORTING_ENABLED` build override (`standalone-constants.ts:11` flips it `true`; esbuild `onResolve` redirects `core/constants` only in the standalone bundle; the published extension stays FF=false). `app.ts:27` only bounces `burndown`→`dashboard` when FF is false, so the route works in standalone. Model-budget save/load degraded — see Model-budget persistence row |
| Output Token-Usage tab | ✅ | same FF override flips the tab on in standalone |
| AI credits / credit burndown | ✅ | `getAiCredits`/`getAiCreditBurndown` (`v1-allowed.ts`) |
| Token coverage | ✅ | `getTokenCoverage` (`v1-allowed.ts`) |
| Model-budget persistence | ❌ | `saveModelBudgets`/`loadModelBudgets` NOT exposed (gap list; called at `page-burndown.ts:95,103`); chart works, budgets don't persist across reloads |

## Rules & anti-patterns authoring
| Feature | Standalone | Note |
|---|---|---|
| Rule Editor (create / edit / tune / live-test) | ✅ | `getRuleEditor`/`getRuleSource`/`getRulePreview`/`saveRule`/`updateRuleThreshold`/`testRuleLive` (`v1-allowed.ts`); `saveRule` writes via Node fs; `rule-editor` route reuses `renderAntiPatterns` (`app.ts:645`) |
| Anti-Patterns Editor | ✅ | editable markdown rules + threshold tuning via `saveRule`/`updateRuleThreshold` (`page-antipatterns-editor.ts`, imported by `page-antipatterns.ts`); `testRuleLive` reached by the rule-editor modal (`page-antipatterns-editor.ts:297`) |
| Export Summary | ✅ | `exportSummary` (`v1-service-allowed.ts`) via request-service bridge (`COACH_EXPORT_DIR` / browser download) |
| Import registry rules | ⚠️ | `importRegistryRules` allowlisted (`v1-allowed.ts`, handler `panel-rpc.ts:1279`) but exposed forward-only — no webview page calls it (verified: zero callers in `page-*.ts`/`app.ts`); a write flow would reuse the shipped `saveRule` |
| Local-rule trust approval | ❌ | `reviewLocalRules` NOT exposed (verified absent from all three tiers; in the gap list). Was a VS Code quick-pick (`extension.ts:79`) backed by a `globalState` Memento (`rule-trust.ts:44`). Degrades the shipped Anti-Patterns "review pending rules" button (`page-antipatterns.ts:1025`) — needs a browser modal + standalone trust store |

## Skills (install / discover / triage / generate)
| Feature | Standalone | Note |
|---|---|---|
| Skill install | ✅ | `installSkill`/`installCatalogItem` (`v1-service-allowed.ts`) via bridge |
| Skill discovery | ✅ | `discoverCatalog` (`v1-service-allowed.ts`) |
| Skill triage | ✅ | `triageSkills`/`triageCatalog` (`v1-service-allowed.ts`) |
| Skill content generation | ✅ | `generateSkillContent` (`v1-service-allowed.ts`) |
| Create skill | ⚠️ | `createSkill` opens VS Code chat — not an LLM call (excluded from `v1-service-allowed.ts`; in the gap list); degraded in standalone |

## Learning Center
| Feature | Standalone | Note |
|---|---|---|
| Learning quizzes | ✅ | `generateLearningQuiz` (`v1-service-allowed.ts`) via bridge; `page-learning.ts` reachable via Level Up (`page-experiments.ts` imports it) |
| Code comparison | ✅ | `generateCodeComparison` (`v1-service-allowed.ts`) |
| Did-You-Know | ✅ | `generateDidYouKnow` (`v1-service-allowed.ts`) |
| Learning resources | ✅ | `generateLearningResources` (`v1-service-allowed.ts`) |
| Quiz personalization | ⚠️ | uses `getWorkspaceDeps` (`page-learning.ts:686`); real deps for all harnesses once a session records a directory (`workspaceRootPath`: `parser-claude.ts`/`parser-opencode.ts`/`parser-codex.ts`, upstream `cb61436`/#86), generic fallback when no resolvable directory was recorded |

## Data exploration & rule playground
| Feature | Standalone | Note |
|---|---|---|
| Data Explorer | ✅ | `getDataExplorer` (`v1-allowed.ts`); `data-explorer` route (`app.ts:649`) + nav link injected by `standalone-html.ts` (deep-link-only upstream) |
| Rule Playground (eval) | ✅ | `evaluateExpression` (`v1-allowed.ts`); `rule-playground` route (`app.ts:650`) + nav link injected (same injected "Explore" group) |
| NL→rule compile | ✅ | `compileNlRule` (`v1-allowed.ts`); degrades to a heuristic template offline (never errors) |
| Explain occurrence / generate rule | ✅ | `explainOccurrence`/`generateRule` (`v1-allowed.ts`); `generateRule` has a template fallback offline |
| Metric DSL reference | ✅ | static reference panel (`page-dsl-reference.ts`, imported by `page-antipatterns.ts`), reachable via the Anti-Patterns / Rule-Editor surface; no RPC method (pure static content) |

## LLM provider tier (cross-cutting enabler)
| Feature | Standalone | Note |
|---|---|---|
| LLM provider wiring | ✅ | `vscode.lm` implemented in `vscode-stub.ts` over `llm-provider.ts` (Anthropic/OpenAI, non-streaming, auto-detected by `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`); one seam lights up `panel-llm.ts` + `core/rule-compiler.ts` with zero core edits |
| AI context-file review | ✅ | `reviewContextFiles` (`v1-service-allowed.ts`) via bridge; the `reviewProgress` event is forwarded over WebSocket to the requesting socket |
| No-key fallback | ✅ | LLM methods surface a standalone hint ("Set ANTHROPIC_API_KEY or OPENAI_API_KEY to enable AI features.", `llm-unavailable.ts`) instead of the upstream Copilot string; `compileNlRule`/`generateRule` fall back to heuristic/template |

> **Data flow & configuration (transparency — retained verbatim).** AI features send your
> prompts, code snippets, and — for context review — your instruction-file contents
> (`CLAUDE.md` and friends) to the configured LLM provider; this is the same data flow as the
> VS Code extension's Copilot path. Provider and key are auto-detected from `ANTHROPIC_API_KEY`
> / `OPENAI_API_KEY`. `COACH_LLM_BASE_URL` redirects requests (carrying your API key) to that
> host — intended for proxies and local models, so point it only at a host you trust.
> `COACH_LLM_MODEL` / `COACH_LLM_MAX_TOKENS` / `COACH_LLM_TIMEOUT_MS` tune the model, output
> ceiling, and request timeout.

## Agentic SDLC
| Feature | Standalone | Note |
|---|---|---|
| SDLC local scans (tool analysis / repo scan / deps) | ✅ | `getSdlcToolAnalysis`/`getSdlcRepoScan`/`getWorkspaceDeps` (`v1-service-allowed.ts`) via bridge; `page-sdlc.ts` reachable via Level Up (`page-experiments.ts` imports it), the SDLC tab renders. Repo-scan + deps populate for all harnesses when the session recorded a resolvable directory (`workspaceRootPath`); the "No workspace repos resolved" empty state remains only for sessions with no resolvable root |
| SDLC GitHub data | ❌ | `getSdlcGitHubData` needs GitHub auth/network (`vscode.authentication.getSession('github', …)` + outbound fetch) and has no call site in `page-sdlc.ts` — the sole remaining deferred SDLC method (in the gap list) |

## Project-scoped analysis
| Feature | Standalone | Note |
|---|---|---|
| Project-scoped rules (`coach --project <path>`) | ❌ | core `rule-loader` already accepts `workspaceRoot`; needs a standalone route to set it |

## VS Code-only surfaces (⛔ — structurally non-portable, intentionally out of scope)
| Feature | Standalone | Note |
|---|---|---|
| Activity-bar sidebar | ⛔ | `contributes.viewsContainers` `aiEngineerCoach` + `views` `aiEngineerCoach.welcome` (webview) — no browser equivalent |
| `@aicoach` chat participant | ⛔ | `src/chat/participant.ts` + slash commands (summary / improve / compare / flow) — requires the VS Code chat sidebar |
| MCP language-model tools | ⛔ | `src/mcp/tools.ts` (12 `aiEngineerCoach_*` tools) — requires an MCP host / the VS Code LM API |

## Appendix — RPC surface tripwire (machine signal)

Live `parity-gap.mjs` output (header + counts), pasted on every rebuild. Supporting signal
only — not the doc's structure.

```
# parity-gap — derived 9909b36 (merge-base) -> re-verified a06dd7e (upstream/main), 9 behind

V1_ALLOWED         = 52   OK
V1_SERVICE_ALLOWED = 15   OK
STANDALONE_NATIVE  = 1    OK
exposed (union)    = 68   OK
universe (upstream)= 75
gap                = 7   (universe \ exposed)
```

Gap methods (7, `universe \ exposed`) and the feature row each maps to:
`calibrateRule` · `runRuleTests` — off-allowlist, deferred (no shipped page reaches them);
`createSkill` → Create skill ⚠️; `getSdlcGitHubData` → SDLC GitHub data ❌;
`loadModelBudgets` · `saveModelBudgets` → Model-budget persistence ❌;
`reviewLocalRules` → Local-rule trust approval ❌.

**Newly-appeared upstream RPC methods needing an allowlist decision: none** (the upstream RPC
surface is unchanged since the merge-base) — confirm against the script's "ALLOWLIST DECISION
NEEDED" section on each rebuild.
