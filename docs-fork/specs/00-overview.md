# 00 — Standalone UI Spec Set Overview

Shared rules and contracts for the standalone fork. Every other spec
in `docs-fork/specs/` references this file for cross-cutting concerns
(RPC envelope, security model, cache co-existence, additive-only fork
discipline) and does not redefine them.

This spec set implements the design in
[`../STANDALONE-UI-FEASIBILITY.md`](../STANDALONE-UI-FEASIBILITY.md).
The feasibility document is the canonical "why". These specs are the
canonical "what" and "how" for the implementing agent.

## Reading order and dependency graph

Specs depend on each other only through their public APIs. Implement in
topological order:

```
06-state ──┐
           ├─► 02-dispatcher ──► 01-server ──┐
           │                                  ├─► 03-standalone-html ──┐
04-shim ───┘                                  │                         │
                                              └─► 05-cli ───────────────┴─► 07-build ──► 08-testing
```

| Order | Spec                  | Production LOC | Blocks       |
|-------|-----------------------|----------------|--------------|
| 1     | 06-state              | ~50            | 01, 05       |
| 2     | 02-dispatcher         | ~75            | 01           |
| 3     | 04-webview-shim       | ~50            | 03           |
| 4     | 01-server             | ~205           | 03, 05       |
| 5     | 03-standalone-html    | ~120           | 05           |
| 6     | 05-cli                | ~185           | 07           |
| 7     | 07-build              | ~5 (config)    | 08           |
| 8     | 08-testing            | ~30 (config)   | —            |
| **Total** |                   | **~720**       |              |

"Production LOC" excludes per-spec unit/integration/smoke tests, which
add roughly another ~1000 LOC across all eight specs. The feasibility
doc estimated ~370 production LOC; the spec-set total is higher
because it teases out auth, image-route, flag-parser, parse-bootstrap,
and nav-config as separate small modules to keep each file focused.

## RPC contract

Every webview ↔ host message goes over a single WebSocket connection at
`ws://127.0.0.1:<port>/rpc?t=<token>`. Three envelope shapes only:

```ts
// Webview → host
type RpcRequest = {
  type: 'request';
  id: string;          // uuid v4, generated client-side
  method: string;      // must be in V1_ALLOWED
  params?: unknown;
};

// Host → webview (response to a request)
type RpcResponse = {
  type: 'response';
  id: string;          // matches request id
  data?: unknown;      // present iff error absent
  error?: RpcError;    // present iff data absent
};

// Host → webview (unsolicited)
type RpcPush = {
  type: 'progress' | 'dataReady';
  // shape passed through unchanged from existing handlers
  [k: string]: unknown;
};

type RpcError = {
  code: 'standalone-v1-disabled' | 'unknown-method' | 'handler-error' | 'bad-request';
  method?: string;
  message?: string;
};
```

Webview-side caller behavior (no edits to upstream): `panel-rpc.ts`
already treats any object with an `error` field as a failure path. The
existing `shared.ts` message listener forwards `ev.data` to
`window.postMessage` (see [04-webview-shim](04-webview-shim.md)), which
the webview's existing dispatch already handles.

## Authoritative V1_ALLOWED method set

The dispatcher ([02-dispatcher](02-dispatcher.md)) imports `V1_ALLOWED`
from a single source file. Other specs reference but never redeclare it.

```ts
// src/standalone/v1-allowed.ts
export const V1_ALLOWED: ReadonlySet<string> = new Set([
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
```

`getRuleEditor` is deliberately excluded: its handler at
`panel-rpc.ts:740` calls `require('vscode')` inside try/catch. The
try/catch swallows the error, but excluding it avoids noisy logs.

## Security model

| Concern         | Decision                                                                 |
|-----------------|--------------------------------------------------------------------------|
| Bind address    | `127.0.0.1` only. No `--host` flag in v1.                                |
| Auth            | Random 32-byte hex token. Required on every HTTP and WS request.         |
| Token transport | URL query `?t=<token>` for initial GET `/`; thereafter via cookie set on first GET. |
| Token storage   | `~/.ai-engineer-coach/server-state.json` (mode 0600). Reused across boots. Regenerable via `--rotate-token`. |
| CSP             | `default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; font-src 'self'`. Sent as both a `Content-Security-Policy` header and `<meta>` tag. |
| `unsafe-inline` (style) | Required because chart.js + the inline shim script set element styles. Justified by same-origin and token gate. |
| Path traversal  | All file-serving routes (`/dist/webview/`, `/img`) resolve the requested path, then verify it has an allowed-root prefix before serving. |
| Image serving   | GET `/img?path=<urlencoded>` allowlists prefixes: `~/.claude`, `~/.codex`, `~/.opencode`, `~/.vscode`, `~/.xcode`, `~/.copilot-analytics-cache`. Anything else → 403. |

## Cache and state co-existence

Disk layout (one source of truth — re-stated from the feasibility doc
for spec self-containment):

| Path                                       | Owner             |
|--------------------------------------------|-------------------|
| `~/.copilot-analytics-cache/parsed.json`   | shared (core)     |
| `~/.copilot-analytics-cache/meta.json`     | shared (core)     |
| `~/.ai-engineer-coach/rules/`              | shared (core, RO) |
| `~/.ai-engineer-coach/metrics/`            | shared (core, RO) |
| `~/.ai-engineer-coach/state.json`          | standalone        |
| `~/.ai-engineer-coach/server-state.json`   | standalone        |

Rules:

- Standalone uses the same `Analyzer` / cache module as the extension.
  Both processes may run concurrently. No lock files in v1; rely on the
  cache's existing self-healing invalidation path. Add locking in v1.1
  only if real-world corruption is observed.
- Standalone preferences (model budgets, last-used filter) live in
  `state.json`. They do **not** sync with VS Code `context.globalState`.

See [06-state](06-state.md) for full schemas and atomic-write rules.

## Additive-only fork discipline

The implementing agent MUST verify at the end of every spec's work:

```bash
git diff upstream/main -- src/ | grep -E '^[-+]' | grep -vE '^[-+]{3}'
```

The only lines that may appear are additions (`+`) under `src/standalone/`.
Any deletion or modification outside `src/standalone/` violates the
contract. Two files are shared and may be **additively** edited:

- `package.json` — add only: `bin`, three deps (`express`, `ws`, `open`),
  scripts `serve` and `dev:standalone`, `files` array entries for the
  new dist paths. Do not touch existing keys.
- `esbuild.mjs` — add only: new entry for `src/standalone/cli.ts`. Do
  not modify existing entries.

`bin/coach` is a new file (allowed). `docs-fork/` is fork-only.

## V1 acceptance criteria (mirror of feasibility doc)

The implementing agent treats these as the global completion bar.
Per-spec acceptance lists in 01–08 are subsets of this list mapped to
the relevant module.

1. `npm install -g @JuliusGruber/ai-engineer-coach && coach` boots,
   opens a browser tab, dashboard renders end-to-end.
2. Claude / Codex / OpenCode / VS Code Copilot / Xcode sessions
   detected via the standard home-directory paths are visible without
   configuration.
3. Date filter, harness filter, session list, session detail, and every
   visible analytics page render with real data.
4. Hidden pages (rule-editor, rule-playground, antipatterns-editor,
   data-explorer, learning) do not appear in nav. Direct URL hits to
   those pages show a roadmap banner.
5. Playwright smoke test visits every visible page route, asserts zero
   console errors.
6. Security: `127.0.0.1:7331` bind, token gate, single-instance reuse
   via `/health` probe.
7. Tested on macOS, Linux, Windows (CI matrix on Node 20).
8. Published to npm as `@JuliusGruber/ai-engineer-coach` with
   `bin: coach`.
9. `npx @JuliusGruber/ai-engineer-coach` works from a clean machine.
10. Zero outbound network calls except user-initiated UI actions.
    Verified via packet capture during a full session.
11. `git diff upstream/main -- src/` shows only additions under
    `src/standalone/`.
12. MIT LICENSE and NOTICE from upstream preserved in the published
    package.

## Style conventions

- TypeScript strict mode, matching the upstream `tsconfig.json` settings.
- Test framework: **vitest** (matches upstream `package.json:scripts.test`).
- File organization: every new source file under `src/standalone/`
  follows the kebab-case convention used elsewhere in the repo.
- Public exports use named exports only (no default exports).
- No new runtime dependencies beyond `express`, `ws`, and `open`. Pin
  to caret ranges matching the latest stable at time of implementation.
- Comments in code: only where the *why* is non-obvious. Specs already
  carry the rationale.

## Decision log (overview-level)

| Decision                              | Choice                                                    | Why |
|---------------------------------------|-----------------------------------------------------------|-----|
| Test framework                        | vitest                                                    | Matches upstream; no new dev dep |
| WS framing                            | JSON text frames                                          | Trivial debugging; payloads are small (~KB) |
| Token format                          | 32-byte hex (64 chars)                                    | Matches Jupyter convention; URL-safe |
| Cookie name                           | `coach_token`                                             | Avoids collisions; namespaced |
| Default port                          | 7331                                                      | Per feasibility doc; mnemonic ("RE3L") |
| Single-instance reuse origin          | PID-alive check + `/health` payload match                 | Cheap; survives crashes |
| Image-serving path                    | `/img?path=...` with allowlist                            | Avoids base64 bloat in RPC; cheaper than custom IPC |
| Disabled-method response              | `{ error: { code: 'standalone-v1-disabled', method } }`   | Caller-friendly; banner-rendering code can switch on `code` |
