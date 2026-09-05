# Standalone Feature Parity (upstream → fork)

A complete, user-facing **feature inventory** of the upstream `microsoft/AI-Engineering-Coach`
extension, each feature marked with its status in this fork's **standalone build**. Rebuilt
from a full re-analysis of both repos on every sync — the table is regenerated, not patched.
**Grounding:** every status below was established by reading code in both repos (the upstream
nav/pages/`contributes.*`/chat/mcp and the standalone allowlists, routes, pages, and stubs);
the grounding ref is in each Note.

**Staleness** — derived `81d8eb2` (merge-base) → re-verified against `18b1a3d` (upstream/main),
**62 behind at rebuild** (rebuilt 2026-09-05 during the `main` sync that brings the fork to
`18b1a3d`; after that sync lands `main` is at `18b1a3d`, **0 behind**). This sync's 62 commits are
mostly dep bumps and CI pinning, plus the cross-harness **edit-LoC pipeline rework** (#127/#131,
touching every parser), **harness-injected context filtering** in workflow analysis (#154),
achievements handling FF-disabled token reporting (#156), a11y `aria-live` nav badges (#190), and
one substantial new feature area — the **GitHub App productivity dashboard** (#241) with
**issue-level AI credit estimates** (#242), which adds the only two new RPC methods. If
`git rev-parse upstream/main` ≠ `18b1a3d`, regenerate (run the `merging-upstream` skill, step 4).

**Legend** — ✅ implemented · ⚠️ partial · ❌ not implemented · ⛔ VS Code-only

> **Scope.** Functional parity only. Git **sync status** (how far behind `upstream/main` the
> fork is) is **not** a feature row — it's owned by `fetch-upstream.sh` (behind count) and
> `drift-gate.sh`. The fork is **purely additive**: all fork code lives in `src/standalone/`,
> so `git diff $(git merge-base HEAD upstream/main) HEAD -- src/ ':(exclude)src/standalone/'`
> is empty (confirmed this sync: authorship gate clean, zero fork-authored edits outside
> `src/standalone/`).
>
> **How reachability was determined.** The standalone build reuses upstream's webview verbatim:
> the top nav — emitted by `getDashboardShellHtml()` (`src/webview/dashboard-shell.ts`), which
> `panel-html.ts` inlines — drives a **15-case** router (`renderPage`, `src/webview/app.ts:592`,
> switch at `app.ts:594–610`), and `standalone-html.ts:73–82` injects one extra "Explore" nav
> group (Data Explorer + Rule Playground). A feature is **reachable** when a routed page (or a
> sub-component it imports) calls an exposed method. An allowlisted method whose only caller is
> an unrouted page is **⚠️ exposed-but-unreachable**, not ✅. Capability gating
> (`capabilities.ts` / `getCapabilities`) is inert in standalone — the RPC is unexposed, so the
> webview keeps its default full-capability profile (`capabilities.ts:19`) and every gated nav
> item stays visible (desired: the standalone build has its own LLM provider). See the LLM
> provider tier.
>
> **Denied-method shape (matters for every ❌ row).** A non-allowlisted method returns
> `{ok:false, error:{code:'standalone-v1-disabled'}}` (`dispatcher.ts:59`), which `server.ts:145`
> serializes as `data.error` — a truthy string — so the webview's `rpc()` **rejects**
> (`shared.ts:75`). A page with a `.catch()` fallback therefore renders its *error* state, not
> its *absent* state; that distinction is what makes the GitHub App rows ⚠️ rather than hidden.

## Core dashboards & output
| Feature | Standalone | Note |
|---|---|---|
| Dashboard | ✅ | read getters in `v1-allowed.ts` (`getStats`/`getWorkspaces`/…); default nav route, `dashboard` case (`app.ts:594`, Observe group) |
| Timeline | ✅ | `getDayTimeline`/`getSessions`/`getSessionDetail` (`v1-allowed.ts`); `timeline` route (`app.ts:599`) |
| Coding Moments (image gallery) | ✅ | `getImageGallery`/`getSessionImages` (`v1-allowed.ts`); `image-gallery` route (`app.ts:607`); standalone `image-route.ts` serves the images. The time-range filter is pure client-side (no RPC), so it works unchanged |
| Anti-Patterns (read view) | ✅ | `getAntiPatterns` (`v1-allowed.ts`); `anti-patterns` route (`app.ts:600`, Improve group). The heatmap sub-view (`page-antipatterns-heatmap.ts`, imported by `page-antipatterns.ts`) is reachable on the same route |
| Output (code production) | ✅ | `getCodeProduction` (`v1-allowed.ts`, called at `app.ts:102` / `page-dashboard.ts:196`); `output` route (`app.ts:596`, Measure group). This sync's **removed-LoC series** (`dailyRemovedByWorkspace`/`ByModel`/`ByHarness`, 6 refs in `page-output.ts`) rides the same exposed method — no new RPC, so it works in standalone unchanged |
| Context Health | ✅ | `getConfigHealth` (`v1-allowed.ts`); `config-health` route (`app.ts:603`, Improve group). The "Context Files" sub-tab (skills/, AGENTS.md, CLAUDE.md via `config-health-helpers.ts`) reads files through `vscode-stub.ts`'s node-fs-backed `workspace.fs` |
| Context Management | ✅ | `getContextManagement`/`getWorkspaceContextSessions`/`getContextRangeAvailability` (`v1-allowed.ts`); `page-context-mgmt.ts` is imported by `page-config.ts`, reachable via the `config-health` route |
| Workflow optimization | ✅ | `getWorkflowOptimization` (`v1-allowed.ts`), surfaced within Dashboard (`page-dashboard.ts`), Skills (`page-skills.ts`), and the Level Up Achievements view (`page-achievements.ts`). The dedicated `page-workflows.ts` is **unrouted and imported by nothing** (re-verified this sync), so the feature renders inside those reachable pages, not a standalone Workflows page. This sync's harness-injected-context filtering (#154) is parser-side and flows through unchanged |
| Level Up (experiments / achievements / SDLC / learning) | ✅ | `level-up` route → `renderLevelUp` (`page-experiments.ts`), the composition hub that mounts achievements, SDLC, Learning, and the share card (`app.ts:604`); SDLC badge populates. Upstream's #156 fix (achievements tolerating FF-disabled token reporting) is inert here — standalone runs FF=true |
| Peers — social share card | ✅ | No peers/leaderboard page or RPC method exists upstream (none in `rpc-types.ts`; no `peers` route). The reachable social feature is the Level Up **Share** card (`page-peers.ts`, imported by `page-experiments.ts`), working in standalone via exposed getters (`getStats`/`getCodeProduction`/`getWorkLifeBalance`/`getFlowState`/`getDailyActivity`/`getAntiPatterns`) + `exportSummary` + `openExternal` |
| Insights | ⚠️ | `getInsights` is allowlisted (`v1-allowed.ts`) but **exposed-but-unreachable** — its only consumer `page-insights.ts` is not in the `app.ts` route switch and is imported by nothing (re-verified this sync; dead upstream too). No working standalone UI path |

## GitHub App analytics *(new upstream area this sync)*
| Feature | Standalone | Note |
|---|---|---|
| GitHub App productivity dashboard | ⚠️ | `getGitHubAppMetrics` **not exposed** in any tier (in the gap list). Structurally **portable** — the handler is registry-resident (`panel-rpc.ts:730`) and reads `~/.copilot/data.db` by spawning the `sqlite3` CLI (`github-app-database.ts:39–46`), pure Node with no VS Code API — so allowlisting it would light it up with no core edit. Left off-allowlist this sync. **Visible degradation:** the boot probe (`app.ts:135`, called from `app.ts:378`) catches the rejection into `{status:'unavailable'}`, and the nav-reveal test is `status !== 'absent'` (`app.ts:114`), so the hidden "GitHub App" nav group **un-hides** and both pages render a permanent empty state (`page-github-app.ts:231`) instead of staying hidden. A native handler returning `{status:'absent'}` (or exposing the real method) would fix the reveal |
| Issue-level AI credit estimates | ⚠️ | `getGitHubAppIssueCredits` **not exposed** (in the gap list); same registry-resident, portable handler (`panel-rpc.ts:731`) and the same SQLite source. Route exists (`app.ts:609`) and the nav item shares the `.github-app-nav-item` reveal above, so it is reachable but renders empty; its badge stays cleared (`app.ts:130`) |
| Delivery funnel (session-history derived) | ⚠️ | Not a separate surface — upstream #245 rewrote the funnel to derive from session history (`github-app-delivery-funnel.ts`), consumed inside the productivity dashboard above, so it inherits that row's status |

## Parsing & loading UX
| Feature | Standalone | Note |
|---|---|---|
| Live parse telemetry strip | ✅ | Loading-screen gauge strip (`telemetry-strip.ts`, `#loading-telemetry`), fed by worker samples via **postMessage, not RPC**. On a cold standalone parse the fork's `cli.ts:127` broadcasts `{type:'progress', …p}`, so `telemetry` rides the spread and the strip updates for free (same worker via `parse-bootstrap.ts`) |
| Skipped-parse history banner | ⚠️ | Dismissible `#skipped-banner` above content when sessions were skipped. Authoritative counts ride on the `dataReady` message (upstream `panel.ts` spreads `…skippedCounts()`), but the fork's warm/cache path sends a bare `{type:'dataReady', currentWorkspace:''}` (`server.ts:186,305`) with no skipped counts, so the banner is under-populated on the warm path; and its "View details" link calls `rpc('showOutput')` (`app.ts:397`) — a VS Code output channel with no browser analog (see VS Code-only surfaces), so the link is inert in-browser |
| Cross-harness edit-LoC accuracy | ✅ | This sync's largest core change (#127/#131: incremental line counting, VS Code file-lifecycle handling, cross-harness normalization across every `parser-*.ts`). Parsing is fully shared code running in the fork's own worker (`parse-bootstrap.ts`), so the corrected LoC flows into Output/Dashboard unchanged — no RPC surface, no fork action needed |

## Token & cost reporting
| Feature | Standalone | Note |
|---|---|---|
| Burndown chart | ⚠️ | The chart renders via the `FF_TOKEN_REPORTING_ENABLED` build override (`standalone-constants.ts:11` flips it `true`; esbuild `onResolve` redirects `core/constants` only in the standalone bundle; the published extension stays FF=false). The gate lives in `normalizePageForFeatureFlags` (`app.ts:46–50`): it bounces `burndown`→`dashboard` only when the flag is false, and a companion runtime gate removes the `[data-page="burndown"]` nav `<li>`. The redirect is resolution-keyed, so it flips the flag in both `app.ts` and `dashboard-shell.ts:24` (which renders that nav `<li>`). **Model-budget save/load degraded** — see Model-budget persistence row |
| Output Token-Usage tab | ✅ | same FF override flips the tab on in standalone |
| AI credits / credit burndown | ✅ | `getAiCredits`/`getAiCreditBurndown` (`v1-allowed.ts`) |
| Token coverage | ✅ | `getTokenCoverage` (`v1-allowed.ts`) |
| Model-budget persistence | ❌ | `saveModelBudgets`/`loadModelBudgets` NOT exposed in any standalone tier (both in the gap list). Called by the shipped burndown page (`page-burndown.ts:95`/`103`, save triggers at `:233`/`:238`/`:282`, load on mount at `:140`) → the RPCs reject in standalone, so the chart works but budgets don't persist across reloads (they live only in transient webview state). A native Tier-1 handler pair (disk-backed store) is in flight out-of-tree on `feat/standalone-model-budget-persistence`; not on `main` |

## Rules & anti-patterns authoring
| Feature | Standalone | Note |
|---|---|---|
| Rule Editor (create / edit / tune / live-test) | ✅ | `getRuleEditor`/`getRuleSource`/`getRulePreview`/`saveRule`/`updateRuleThreshold`/`testRuleLive` (`v1-allowed.ts`); `saveRule` writes via Node fs; `rule-editor` route reuses `renderAntiPatterns` (`app.ts:601`) |
| Anti-Patterns Editor | ✅ | editable markdown rules + threshold tuning via `saveRule`/`updateRuleThreshold` (`page-antipatterns-editor.ts`, imported by `page-antipatterns.ts`); `testRuleLive` reached by the rule-editor modal |
| Export Summary | ✅ | `exportSummary` (`v1-service-allowed.ts`) via request-service bridge (`COACH_EXPORT_DIR` / browser download) |
| Import registry rules | ⚠️ | `importRegistryRules` allowlisted (`v1-allowed.ts`, handler in `panel-rpc.ts`) but exposed forward-only — no webview page calls it (re-verified: zero callers in `page-*.ts`/`app.ts`); a write flow would reuse the shipped `saveRule` |
| Local-rule trust approval | ❌ | `reviewLocalRules` NOT exposed (absent from all three tiers; in the gap list). Was a VS Code quick-pick (`extension.ts`) backed by a `globalState` Memento (`rule-trust.ts`). Degrades the shipped Anti-Patterns "review pending rules" button (`page-antipatterns.ts:1026`, confirmed by the parity-gap tripwire) — needs a browser modal + standalone trust store |
| Rule calibration / rule test-suite | ❌ | `calibrateRule`/`runRuleTests` off-allowlist and deferred (in the gap list); no shipped page reaches them, so nothing degrades today |

## Skills (install / discover / triage / generate)
| Feature | Standalone | Note |
|---|---|---|
| Skill install | ✅ | `installSkill`/`installCatalogItem` (`v1-service-allowed.ts`) via bridge |
| Skill discovery | ✅ | `discoverCatalog` (`v1-service-allowed.ts`) |
| Skill triage | ✅ | `triageSkills`/`triageCatalog` (`v1-service-allowed.ts`) |
| Skill content generation | ✅ | `generateSkillContent` (`v1-service-allowed.ts`) |
| Create skill | ⚠️ | `createSkill` opens VS Code chat — not an LLM call (excluded from `v1-service-allowed.ts`; in the gap list); degraded in standalone, and the only member of the shim's `BANNER_WORTHY` set (`webview-shim.ts:22`), so it surfaces a roadmap banner instead of failing silently |

## Learning Center
| Feature | Standalone | Note |
|---|---|---|
| Learning quizzes | ✅ | `generateLearningQuiz` (`v1-service-allowed.ts`) via bridge; `page-learning.ts` reachable via Level Up (`page-experiments.ts` imports it) |
| Code comparison | ✅ | `generateCodeComparison` (`v1-service-allowed.ts`) |
| Did-You-Know | ✅ | `generateDidYouKnow` (`v1-service-allowed.ts`) |
| Learning resources | ✅ | `generateLearningResources` (`v1-service-allowed.ts`) |
| Quiz personalization | ⚠️ | uses `getWorkspaceDeps` (`page-learning.ts:684` region) and `getCodeProduction`; real deps for all harnesses once a session records a directory (`workspaceRootPath`), generic fallback when no resolvable directory was recorded |

## Data exploration & rule playground
| Feature | Standalone | Note |
|---|---|---|
| Data Explorer | ✅ | `getDataExplorer` (`v1-allowed.ts`); `data-explorer` route (`app.ts:605`) + nav link injected by `standalone-html.ts:81` (deep-link-only upstream) |
| Rule Playground (eval) | ✅ | `evaluateExpression` (`v1-allowed.ts`); `rule-playground` route (`app.ts:606`) + nav link injected (`standalone-html.ts:82`, same injected "Explore" group) |
| NL→rule compile | ✅ | `compileNlRule` (`v1-allowed.ts`); degrades to a heuristic template offline (never errors) |
| Explain occurrence / generate rule | ✅ | `explainOccurrence`/`generateRule` (`v1-allowed.ts`); `generateRule` has a template fallback offline |
| Metric DSL reference | ✅ | static reference panel (`page-dsl-reference.ts`, imported by `page-antipatterns.ts`), reachable via the Anti-Patterns / Rule-Editor surface; no RPC method (pure static content) |

## LLM provider tier (cross-cutting enabler)
| Feature | Standalone | Note |
|---|---|---|
| LLM provider wiring | ✅ | `vscode.lm` implemented in `vscode-stub.ts` over `llm-provider.ts` (Anthropic/OpenAI, non-streaming, auto-detected by `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`); one seam lights up `panel-llm.ts` + `core/rule-compiler.ts` with zero core edits. Re-verified this sync: `build:standalone` emits no import-is-undefined warning, so the stub still covers upstream's `vscode.lm`/`LanguageModel*` surface |
| AI context-file review | ✅ | `reviewContextFiles` (`v1-service-allowed.ts`) via bridge; the `reviewProgress` event is forwarded over WebSocket to the requesting socket |
| No-key fallback | ✅ | LLM methods surface a standalone hint ("Set ANTHROPIC_API_KEY or OPENAI_API_KEY to enable AI features.", `llm-unavailable.ts`) instead of the upstream Copilot string (`capabilities.ts:41`); `compileNlRule`/`generateRule` fall back to heuristic/template |
| Host/LLM capability probe (`getCapabilities`) | ❌ | Returns `{host, llm}` and is called once at webview boot (`capabilities.ts:23`, driven from `app.ts:378`) to gate Skill-Finder + Level-Up nav visibility. NOT exposed in any standalone tier — but the webview defaults to `{host:'vscode', llm:true}` and **keeps that default on RPC failure** (`capabilities.ts:19` + try/catch), so standalone degrades *up* to full capability, which is correct (the standalone build has its own provider). Off-allowlist by design |

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
| `@aicoach` chat participant | ⛔ | `contributes.chatParticipants` `aicoach` → `src/chat/participant.ts` + `system-prompt.ts` (slash commands: summary / improve / compare / flow) — requires the VS Code chat sidebar |
| MCP language-model tools | ⛔ | `contributes.languageModelTools` (12 `aiEngineerCoach_*` tools) → `src/mcp/tools.ts` + `formatters.ts` — requires an MCP host / the VS Code LM API |
| Extension commands | ⛔ | `contributes.commands`: `aiEngineerCoach.open` / `.reload` / `.exportSummary` / `.reviewLocalRules` — command-palette entries with no browser analog (the standalone CLI + UI cover open/reload/export natively; `reviewLocalRules` is tracked as ❌ above) |
| Output channel (`showOutput`) | ⛔ | Reveals the "AI Engineer Coach" VS Code OutputChannel via `vscode.commands.executeCommand('aiEngineerCoach.showOutput')`. No browser analog — the skipped-banner "View details" link (`app.ts:397`) that calls it is inert in standalone; a fork equivalent would be an in-DOM detail panel, not this method |
| Copilot-app "canvas" host | ⛔ | Upstream **delivery host** (`src/canvas/host.ts` + `.github/extensions/`): runs the same webview dashboard inside the GitHub Copilot desktop app over a plain-Node HTTP/SSE bridge (read-only, `llm:false`). Not a dashboard capability — the fork's **standalone browser build is the parallel out-of-VS-Code host**, so there is nothing to reproduce |

## Appendix — RPC surface tripwire (machine signal)

Live `parity-gap.mjs` output (header + counts), pasted on every rebuild. Supporting signal
only — not the doc's structure.

```
# parity-gap — derived 81d8eb2 (merge-base) -> re-verified 18b1a3d (upstream/main), 62 behind

V1_ALLOWED         = 52   OK
V1_SERVICE_ALLOWED = 15   OK
STANDALONE_NATIVE  = 1    OK
exposed (union)    = 68   OK
universe (upstream)= 79
gap                = 11   (universe \ exposed)
```

Gap methods (11, `universe \ exposed`) and the feature row each maps to:
`calibrateRule` · `runRuleTests` → Rule calibration / rule test-suite ❌ (no shipped page reaches
them); `createSkill` → Create skill ⚠️; `getSdlcGitHubData` → SDLC GitHub data ❌;
`reviewLocalRules` → Local-rule trust approval ❌;
`saveModelBudgets` · `loadModelBudgets` → Model-budget persistence ❌ (silent degradation,
`page-burndown.ts:95/103/…`); `getCapabilities` → Host/LLM capability probe ❌ (graceful
full-capability fallback); `showOutput` → Output channel ⛔ (VS Code OutputChannel, no browser
analog); `getGitHubAppMetrics` · `getGitHubAppIssueCredits` → GitHub App analytics ⚠️.

**Newly-appeared upstream RPC methods needing an allowlist decision (2):**
`getGitHubAppMetrics` and `getGitHubAppIssueCredits` (both added this sync, `rpc-types.ts:82–83`).
**Decision — left off-allowlist this sync, but both are genuine allowlist candidates, unlike
every prior gap method.** Their handlers are registry-resident (`panel-rpc.ts:730–731`) and their
data source is pure Node (`~/.copilot/data.db` read by spawning the `sqlite3` CLI,
`github-app-database.ts:39–46`) with **no VS Code API**, so adding them to `v1-allowed.ts` would
light both pages up through the existing Tier-3b path with no core edit. Two caveats before
exposing: the host needs a `sqlite3` binary on `PATH`, and the data only exists for GitHub
Copilot App users. **Cost of leaving them off is not zero** — the boot probe's `.catch()` maps
the rejection to `status:'unavailable'`, which is *not* `'absent'`, so the nav group un-hides and
shows two permanently empty pages (see the GitHub App analytics rows). Either allowlist them or
add a native handler returning `{status:'absent'}` to restore the hidden default.

**Known-red tests unrelated to parity** (re-confirmed this sync, all on code byte-identical to
upstream): 7 `github-app-analytics.test.ts` failures from a missing `sqlite3` binary on the dev
host, 1 `page-github-app-issue-credits.test.ts` failure from a locale-dependent assertion
(`75.0%` vs `75,0%` under `de-AT`) — both upstream bugs worth upstreaming, not fork drift — and
the long-standing `parser-codex` slow-disk timeout.
