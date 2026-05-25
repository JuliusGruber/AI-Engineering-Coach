# Standalone UI Feasibility Report

Assessment of porting the AI Engineer Coach dashboard out of VS Code into a
standalone application (local web server, Electron, or Tauri).

**Verdict: high feasibility.** The codebase separates analysis logic from VS
Code host glue more cleanly than the README suggests.

## Architecture findings

- `src/core/` — parsers (Claude, Codex, OpenCode, VS Code Copilot, Xcode),
  analyzers, rule engine, DSL, cache. **Zero `vscode` imports.** Pure Node +
  TypeScript. Ports unchanged.
- `src/webview/` — Preact app (`app.ts` entry, ~30 `page-*.ts` files,
  chart.js for charts, htm for templates). Renders as HTML/CSS/JS, runs in
  any browser.
- Only 7 files import from `vscode`: `src/extension.ts` plus six in
  `src/webview/` (the host-side panel/sidebar shell, not the Preact UI).
- Log discovery uses `process.env.HOME || process.env.USERPROFILE` and
  `os.homedir()`. No dependency on workspace context.

## Host-side glue to replace

| VS Code API | Purpose | Replacement |
|---|---|---|
| `createWebviewPanel` + `postMessage` | Hosts the Preact UI | HTTP server + WebSocket, or Electron `BrowserWindow` + IPC |
| `registerCommand` (3 commands) | open/reload/reviewLocalRules | HTTP routes or app menu items |
| `context.globalState` | Persists trust approvals + model budgets | JSON file in `~/.ai-engineer-coach/` |
| `showWarningMessage` + `showQuickPick` | "Approve local rule files" dialog | Web modal, or native dialog |
| `workspaceFolders[0].uri.fsPath` | Source for project-scoped rules | `--project` flag or folder picker; or drop project rules |
| `env.openExternal` | Open URL from webview | `open` npm package, or `shell.openExternal` |
| `createOutputChannel` | Logging | Console / file |
| `registerWebviewViewProvider` | Activity-bar sidebar | Drop, or a second window |

## RPC contract

Webview ↔ host uses:

- `{ type: 'request', id, method, params }` → `{ type: 'response', id, data }`
- Server-pushed `{ type: 'progress', ... }` and `{ type: 'dataReady', ... }` events

Method namespace is typed in `src/core/types/rpc-types.ts` →
`ExtensionMethodMap` (~40 methods: `getDashboardData`, `getSessionDetail`,
`saveModelBudgets`, etc.). Maps cleanly to either HTTP-POST-per-method or a
single WebSocket multiplexer.

## Target options

- **Local web server + browser tab** — 1–2 days for a working prototype.
  Express + static `dist/`, single `/rpc` endpoint, WebSocket for progress
  events. Lowest effort, no native build pipeline.
- **Electron** — 3–4 days. Same JS bundle in a `BrowserWindow`. Gain native
  menus, file pickers (for workspace-folder picker), URL handlers,
  auto-update. Heavier shipping artifact.
- **Tauri** — 4–6 days. Smallest binary, but requires keeping the host
  logic in a Node sidecar or porting it to Rust. A Rust port is larger work
  than the whole standalone-UI project.

## Remaining risks (none are showstoppers)

1. Preact bundle may use VS Code-specific CSS variables
   (`--vscode-foreground` etc.) — fixable but worth a grep before commitment.
2. `panel-html.ts` likely uses a CSP nonce scheme for the webview — needs
   adapting for the new host.
3. `parse-worker.ts` and `cache-write-worker.ts` are Node `Worker` threads
   — should port cleanly, but worth confirming they don't touch
   `vscode.workspace.fs`.

## Recommended path

Local web server first. The dev loop is fastest (no native rebuild), it
proves the RPC and asset wiring, and an Electron shell can be added later
around the same JS bundle once the web version works end-to-end.
