# Standalone UI Feasibility Report

Assessment of porting the AI Engineer Coach dashboard out of VS Code into a
standalone application.

**Verdict: high feasibility, low-risk.** Risks flagged in earlier drafts
were verified against the codebase and downgraded to non-issues. v1 is a
local web server delivered as an npm-installable CLI; estimated effort
**2–3 days** for read-only analytics parity.

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
features that don't serve either motivation, so they're out of scope for v1
(see [Scope](#scope-decisions-v1)).

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

| Feature                 | v1     | Notes                                                  |
|-------------------------|--------|--------------------------------------------------------|
| Read-only analytics     | ✅      | All ~50 read-only RPC methods                          |
| Session list + detail   | ✅      | Core viewing experience                                |
| Date / harness filters  | ✅      | Already host-agnostic                                  |
| Builtin + personal rules| ✅      | Loaded from `~/.ai-engineer-coach/rules/`              |
| Project-scoped rules    | ❌      | Out — see below. Re-add as v2 via `--project` flag     |
| Trust approval dialog   | ❌      | Moot without project rules                             |
| Activity-bar sidebar    | ❌      | VS Code surface; nothing equivalent in browser context |
| Rule authoring / save   | ❌      | Visible but disabled with "Use the VS Code extension"  |
| DSL playground          | ❌      | Same — power-user content creation                     |
| LLM-backed features     | ❌      | Skill gen, learning quiz, etc. Defer to v2 with key UX |
| `openExternal`          | ✅      | Replace with `open` npm package                        |
| Model budgets persist   | ✅      | JSON file in `~/.ai-engineer-coach/`                   |

**Why drop project rules in v1:** the 80/20 use-case for a standalone
telemetry dashboard is "show me my coding sessions across all my tools",
not "evaluate this specific repo against custom rules". Custom-rule
authors are a power-user subset already served by the VS Code extension.
Dropping the project layer also drops the trust-approval dialog, the
workspace-folder picker, and the sidebar — together the most-divergent
pieces from upstream, which keeps the diff small (see
[Upstream sync](#upstream-sync-strategy)).

**v2 path:** add `coach --project <path>`. Trust state persists in
`~/.ai-engineer-coach/trust.json`. UI gains a "Switch project" picker
backed by a folder-pick dialog. `getRuleLayerInfo()` already returns the
project layer when `workspaceRoot` is set, so no UI surgery needed — only
a route to set/clear the root and a trust modal.

## Host-side glue to replace

| VS Code API                         | Purpose                              | v1 replacement                                                  |
|-------------------------------------|--------------------------------------|-----------------------------------------------------------------|
| `createWebviewPanel` + `postMessage`| Hosts the Preact UI                  | Express + static `dist/webview/`, single `/rpc` endpoint, WS    |
| `registerCommand` (3)               | open / reload / reviewLocalRules     | HTTP routes (open is automatic via browser opening on boot)     |
| `context.globalState`               | Persists trust + model budgets       | JSON file in `~/.ai-engineer-coach/state.json`                  |
| `showWarningMessage` + `showQuickPick`| "Approve local rule files"         | **Dropped** — moot without project rules in v1                  |
| `workspaceFolders[0].uri.fsPath`    | Source for project-scoped rules      | **Dropped** in v1; `--project <path>` flag in v2                |
| `env.openExternal`                  | Open URL from webview                | `open` npm package                                              |
| `createOutputChannel`               | Logging                              | Console (and `--log-file` flag if needed)                       |
| `registerWebviewViewProvider`       | Activity-bar sidebar                 | **Dropped** — no equivalent in browser context                  |

## RPC contract

Webview ↔ host uses:

- `{ type: 'request', id, method, params }` → `{ type: 'response', id, data }`
- Server-pushed `{ type: 'progress', ... }` and `{ type: 'dataReady', ... }` events

Method namespace is typed in `src/core/types/rpc-types.ts`:

- `RpcMethodMap`: **74 methods** (read-only analytics, rule authoring, DSL).
- `ExtensionMethodMap` (extends): **+18 extension-only methods** (LLM-backed
  skill generation, GitHub data, etc.).
- **Total: 92 methods.** (Earlier draft said ~40; that was wrong.)

For v1, ~50 read-only methods need to work end-to-end. They all flow
through `Analyzer` + a `DateFilter`, so wiring is a single dispatch
function. The other ~42 methods return `{ error: 'Available in the VS Code
extension' }` and the UI shows a banner.

Transport: WebSocket multiplexer for everything (requests, responses, and
push events on one channel). Avoids the HTTP-POST-per-method + separate WS
split.

## Security model

- **Bind address:** `127.0.0.1` only. No LAN exposure in v1. `--host` opt-in
  for LAN viewing is a v2 addition.
- **Auth:** random token in URL on boot
  (`http://127.0.0.1:7331/?t=<hex>`). Requests without the token are 401.
  This is the [Jupyter model](https://jupyter-notebook.readthedocs.io/en/stable/security.html)
  — it defends against other local processes scraping the API. Token
  persists in `~/.ai-engineer-coach/server-state.json` so re-runs reopen
  the same URL.
- **Multi-instance:** single instance on port 7331. Second `coach`
  invocation detects the port is taken, GETs `/health`, confirms it's our
  server, opens the same URL + token in the browser, exits. Matches the
  `code .` mental model.
- **CSP:** standard `Content-Security-Policy: default-src 'self'` header.
  No nonce dance — the VS Code webview's CSP straitjacket doesn't apply
  when we serve `dist/webview/` as static files from our own origin.

## Risk register (all verified, none are showstoppers)

| Risk                              | Status         | Evidence                                                                                                                                |
|-----------------------------------|----------------|-----------------------------------------------------------------------------------------------------------------------------------------|
| `--vscode-*` CSS variables        | ✅ Non-issue   | All 84 refs in kept files use `var(--vscode-X, FALLBACK)` with Dark+ defaults. Browser uses fallbacks. (`styles-sidebar.css` has 16 unfallbacked refs but the sidebar is dropped.) |
| Webview CSP nonce scheme          | ✅ Non-issue   | Standalone serves static files from own origin; standard CSP header suffices.                                                           |
| Worker threads use `vscode.workspace.fs` | ✅ Non-issue | `parse-worker.ts`, `cache-write-worker.ts`, `warm-up-worker.ts` import only `worker_threads` / `fs` / sibling core. Zero `vscode` refs. Bonus: `parse-worker.ts:26` already supports `process.send` IPC, so the worker pool is host-agnostic today. |
| RPC method count higher than estimated | 🟡 Adjusted | 92 total, not ~40. ~50 needed for v1 (read-only). Mitigated by a single dispatch function over `Analyzer`.                              |

## Upstream sync strategy

**Decision: additive-only fork.**

Rule: no edits to upstream files outside the new directories below.

| Path                  | Owner    | Notes                                                          |
|-----------------------|----------|----------------------------------------------------------------|
| `src/standalone/`     | Fork     | New: `server.ts`, `cli.ts`, `dispatcher.ts`, `state.ts`, etc.  |
| `bin/coach`           | Fork     | New: CLI entry script                                          |
| `docs-fork/`          | Fork     | New: fork-specific docs (this file)                            |
| `package.json`        | Shared   | Add `bin`, `scripts.serve`, `express` + `ws` deps only         |
| `src/core/`           | Upstream | **Do not edit.** Use as-is.                                    |
| `src/webview/`        | Upstream | **Do not edit.** Bundle as-is, serve as static files.          |
| `src/extension.ts`    | Upstream | **Do not edit.** Untouched extension still ships from this repo. |
| Everything else       | Upstream | Don't touch.                                                   |

This discipline means upstream merges only conflict on `package.json`, and
even those resolve cleanly because the fork's additions are new keys.
Pulling a new upstream release is `git pull upstream main` + a quick
package.json resolution.

**Stretch goal:** once v1 ships and proves the shape, propose `coach
serve` to upstream as a PR. The additive-only discipline keeps the diff
small enough to be a credible proposal.

## Recommended path

Local web server, additive fork, v1 acceptance criteria below. Day 1 cuts
a walking skeleton (Q8.a smoke-test MVP) to prove the wiring; days 2–3
fill in the rest of the read-only RPC surface.

## v1 acceptance criteria

1. `npm install -g @JuliusGruber/ai-engineer-coach && coach` boots, opens
   a browser tab, dashboard renders end-to-end.
2. All Claude / Codex / OpenCode / VS Code Copilot / Xcode sessions
   detected via `~/.{claude,codex,opencode,vscode,xcode}` paths are
   visible without configuration.
3. Date filter, harness filter, session list, session detail, and every
   analytics page (`getDailyActivity`, `getCodeProduction`, `getHeatmap`,
   `getConsumption`, `getFlowState`, etc.) render with real data.
4. Rule editor, DSL playground, skill generation: visible but disabled
   with a banner "Available in the VS Code extension".
5. Smoke test: playwright script visits each page route, asserts no
   console errors.
6. Security: `127.0.0.1:7331` bind, token in URL, single-instance reuse.
7. Tested on macOS, Linux, Windows.
8. Published to npm as `@JuliusGruber/ai-engineer-coach` with `bin: coach`.
9. `npx @JuliusGruber/ai-engineer-coach` works from a clean machine.

## v2 roadmap (not blocking v1)

- `coach --project <path>` — re-add project rule layer with trust
  persistence in `~/.ai-engineer-coach/trust.json`. UI gains "Switch
  project" picker.
- `coach --host 0.0.0.0` — LAN exposure for phone / second-machine viewing.
- LLM features behind `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` env vars —
  enables skill generation, learning quiz, code comparison, did-you-know.
- Prebuilt single-file binary (Bun/Deno/pkg compile) for the
  no-Node-installed audience, if anyone asks.
- Upstream PR proposal (`coach serve` opt-in inside microsoft/main).
- Optional Electron shell around the same JS bundle for users who want a
  dock icon (skipped in v1 due to signing tax).
