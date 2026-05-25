# Standalone UI Feasibility Report

Assessment of porting the AI Engineer Coach dashboard out of VS Code into a
standalone application.

**Verdict: high feasibility, low-risk.** Two rounds of codebase verification
collapsed the original risks to non-issues and surfaced reuse paths that
keep the entire fork additive (zero edits to upstream files). v1 is a
local web server delivered as an npm-installable CLI. Estimated effort
**2–3 days** for read-only analytics parity. Estimated new code surface
**~370 LOC**, all under `src/standalone/` + `bin/`.

## Motivation

1. **Personal friction reduction.** View coding-session telemetry without
   opening VS Code — from a terminal, from another IDE (JetBrains, Cursor),
   or from a CLI-only workflow.
2. **Audience expansion.** Today the dashboard is gated to people who
   already run VS Code. A standalone build reaches JetBrains / Cursor /
   Xcode / CLI-only developers — every developer who already has Node
   installed.

These two goals justify the work. They also constrain it: rule authoring,
DSL playgrounds, and LLM-backed skill generation are *content-creation*
features that don't serve either motivation, so they're out of scope for
v1 (see [Scope](#scope-decisions-v1)).

## Architecture findings

- `src/core/` — parsers (Claude, Codex, OpenCode, VS Code Copilot, Xcode),
  analyzers, rule engine, DSL, cache. **Zero `vscode` imports.** Pure Node
  + TypeScript. Ports unchanged.
- `src/webview/` — Preact app (`app.ts` entry, ~30 `page-*.ts` files,
  chart.js, htm). Renders as HTML/CSS/JS, runs in any browser.
- Only 7 files import from `vscode`: `src/extension.ts` plus six in
  `src/webview/` (host-side panel/sidebar shell, not the Preact UI).
- Log discovery uses `process.env.HOME || process.env.USERPROFILE` and
  `os.homedir()`. No dependency on workspace context.
- `src/core/rule-loader.ts` already accepts `workspaceRoot?: string` and
  skips the project rule layer when undefined (`loadAllRuleLayers` at
  `:116`, `:119`). Dropping project rules requires **zero** code changes.
- `src/webview/panel-rpc.ts` uses a registry pattern at `:631`:
  `rpcHandlers: TypedRpcHandlers = { method: (a, _p, params) => ... }`,
  exposed via `getRpcHandler(method)` at `:1284`. The vscode references
  *in this file* are all lazy `require('vscode')` inside handlers we're
  dropping (LLM methods at `:910`/`:1006`, `reviewLocalRules` at `:855`,
  `workspaceRoot` lookup at `:741`). The read-only handlers are vscode-free.
- **Correction (caught during spec review):** `panel-rpc.ts` is *not*
  vscode-free at module level once you follow its imports. `panel-rpc.ts:39`
  imports `errorResult` from `./panel-shared`, and `panel-shared.ts:7`
  has a **top-level** `import * as vscode from 'vscode'`. Importing
  `getRpcHandler` therefore loads `vscode` eagerly. The whole `src/core`
  tree is genuinely clean (one lazy `require` in `rule-compiler.ts:77`),
  but the webview-side `panel-shared` is not. Fix: alias `vscode` to a
  stub in the standalone esbuild build and the vitest config (see
  [specs/00-overview](specs/00-overview.md#additive-only-fork-discipline)).
  This keeps the reuse-as-a-library strategy intact; it just needs the
  alias to be deterministic rather than relying on tree-shaking.
- `src/webview/shared.ts:9` calls `acquireVsCodeApi()` at module load. In a
  non-VS-Code browser this throws `ReferenceError` before any UI renders.
  Bridgeable with a polyfill (see [Webview API shim](#webview-api-shim)).
- Build pipeline (`esbuild.mjs`): the webview is already bundled as a
  browser-target IIFE to `dist/webview/app.js`, with CSS concatenated to
  `dist/webview/styles.css`. Reusable as static files with zero rebuild
  config changes.

## Distribution and target form factor

**Decision: local web server, distributed as an npm CLI.**

- Primary install: `npm install -g @JuliusGruber/ai-engineer-coach`, then
  run `coach`. Opens a browser tab to the local server.
- Trial path: `npx @JuliusGruber/ai-engineer-coach` — no commit needed.
- Requires Node 20+ (same as the extension's `engines.node`).

Why this and not Electron / Tauri:
- Lowest effort, fastest dev loop, no native build pipeline. The dev loop
  matters because motivation (1) means *you* need to actually use it.
- Reaches the realistic v1 audience (every dev who already has Node, which
  includes essentially all JetBrains / Cursor / CLI users).
- Electron's value-add (dock icon, native menus, auto-update) doesn't
  repay the macOS signing / notarization tax for an unproven v1.
- Tauri would require either a Node sidecar (defeats the binary-size win)
  or a Rust port of the core (larger than the entire standalone project).
- A prebuilt single-file binary (Bun/Deno/pkg compile) can be added in v2
  if any user without Node asks for it.

## Scope decisions (v1)

| Feature                  | v1 | Notes                                                            |
|--------------------------|----|------------------------------------------------------------------|
| Read-only analytics      | ✅  | All ~50 read-only RPC methods                                    |
| Session list + detail    | ✅  | Core viewing experience                                          |
| Date / harness filters   | ✅  | Already host-agnostic                                            |
| Builtin + personal rules | ✅  | Loaded from `~/.ai-engineer-coach/rules/` (read-only)            |
| Project-scoped rules     | ❌  | Out — see below. Re-add as v2 via `--project` flag               |
| Trust approval dialog    | ❌  | Moot without project rules                                       |
| Activity-bar sidebar     | ❌  | VS Code surface; no equivalent in browser context                |
| Rule authoring / save    | ❌  | Hidden from nav. Direct URL → roadmap banner                     |
| DSL playground           | ❌  | Hidden from nav                                                  |
| LLM-backed features      | ❌  | Skill gen, learning quiz, etc. Defer to v2 with key UX           |
| `openExternal`           | ✅  | Replace with `open` npm package                                  |
| Model budgets persist    | ✅  | JSON file in `~/.ai-engineer-coach/state.json`                   |

**Why drop project rules in v1:** the 80/20 use-case for a standalone
telemetry dashboard is "show me my coding sessions across all my tools",
not "evaluate this specific repo against custom rules". Custom-rule
authors are a power-user subset already served by the VS Code extension.
Dropping the project layer also drops the trust-approval dialog, the
workspace-folder picker, and the sidebar — together the most-divergent
pieces from upstream, which keeps the diff small.

**v2 path for project rules:** add `coach --project <path>`. Trust state
persists in `~/.ai-engineer-coach/trust.json`. UI gains a "Switch project"
picker backed by a folder-pick dialog. `getRuleLayerInfo()` already
returns the project layer when `workspaceRoot` is set, so no UI surgery
needed — only a route to set/clear the root and a trust modal.

### Disabled-feature UX

Hidden-from-nav by default; direct-URL hits show a roadmap-honest banner.
Copy: *"Rule authoring / DSL / LLM features are coming to standalone in
v2. Today they live in the VS Code extension: [docs link]."*

| Page                  | v1 behavior                                                                          |
|-----------------------|--------------------------------------------------------------------------------------|
| `rule-editor`         | Hidden from nav. Direct URL → banner.                                                |
| `rule-playground`     | Hidden from nav. Direct URL → banner.                                                |
| `antipatterns-editor` | Hidden from nav. Direct URL → banner.                                                |
| `data-explorer`       | Hidden from nav. Direct URL → banner.                                                |
| `skills`              | **Visible, catalog-browse only.** `getRegistryCatalog` (allowlisted) works; `triageSkills`/`discoverCatalog`/`installSkill`/`generateSkillContent` are disabled (triage/discover silent-disabled, generate/install banner-worthy). *(Corrected: earlier "shows installed skills read-only" overstated it — its core list came from disabled methods.)* |
| `learning` + variants | Hidden from nav. Quiz / comparison / did-you-know are pure-LLM, no read-only path.   |
| `dsl-reference`       | **Visible** if it's static docs (verify on first build); else hidden.                |
| `sdlc`                | **Hidden.** *(Corrected: was "Visible, read-only repo/PR data works".)* Its data (`getSdlcRepoScan`/`getSdlcToolAnalysis`/`getSdlcGitHubData`) lives in the dropped `PanelRequestService`, so the page would render empty. Hidden via `HIDDEN_IN_STANDALONE_V1`; silent-disabled (no banner). |
| `dashboard`           | **Visible.** Its skill-suggestion section (`triageSkills`/`discoverCatalog`/`triageCatalog`) is silent-disabled and renders empty; everything else works. The shim must **not** banner these (see below). |
| Everything else       | Visible; note `config-health`'s context-review section (`reviewContextFiles`) is silent-disabled.                |

The nav is hardcoded in `panel-html.ts`; the standalone HTML wrapper
omits the hidden entries. The **server** (dispatcher) returns a
data-nested `{ data: { error, code: 'standalone-v1-disabled', method } }`
for any method not in `V1_ALLOWED` or `STANDALONE_NATIVE`, so direct
deep-links never crash. The **shim** then decides whether to show the
roadmap banner — only for a curated `BANNER_WORTHY` set, because visible
pages (the dashboard especially) fire disabled methods proactively and a
blanket banner would pop on the home screen. See
[specs/00-overview](specs/00-overview.md#disabled-method-ux-banner-vs-silent)
and the per-page audit in [specs/08-testing](specs/08-testing.md).

## Implementation strategy

### Webview API shim

`src/webview/shared.ts:9` calls `acquireVsCodeApi()` at module-load time.
Approach: define a `globalThis.acquireVsCodeApi` polyfill **before**
`app.js` loads.

> **Correction (spec review): external shim, not inline.** An earlier
> draft injected the polyfill as an *inline* `<script>`. That is
> incompatible with the chosen CSP (`script-src 'self'`, no nonce) — the
> browser would block it and `acquireVsCodeApi` would never be defined.
> The shim is therefore served as an **external** `/standalone-shim.js`,
> and the auth token is delivered via a `<meta name="coach-token">` tag
> (the `coach_token` cookie is `HttpOnly`, so JS can't read it for the
> `ws://…?t=` URL). See [specs/04-webview-shim](specs/04-webview-shim.md).
> The sketch below is retained for intent only; the spec is canonical.

```ts
// src/standalone/webview-shim.ts — SUPERSEDED: now an external /standalone-shim.js (reads token from <meta>)
(() => {
  const ws = new WebSocket(`ws://${location.host}/rpc?t=${TOKEN}`);
  ws.addEventListener('message', (ev) => {
    // Existing listener in shared.ts:57 reads ev.data; we forward.
    window.postMessage(JSON.parse(ev.data), '*');
  });
  globalThis.acquireVsCodeApi = () => ({
    postMessage: (msg) => ws.send(JSON.stringify(msg)),
    getState:    () => JSON.parse(localStorage.getItem('coach-state') ?? 'null'),
    setState:    (s) => localStorage.setItem('coach-state', JSON.stringify(s)),
  });
})();
```

The webview bundle is touched zero times — additive-only holds. Existing
unit tests (`webview-smoke.test.ts:19`) already stub `acquireVsCodeApi`
the same way, so this is the production form of an already-tested
pattern.

### Host-side RPC reuse

`panel-rpc.ts` is reused **as a library**. The standalone dispatcher
imports `getRpcHandler` and gates with an explicit v1 allowlist:

```ts
// src/standalone/dispatcher.ts (sketch)
import { getRpcHandler } from '../webview/panel-rpc';

const V1_ALLOWED = new Set([
  'getWorkspaces', 'getHarnesses', 'getHarnessBreakdown',
  'getDailyActivity', 'getWorkspaceBreakdown', 'getHourlyDistribution',
  'getHeatmap', 'getCodeProduction', 'getConsumption', 'getBurndown',
  'getAiCredits', 'getAiCreditBurndown', 'getTokenCoverage',
  'getDayTimeline', 'getSessions', 'getSessionDetail',
  'getWorkLifeBalance', 'getAntiPatterns', 'getHarnessComparison',
  'getParserCoverage', 'getParserPreview', 'getWorkflowOptimization',
  'getStats', 'getConfigHealth', 'getInsights', 'getFlowState',
  'getContextManagement', 'getWorkspaceContextSessions',
  'getContextRangeAvailability', 'getCalendarActivity',
  'getProjectOverview', 'getImageGallery', 'getSessionImages',
  'getRuleCoverage', 'getFieldSchema', 'getMetricPrimitives',
  'getFunctionCatalog', 'getMetricList', 'getDataExplorerFields',
  'getRegistryCatalog',
]);

export async function dispatch(method, params, analyzer, parseResult) {
  if (!V1_ALLOWED.has(method)) return { error: 'standalone-v1-disabled' };
  const handler = getRpcHandler(method);
  if (!handler) return { error: `Unknown method: ${method}` };
  return handler(analyzer, parseResult, params);
}
```

> **Corrections (spec review):** this sketch is two tiers short and uses
> the wrong error shape. The real dispatcher is **three-tier** — a
> front-of-line `STANDALONE_NATIVE` table (for `openExternal`,
> `loadModelBudgets`, `saveModelBudgets`, which the webview calls but the
> registry doesn't define) runs *before* the allowlist gate. And errors
> must ride **inside `data`** (`{ data: { error, code, method } }`), not
> as a sibling `error`: the unmodified webview reads `data.error`
> (`shared.ts:62`); a sibling field would silently `resolve(undefined)`.
> See [specs/02-dispatcher](specs/02-dispatcher.md) and
> [specs/00-overview](specs/00-overview.md#rpc-contract).

**Reachability caveat:** `getRuleEditor` (panel-rpc.ts:740) does
`require('vscode')` inside try/catch. In a standalone Node process this
will throw (no `vscode` module). The try/catch swallows it and continues
with `workspaceRoot = undefined`, so it's harmless — but to avoid the
runtime error in logs, `getRuleEditor` is **deliberately excluded** from
the v1 allowlist.

### Standalone HTML wrapper

`panel-html.ts` (82 lines) is mostly inline nav SVGs + CSP + script tag,
generated dynamically with `webview.asWebviewUri(...)` and a nonce. The
standalone version lives in `src/standalone/standalone-html.ts` as a
near-duplicate, with:
- URI generation: plain `/dist/webview/app.js` and `/dist/webview/styles.css`
- CSP: `default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; font-src 'self'`
- Nav: hidden entries (per [Disabled-feature UX](#disabled-feature-ux)) removed
- Inline polyfill `<script>` injected before `<script src="app.js">`

Cost: ~80 LOC duplication. Drift risk: if upstream edits the nav in
`panel-html.ts`, the standalone version doesn't pick it up. Accepted for
v1; revisit if the nav changes frequently.

### Code-surface estimate

| Module                        | Path                                  | LOC  |
|-------------------------------|---------------------------------------|------|
| Server (Express + ws)         | `src/standalone/server.ts`            | ~100 |
| Dispatcher (allowlist bridge) | `src/standalone/dispatcher.ts`        | ~30  |
| HTML wrapper                  | `src/standalone/standalone-html.ts`   | ~80  |
| Polyfill (external `/standalone-shim.js`) | `src/standalone/webview-shim.ts`  | ~55  |
| CLI (token, port, browser open) | `src/standalone/cli.ts` + `bin/coach` | ~80  |
| Build glue                    | `esbuild.mjs` additions               | ~50  |
| **Total new**                 |                                       | **~370** |
| **Upstream edits**            |                                       | **0** |

## Host-side glue to replace

| VS Code API                              | Purpose                              | v1 replacement                                                  |
|------------------------------------------|--------------------------------------|-----------------------------------------------------------------|
| `createWebviewPanel` + `postMessage`     | Hosts the Preact UI                  | Express + static `dist/webview/`, single `/rpc` WebSocket       |
| `registerCommand` (3)                    | open / reload / reviewLocalRules     | HTTP routes (open is automatic via browser opening on boot)     |
| `context.globalState`                    | Persists trust + model budgets       | JSON file at `~/.ai-engineer-coach/state.json`                  |
| `showWarningMessage` + `showQuickPick`   | "Approve local rule files"           | **Dropped** — moot without project rules in v1                  |
| `workspaceFolders[0].uri.fsPath`         | Source for project-scoped rules      | **Dropped** in v1; `--project <path>` flag in v2                |
| `env.openExternal`                       | Open URL from webview                | `open` npm package                                              |
| `createOutputChannel`                    | Logging                              | Console (and `--log-file` flag if needed)                       |
| `registerWebviewViewProvider`            | Activity-bar sidebar                 | **Dropped** — no equivalent in browser context                  |
| `acquireVsCodeApi()` (webview-side)      | postMessage transport                | Inline polyfill bridging to WebSocket                           |

## RPC contract

Webview ↔ host uses:

- `{ type: 'request', id, method, params }` → `{ type: 'response', id, data }`
- Server-pushed `{ type: 'progress', ... }` and `{ type: 'dataReady', ... }` events

Method namespace is typed in `src/core/types/rpc-types.ts`:

- `RpcMethodMap`: **74 methods** (read-only analytics, rule authoring, DSL).
- `ExtensionMethodMap` (extends): **+18 extension-only methods** (LLM-backed
  skill generation, GitHub data, etc.).
- **Total: 92 methods.** (Earlier draft said ~40; that was wrong.)

For v1, **~40 methods** are on the allowlist (see
[Host-side RPC reuse](#host-side-rpc-reuse) for the exact set). They all
flow through `Analyzer` + a `DateFilter` via the existing `rpcHandlers`
registry, so wiring is a one-line dispatcher.

Transport: WebSocket multiplexer for everything (requests, responses, and
push events on one channel). Avoids the HTTP-POST-per-method + separate
WS split.

## Security model

- **Bind address:** `127.0.0.1` only. No LAN exposure in v1. `--host`
  opt-in for LAN viewing is a v2 addition.
- **Auth:** random token in URL on boot
  (`http://127.0.0.1:7331/?t=<hex>`). Requests without the token are 401.
  This is the
  [Jupyter model](https://jupyter-notebook.readthedocs.io/en/stable/security.html)
  — it defends against other local processes scraping the API. Token
  persists in `~/.ai-engineer-coach/server-state.json` so re-runs reopen
  the same URL.
- **Multi-instance:** single instance on port 7331. Second `coach`
  invocation detects the port is taken, GETs `/health`, confirms it's our
  server, opens the same URL + token in the browser, exits. Matches the
  `code .` mental model.
- **CSP:** standard `default-src 'self'; style-src 'self' 'unsafe-inline';
  script-src 'self'; img-src 'self' data:; font-src 'self'` header. No
  nonce dance — the VS Code webview's CSP straitjacket doesn't apply when
  we serve `dist/webview/` as static files from our own origin.
  **Implication (spec review):** keeping `script-src 'self'` with no nonce
  means there can be **no inline `<script>`** — including the shim. The
  shim is served as an external `/standalone-shim.js`; the token reaches
  it via a `<meta name="coach-token">` tag, since the `HttpOnly` cookie is
  unreadable from JS. "No nonce dance" holds precisely *because* we went
  external rather than inline.

## Cache and state co-existence

The extension and standalone can be installed and running simultaneously
on the same machine. Disk layout today:

| Path                                       | Owner             | Notes                                            |
|--------------------------------------------|-------------------|--------------------------------------------------|
| `~/.copilot-analytics-cache/parsed.json`   | core (shared)     | ~200MB parsed-session cache. No lock, no atomic. |
| `~/.copilot-analytics-cache/meta.json`     | core (shared)     | Cache validation metadata                        |
| `~/.ai-engineer-coach/rules/`              | core (shared, RO) | Personal rule markdown                           |
| `~/.ai-engineer-coach/metrics/`            | core (shared, RO) | Personal `.metric.md` files                      |
| VS Code `context.globalState`              | extension only    | Trust approvals, model budgets                   |
| `~/.ai-engineer-coach/state.json` *(new)*  | standalone only   | Standalone model budgets, last-used filter       |
| `~/.ai-engineer-coach/server-state.json` *(new)* | standalone only | Port + token for single-instance reuse       |

**Decisions:**
- **Share the cache.** Both processes read/write `~/.copilot-analytics-cache/`.
  Race window is small (writes happen once per parse, at end). Worst case:
  cache corruption → next read invalidates → re-parse. Self-healing.
- **Separate preferences.** Standalone model budgets live in
  `~/.ai-engineer-coach/state.json`; extension keeps using globalState. Set
  a budget in one, the other doesn't see it. Annoying but isolated. (No
  cross-process IPC, no poking into VS Code internals.)
- **Allow concurrent runs.** No lock detection; trust the cache's
  invalidation path. Document the rare race in the README. If real-world
  corruption proves more frequent than predicted, add lock detection in
  v1.1.

Standalone startup sequence (**serve-then-parse** — corrected to match
[specs/05-cli](specs/05-cli.md) / [specs/01-server](specs/01-server.md)):
1. Try to bind 127.0.0.1:7331 → if taken, GET `/health` → if ours, open
   browser to the existing URL+token and exit.
2. Start the server **immediately** (no parsed data yet) and open the
   browser — the webview shows its loading shell.
3. Drive the parse (`findLogsDirs` → `parseAllLogsViaWorker` → build
   `Analyzer`), forwarding `progress` frames to the browser.
4. On completion, `handle.setData(analyzer, parseResult)` broadcasts
   `dataReady` — the webview flips from loading shell to rendered
   dashboard. (The webview gates **all** rendering on `dataReady`, which
   is synthesized here, not emitted by any core module — so it is
   mandatory, not a deferrable "push". Only the live `progress` bar is
   deferrable.)
5. Model budgets / last-used filter live in
   `~/.ai-engineer-coach/state.json`; a warm `parsed.json` makes step 3
   near-instant.

## Privacy commitments

The extension makes **zero phone-home calls** today (no
`vscode-extension-telemetry`, no `applicationinsights`, no
`@microsoft/1ds-*` dependencies). The standalone preserves this bar
explicitly.

Commitments documented in README and the in-app About page:

1. **No analytics, no telemetry, no usage tracking.** Ever.
2. **No automatic version checks.** Run `npm outdated -g
   @JuliusGruber/ai-engineer-coach` to see updates.
3. **No crash reporting.** Errors go to stderr and the in-app console;
   report manually via GitHub issues.
4. **Network calls only happen for user-initiated UI actions** — e.g.,
   browsing the GitHub skill catalog (`github.com/github/awesome-copilot`)
   or following a user-typed URL. Same behavior as the extension.
5. **All session data stays on `127.0.0.1`.** It never leaves your machine
   via this tool.

This is a marketing asset for motivation (b): privacy-conscious developers
(JetBrains / CLI / Xcode users skew this way) get a binary commitment, not
a buried opt-out.

## Risk register (all verified, none are showstoppers)

| Risk                                     | Status                | Evidence                                                                                                  |
|------------------------------------------|-----------------------|-----------------------------------------------------------------------------------------------------------|
| `--vscode-*` CSS variables               | ✅ Non-issue          | All 84 refs in kept files use `var(--vscode-X, FALLBACK)` with Dark+ defaults. Browser uses fallbacks. `styles-sidebar.css` has 16 unfallbacked refs but the sidebar is dropped. |
| Webview CSP nonce scheme                 | ✅ Non-issue          | Standalone serves static files from own origin; standard CSP header suffices.                             |
| Worker threads touch `vscode.workspace.fs` | ✅ Non-issue        | `parse-worker.ts`, `cache-write-worker.ts`, `warm-up-worker.ts` import only `worker_threads` / `fs` / sibling core. Zero `vscode` refs. `parse-worker.ts:26` already supports `process.send` IPC, so the worker pool is host-agnostic today. |
| RPC method count higher than estimated   | 🟡 Adjusted           | 92 total, not ~40. ~40 needed for v1 (read-only allowlist). Mitigated by reusing existing `rpcHandlers` registry.                                                  |
| `panel-rpc.ts` requires `vscode` at runtime | 🟡 Adjusted — alias stub | The lazy `require('vscode')` calls inside dropped handlers are harmless. **But** `panel-rpc.ts:39` → `panel-shared.ts:7` is a **top-level** `import * as vscode`, loaded eagerly when `getRpcHandler` is imported. Mitigated by aliasing `vscode` → `src/standalone/vscode-stub.ts` in the standalone esbuild build and vitest config (deterministic; does not rely on tree-shaking). See [specs/02-dispatcher](specs/02-dispatcher.md#transitive-vscode-import). |
| Inline shim blocked by CSP | 🟡 Adjusted — external shim | `script-src 'self'` (no nonce) blocks an inline polyfill. The shim is served as external `/standalone-shim.js`; token via `<meta name="coach-token">`. See [specs/04-webview-shim](specs/04-webview-shim.md). |
| `dataReady` not emitted by core | 🟡 Adjusted — synthesized by CLI | `progress`/`dataReady` were produced by the dropped `panel.ts`, not the core. The webview gates rendering on `dataReady`, so the CLI must synthesize it after parse via `handle.setData(...)`. Mandatory, not deferrable. See [specs/01-server](specs/01-server.md). |
| Webview calls non-registry methods | 🟡 Adjusted — native table | `openExternal` + model budgets (called by visible pages) aren't in `getRpcHandler`. Reimplemented as front-of-line `STANDALONE_NATIVE` handlers. See [specs/02-dispatcher](specs/02-dispatcher.md). |
| Webview bundle calls `acquireVsCodeApi()` at module load | ✅ Mitigated | Inline polyfill in standalone HTML defines `globalThis.acquireVsCodeApi` before `app.js` runs. Zero edits to webview bundle.                                       |
| Concurrent cache writes (extension + standalone) | 🟡 Accepted   | No lock files in current cache code. Race window is small; corruption is self-healing via cache invalidation. Document in README. Add locking in v1.1 if real-world frequency justifies. |
| Standalone HTML wrapper drifts from upstream nav | 🟡 Accepted  | `standalone-html.ts` duplicates `panel-html.ts` nav structure (~80 LOC). Will drift if upstream edits nav. Accepted for v1; if churn is frequent, refactor to a shared nav model.                                                 |

## Upstream sync strategy

**Decision: additive-only fork.**

Rule: no edits to upstream files outside the new directories below.

| Path                  | Owner    | Notes                                                            |
|-----------------------|----------|------------------------------------------------------------------|
| `src/standalone/`     | Fork     | New: `server.ts`, `auth.ts`, `image-route.ts`, `cli.ts`, `flags.ts`, `parse-bootstrap.ts`, `dispatcher.ts`, `v1-allowed.ts`, `standalone-native.ts`, `standalone-html.ts`, `nav-config.ts`, `webview-shim.ts`, `state.ts`, `vscode-stub.ts` |
| `bin/coach`           | Fork     | New: CLI entry script (Node shebang; npm `cmd-shim` handles Windows) |
| `docs-fork/`          | Fork     | New: fork-specific docs (this file)                              |
| `package.json`        | Shared   | Add `bin`, `scripts.serve`, `express` + `ws` deps only           |
| `esbuild.mjs`         | Shared   | Add bundle entries for `src/standalone/*` and asset copy         |
| `src/core/`           | Upstream | **Do not edit.** Use as-is.                                      |
| `src/webview/`        | Upstream | **Do not edit.** Bundle as-is, serve as static files, import `panel-rpc` as a library. |
| `src/extension.ts`    | Upstream | **Do not edit.** The extension still ships from this repo unchanged. |
| Everything else       | Upstream | Don't touch.                                                     |

This discipline means upstream merges only conflict on `package.json` and
`esbuild.mjs`, and even those resolve cleanly because the fork's additions
are new keys / new build entries. Pulling a new upstream release is `git
pull upstream main` + a quick package.json resolution.

**Stretch goal:** once v1 ships and proves the shape, propose `coach
serve` to upstream as a PR. The additive-only discipline keeps the diff
small enough to be a credible proposal (~370 LOC, all new).

## Recommended path

Local web server, additive fork, ~370 LOC new code under `src/standalone/`
+ `bin/`, zero LOC edited in upstream files.

Day-by-day plan:
- **Day 1:** Server skeleton (Express + ws + single-instance + token).
  HTML wrapper. Polyfill. Dispatcher with allowlist. Walking skeleton:
  dashboard loads end-to-end with `getDashboardData`-equivalent calls.
- **Day 2:** Wire the rest of the ~40 allowlisted RPC methods (mostly
  free via `getRpcHandler` registry — actual work is per-page smoke-testing
  in the browser). Disabled-feature banner. State persistence. CLI polish
  (token reopen, browser open, `--port`).
- **Day 3:** Cross-platform testing (macOS / Linux / Windows). Playwright
  smoke test. npm publish to `@JuliusGruber` scope. Verify
  `npx @JuliusGruber/ai-engineer-coach` works on a clean machine.

## v1 acceptance criteria

1. `npm install -g @JuliusGruber/ai-engineer-coach && coach` boots, opens
   a browser tab, dashboard renders end-to-end.
2. All Claude / Codex / OpenCode / VS Code Copilot / Xcode sessions
   detected via `~/.{claude,codex,opencode,vscode,xcode}` paths are
   visible without configuration.
3. Date filter, harness filter, session list, session detail, and every
   visible analytics page render with real data.
4. Hidden pages (rule-editor, rule-playground, antipatterns-editor,
   data-explorer, learning) do not appear in nav. Direct URL hits to
   those pages show a roadmap banner.
5. Smoke test: playwright script visits each visible page route, asserts
   no console errors.
6. Security: `127.0.0.1:7331` bind, token in URL, single-instance reuse
   via `/health` probe.
7. Tested on macOS, Linux, Windows.
8. Published to npm as `@JuliusGruber/ai-engineer-coach` with `bin: coach`.
9. `npx @JuliusGruber/ai-engineer-coach` works from a clean machine.
10. Zero network calls except user-initiated UI actions. Verified by
    running with `--inspect` and observing no outbound traffic during a
    full session.
11. Zero LOC edited under `src/core/`, `src/webview/`, `src/extension.ts`.
    Verified by `git diff upstream/main -- src/` showing only additions
    under `src/standalone/`.
12. MIT LICENSE and NOTICE from upstream preserved in the published
    package.

## v2 roadmap (not blocking v1)

- `coach --project <path>` — re-add project rule layer with trust
  persistence in `~/.ai-engineer-coach/trust.json`. UI gains "Switch
  project" picker.
- `coach --host 0.0.0.0` — LAN exposure for phone / second-machine
  viewing.
- LLM features behind `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` env vars —
  enables skill generation, learning quiz, code comparison,
  did-you-know.
- Prebuilt single-file binary (Bun/Deno/pkg compile) for the
  no-Node-installed audience, if anyone asks.
- Upstream PR proposal (`coach serve` opt-in inside microsoft/main).
- Optional Electron shell around the same JS bundle for users who want a
  dock icon (skipped in v1 due to signing tax).
- Cache lock file, if concurrent-run corruption proves a real problem.
- Shared-nav extraction in upstream (would let us remove the
  `standalone-html.ts` duplication).
