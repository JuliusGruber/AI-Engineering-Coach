# Standalone Feature Parity (upstream → fork)

A complete, user-facing **feature inventory** of the upstream `microsoft/AI-Engineering-Coach`
extension, each feature marked with its status in this fork's **standalone build**. Rebuilt
from a full re-analysis of both repos on every sync — the table is regenerated, not patched.
**Grounding:** every status below was established by reading code in both repos (the upstream
nav/pages/`contributes.*`/chat/mcp and the standalone allowlists, routes, pages, and stubs);
the grounding ref is in each Note.

**Staleness** — derived `a06dd7e` (merge-base) → re-verified against `81d8eb2` (upstream/main),
**60 behind at rebuild** (rebuilt 2026-07-04 during the `main` sync that brings the fork to
`81d8eb2`; after that sync lands `main` is at `81d8eb2`, **0 behind**). This sync's 60 commits are
mostly infra — the parser OOM/streaming rewrite (#106), dep bumps, CI/agentic-workflow config,
tests, and LLM-egress/log security hardening — plus a handful of user-facing changes reflected
below (Coding-Moments time-range filter #118, skipped-parse banner + live telemetry strip #106,
the `getCapabilities`/`showOutput` RPCs, and the Copilot-app "canvas" host). If
`git rev-parse upstream/main` ≠ `81d8eb2`, regenerate (run the `merging-upstream` skill, step 4).

**Legend** — ✅ implemented · ⚠️ partial · ❌ not implemented · ⛔ VS Code-only

> **Scope.** Functional parity only. Git **sync status** (how far behind `upstream/main` the
> fork is) is **not** a feature row — it's owned by `fetch-upstream.sh` (behind count) and
> `drift-gate.sh`. The fork is **purely additive**: all fork code lives in `src/standalone/`,
> so `git diff $(git merge-base HEAD upstream/main) HEAD -- src/ ':(exclude)src/standalone/'`
> is empty (confirmed this sync: authorship gate clean, zero fork-authored edits outside
> `src/standalone/`).
>
> **How reachability was determined.** The standalone build reuses upstream's webview verbatim:
> the top nav — now emitted by `getDashboardShellHtml()` (`src/webview/dashboard-shell.ts`), which
> `panel-html.ts` inlines — drives a 13-case router (`renderPage`, `src/webview/app.ts:516`, switch
> at `app.ts:532–547`), and `standalone-html.ts` injects one extra "Explore" nav group (Data
> Explorer + Rule Playground). A feature is **reachable** when a routed page (or a sub-component it
> imports) calls an exposed method. An allowlisted method whose only caller is an unrouted page is
> **⚠️ exposed-but-unreachable**, not ✅. Capability gating (`capabilities.ts` / `getCapabilities`)
> is inert in standalone — the RPC is unexposed, so the webview keeps its default full-capability
> profile and every gated nav item stays visible (desired: the standalone build has its own LLM
> provider). See the LLM provider tier.

## Core dashboards & output
| Feature | Standalone | Note |
|---|---|---|
| Dashboard | ✅ | read getters in `v1-allowed.ts` (`getStats`/`getWorkspaces`/…); default nav route, `dashboard` case (`app.ts:533`, Observe group) |
| Timeline | ✅ | `getDayTimeline`/`getSessions`/`getSessionDetail` (`v1-allowed.ts`); `timeline` route (`app.ts:538`) |
| Coding Moments (image gallery) | ✅ | `getImageGallery`/`getSessionImages` (`v1-allowed.ts`); `image-gallery` route (`app.ts:546`); standalone `image-route.ts` serves the images. The **time-range filter** (#118) is pure client-side (module-level `activeRangeDays` + `filterMomentsByRange` over already-fetched moments, no new RPC), so it works unchanged in standalone |
| Anti-Patterns (read view) | ✅ | `getAntiPatterns` (`v1-allowed.ts`); `anti-patterns` route (`app.ts:539`, Improve group). The heatmap sub-view (`page-antipatterns-heatmap.ts`, imported by `page-antipatterns.ts`) is reachable on the same route |
| Output (code production) | ✅ | `getCodeProduction` (`v1-allowed.ts`); `output` route (`app.ts:535`, Measure group) |
| Context Health | ✅ | `getConfigHealth` (`v1-allowed.ts`); `config-health` route (`app.ts:542`, Improve group). The "Context Files" sub-tab (skills/, AGENTS.md, CLAUDE.md via `config-health-helpers.ts`) reads files through `vscode-stub.ts`'s node-fs-backed `workspace.fs` |
| Context Management | ✅ | `getContextManagement`/`getWorkspaceContextSessions`/`getContextRangeAvailability` (`v1-allowed.ts`); `page-context-mgmt.ts` is imported by `page-config.ts`, reachable via the `config-health` route |
| Workflow optimization | ✅ | `getWorkflowOptimization` (`v1-allowed.ts`), surfaced within Dashboard (`page-dashboard.ts`), Skills (`page-skills.ts`), and the Level Up Achievements view (`page-achievements.ts`). The dedicated `page-workflows.ts` is **unrouted** (no `workflows` case in `app.ts`), so the feature renders inside those reachable pages, not a standalone Workflows page |
| Level Up (experiments / achievements / SDLC / learning) | ✅ | `level-up` route → `renderLevelUp` (`page-experiments.ts`), the composition hub that mounts achievements, SDLC, Learning, and the share card (`app.ts:543`); SDLC badge populates |
| Peers — social share card | ✅ | No peers/leaderboard page or RPC method exists upstream (none in `rpc-types.ts`; no `peers` route in `app.ts`/nav). The reachable social feature is the Level Up **Share** card (`renderShareCard`, registered `page-experiments.ts:70`), working in standalone via exposed getters (`getStats`/`getCodeProduction`/`getWorkLifeBalance`/`getFlowState`/`getDailyActivity`/`getAntiPatterns`) + `exportSummary` + `openExternal` |
| Insights | ⚠️ | `getInsights` is allowlisted (`v1-allowed.ts`) but **exposed-but-unreachable** — its only consumer `page-insights.ts` is not in the `app.ts` route switch and is imported by nothing (dead upstream too; no `data-page="insights"` nav). No working standalone UI path |

## Parsing & loading UX
| Feature | Standalone | Note |
|---|---|---|
| Live parse telemetry strip | ✅ | Loading-screen gauge strip (`telemetry-strip.ts`, `#loading-telemetry`), fed by worker samples (`worker-telemetry.ts` → `LoadProgress.telemetry`) via **postMessage, not RPC**. On a cold standalone parse the fork's `cli.ts:127` broadcasts `{type:'progress', …p}`, so `telemetry` rides the spread and the strip updates for free (same worker via `parse-bootstrap.ts`) |
| Skipped-parse history banner | ⚠️ | Dismissible `#skipped-banner` above content when sessions were skipped. Authoritative counts ride on the `dataReady` message (upstream `panel.ts` spreads `…skippedCounts()`), but the fork's warm/cache path sends a bare `{type:'dataReady', currentWorkspace:''}` (`server.ts:186,305`) with no skipped counts, so the banner is under-populated on the warm path; and its "View details" link calls `rpc('showOutput')` — a VS Code output channel with no browser analog (see VS Code-only surfaces), so the link is inert in-browser |

## Token & cost reporting
| Feature | Standalone | Note |
|---|---|---|
| Burndown chart | ⚠️ | The chart itself renders via the `FF_TOKEN_REPORTING_ENABLED` build override (`standalone-constants.ts:11` flips it `true`; esbuild `onResolve` redirects `core/constants` only in the standalone bundle; the published extension stays FF=false). The gate now lives in the `normalizePageForFeatureFlags` helper (`app.ts:31–34`, called from both `navigateTo` @358 and `renderPage` @517): it bounces `burndown`→`dashboard` only when the flag is false, and a companion runtime gate removes the `[data-page="burndown"]` nav `<li>`. The redirect is resolution-keyed, so it flips the flag in `app.ts:9` **and** the new `dashboard-shell.ts:10` (which renders that nav `<li>`). **Model-budget save/load degraded** — see Model-budget persistence row |
| Output Token-Usage tab | ✅ | same FF override flips the tab on in standalone |
| AI credits / credit burndown | ✅ | `getAiCredits`/`getAiCreditBurndown` (`v1-allowed.ts`) |
| Token coverage | ✅ | `getTokenCoverage` (`v1-allowed.ts`) |
| Model-budget persistence | ❌ | `saveModelBudgets`/`loadModelBudgets` NOT exposed in any standalone tier (both in the gap list). Called by the shipped burndown page (`page-burndown.ts:95`/`103`, with save triggers at `:233`/`:238`/`:282` and a load on mount at `:140`) → the RPCs reject silently in standalone, so the chart works but budgets don't persist across reloads (they live only in transient webview state). A native `saveModelBudgets`/`loadModelBudgets` Tier-1 handler pair (disk-backed store) is in flight out-of-tree on `feat/standalone-model-budget-persistence`; not on `main` |

## Rules & anti-patterns authoring
| Feature | Standalone | Note |
|---|---|---|
| Rule Editor (create / edit / tune / live-test) | ✅ | `getRuleEditor`/`getRuleSource`/`getRulePreview`/`saveRule`/`updateRuleThreshold`/`testRuleLive` (`v1-allowed.ts`); `saveRule` writes via Node fs; `rule-editor` route reuses `renderAntiPatterns` (`app.ts:540`) |
| Anti-Patterns Editor | ✅ | editable markdown rules + threshold tuning via `saveRule`/`updateRuleThreshold` (`page-antipatterns-editor.ts`, imported by `page-antipatterns.ts`); `testRuleLive` reached by the rule-editor modal (`page-antipatterns-editor.ts:297`) |
| Export Summary | ✅ | `exportSummary` (`v1-service-allowed.ts`) via request-service bridge (`COACH_EXPORT_DIR` / browser download) |
| Import registry rules | ⚠️ | `importRegistryRules` allowlisted (`v1-allowed.ts`, handler `panel-rpc.ts`) but exposed forward-only — no webview page calls it (verified: zero callers in `page-*.ts`/`app.ts`); a write flow would reuse the shipped `saveRule` |
| Local-rule trust approval | ❌ | `reviewLocalRules` NOT exposed (verified absent from all three tiers; in the gap list). Was a VS Code quick-pick (`extension.ts`) backed by a `globalState` Memento (`rule-trust.ts`). Degrades the shipped Anti-Patterns "review pending rules" button (`page-antipatterns.ts:1025`, confirmed by the parity-gap tripwire) — needs a browser modal + standalone trust store |

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
| Learning quizzes | ✅ | `generateLearningQuiz` (`v1-service-allowed.ts`) via bridge; `page-learning.ts` reachable via Level Up (`page-experiments.ts` imports it). Quiz choice-state reset on advance (#137) is an upstream client-side bug fix, inherited unchanged |
| Code comparison | ✅ | `generateCodeComparison` (`v1-service-allowed.ts`) |
| Did-You-Know | ✅ | `generateDidYouKnow` (`v1-service-allowed.ts`) |
| Learning resources | ✅ | `generateLearningResources` (`v1-service-allowed.ts`) |
| Quiz personalization | ⚠️ | uses `getWorkspaceDeps` (`page-learning.ts:686`); real deps for all harnesses once a session records a directory (`workspaceRootPath`), generic fallback when no resolvable directory was recorded |

## Data exploration & rule playground
| Feature | Standalone | Note |
|---|---|---|
| Data Explorer | ✅ | `getDataExplorer` (`v1-allowed.ts`); `data-explorer` route (`app.ts:544`) + nav link injected by `standalone-html.ts` (deep-link-only upstream) |
| Rule Playground (eval) | ✅ | `evaluateExpression` (`v1-allowed.ts`); `rule-playground` route (`app.ts:545`) + nav link injected (same injected "Explore" group) |
| NL→rule compile | ✅ | `compileNlRule` (`v1-allowed.ts`); degrades to a heuristic template offline (never errors) |
| Explain occurrence / generate rule | ✅ | `explainOccurrence`/`generateRule` (`v1-allowed.ts`); `generateRule` has a template fallback offline |
| Metric DSL reference | ✅ | static reference panel (`page-dsl-reference.ts`, imported by `page-antipatterns.ts`), reachable via the Anti-Patterns / Rule-Editor surface; no RPC method (pure static content) |

## LLM provider tier (cross-cutting enabler)
| Feature | Standalone | Note |
|---|---|---|
| LLM provider wiring | ✅ | `vscode.lm` implemented in `vscode-stub.ts` over `llm-provider.ts` (Anthropic/OpenAI, non-streaming, auto-detected by `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`); one seam lights up `panel-llm.ts` + `core/rule-compiler.ts` with zero core edits |
| AI context-file review | ✅ | `reviewContextFiles` (`v1-service-allowed.ts`) via bridge; the `reviewProgress` event is forwarded over WebSocket to the requesting socket |
| No-key fallback | ✅ | LLM methods surface a standalone hint ("Set ANTHROPIC_API_KEY or OPENAI_API_KEY to enable AI features.", `llm-unavailable.ts`) instead of the upstream Copilot string; `compileNlRule`/`generateRule` fall back to heuristic/template |
| Host/LLM capability probe (`getCapabilities`) | ❌ | New upstream RPC (`rpc-types.ts`); returns `{host, llm}` and is called once at webview boot (`app.ts:318`) to gate Skill-Finder + Level-Up nav visibility. NOT exposed in any standalone tier — but the webview defaults to `{host:'vscode', llm:true}` and **keeps that default on RPC failure** (`capabilities.ts` try/catch), so standalone degrades *up* to full capability, which is correct (the standalone build has its own provider). Off-allowlist by design; a native handler returning `{host:'browser', llm: <provider detected>}` would only make the (already-correct) profile host-accurate |

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
| SDLC GitHub data | ❌ | `getSdlcGitHubData` needs GitHub auth/network (`vscode.authentication.getSession('github', …)` + outbound fetch) and has no call site in `page-sdlc.ts` — a deferred SDLC method (in the gap list) |

## Project-scoped analysis
| Feature | Standalone | Note |
|---|---|---|
| Project-scoped rules (`coach --project <path>`) | ❌ | core `rule-loader` already accepts `workspaceRoot`; needs a standalone route to set it |

## VS Code-only surfaces (⛔ — structurally non-portable, intentionally out of scope)
| Feature | Standalone | Note |
|---|---|---|
| Activity-bar sidebar | ⛔ | `contributes.viewsContainers` `aiEngineerCoach` + `views` `aiEngineerCoach.welcome` (webview) — no browser equivalent |
| `@aicoach` chat participant | ⛔ | `src/chat/participant.ts` + slash commands (summary / improve / compare / flow) — requires the VS Code chat sidebar |
| MCP language-model tools | ⛔ | `src/mcp/tools.ts` (`aiEngineerCoach_*` tools) — requires an MCP host / the VS Code LM API. This sync routes their prompt/egress through the new `redact-secrets`/`spotlight` hardening, but the surface stays VS Code-only |
| Output channel (`showOutput`) | ⛔ | New upstream RPC (`rpc-types.ts`); reveals the "AI Engineer Coach" VS Code OutputChannel via `vscode.commands.executeCommand('aiEngineerCoach.showOutput')` (`extension.ts`). No browser analog — the skipped-banner "View details" link (`app.ts:337`) that calls it is inert in standalone; a fork equivalent would be an in-DOM detail panel, not this method |
| Copilot-app "canvas" host | ⛔ | New upstream **delivery host** (`src/canvas/host.ts` + `.github/extensions/`): runs the same webview dashboard inside the GitHub Copilot desktop app over a plain-Node HTTP/SSE bridge (read-only, `llm:false`). Not a dashboard capability — the fork's **standalone browser build is the parallel out-of-VS-Code host**, so there is nothing to reproduce. Shared `capabilities.ts` gating flows into the standalone webview but is inert there (reports full capability) |

## Appendix — RPC surface tripwire (machine signal)

Live `parity-gap.mjs` output (header + counts), pasted on every rebuild. Supporting signal
only — not the doc's structure.

```
# parity-gap — derived a06dd7e (merge-base) -> re-verified 81d8eb2 (upstream/main), 60 behind

V1_ALLOWED         = 52   OK
V1_SERVICE_ALLOWED = 15   OK
STANDALONE_NATIVE  = 1    OK
exposed (union)    = 68   OK
universe (upstream)= 77
gap                = 9   (universe \ exposed)
```

Gap methods (9, `universe \ exposed`) and the feature row each maps to:
`calibrateRule` · `runRuleTests` — off-allowlist, deferred (no shipped page reaches them);
`createSkill` → Create skill ⚠️; `getSdlcGitHubData` → SDLC GitHub data ❌;
`reviewLocalRules` → Local-rule trust approval ❌;
`saveModelBudgets` · `loadModelBudgets` → Model-budget persistence ❌ (silent degradation,
`page-burndown.ts:95/103/…`; a native handler pair is in flight out-of-tree on
`feat/standalone-model-budget-persistence`, not on `main`);
`getCapabilities` → Host/LLM capability probe ❌ (graceful full-capability fallback);
`showOutput` → Output channel ⛔ (VS Code OutputChannel, no browser analog).

**Newly-appeared upstream RPC methods needing an allowlist decision (2):**
`getCapabilities` and `showOutput` (both added this sync, `rpc-types.ts`). **Decision — leave
both off-allowlist:** `getCapabilities` degrades *up* to full capability (the standalone build
has its own provider, so gating everything visible is correct); `showOutput` is a
structurally-VS-Code-only OutputChannel with no browser analog. Neither needs exposing to keep
the standalone build functional; both are tracked above (LLM provider tier / VS Code-only
surfaces). Confirm against the script's "ALLOWLIST DECISION NEEDED" section on each rebuild.
