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
06-state ───────────┐
02-dispatcher ──────┤
04-webview-shim ────┼─► 01-server ──► 05-cli ──► 07-build ──► 08-testing
03-standalone-html ─┘                  ▲
                                       └── 06-state (also consumed by the CLI on boot)
```

(06-state → 01-server + 05-cli. 02-dispatcher, 04-webview-shim, and
03-standalone-html → 01-server. 02-dispatcher no longer depends on 06-state —
the model-budget handlers that used it are deferred to v2.)

| Order | Spec                  | Production LOC | Blocks       |
|-------|-----------------------|----------------|--------------|
| 1     | 06-state              | ~35            | 01, 05       |
| 2     | 02-dispatcher         | ~70            | 01           |
| 3     | 04-webview-shim       | ~50            | 01           |
| 4     | 03-standalone-html    | ~70            | 01           |
| 5     | 01-server             | ~205           | 05           |
| 6     | 05-cli                | ~185           | 07           |
| 7     | 07-build              | ~5 (config)    | 08           |
| 8     | 08-testing            | ~30 (config)   | —            |
| **Total** |                   | **~650**       |              |

"Production LOC" excludes per-spec unit/integration/smoke tests, which
add roughly another ~950 LOC across all eight specs. The feasibility
doc estimated ~370 production LOC; the spec-set total is higher
because it teases out auth, image-route, flag-parser, and parse-bootstrap
as separate small modules to keep each file focused. (03-standalone-html
shrank — it now reuses upstream `getDashboardHtml` instead of duplicating a
nav; there is no `nav-config.ts`.)

## RPC contract

Every webview ↔ host message goes over a single WebSocket connection at
`ws://127.0.0.1:<port>/rpc?t=<token>`. Three envelope shapes only:

```ts
// Webview → host
type RpcRequest = {
  type: 'request';
  id: string;          // uuid v4, generated client-side
  method: string;      // must be in V1_ALLOWED or STANDALONE_NATIVE
  params?: unknown;
};

// Host → webview (response to a request)
type RpcResponse = {
  type: 'response';
  id: string;          // matches request id
  data: unknown;       // success payload, OR an error object (RpcErrorData)
};

// Host → webview (unsolicited)
type RpcPush = {
  type: 'progress' | 'dataReady';
  // shape passed through unchanged from the parse worker / orchestrator
  [k: string]: unknown;
};

// Errors ride INSIDE `data` — they are NOT a sibling field. The
// unmodified webview reads failures from `data.error` (see below); under
// the additive-only rule we cannot change that, so the server must match
// it. `code` is carried alongside so the shim can classify the failure.
type RpcErrorData = {
  error: string;       // human-readable; becomes the rejected Error message
  code: 'standalone-v1-disabled' | 'unknown-method' | 'handler-error' | 'bad-request';
  method?: string;     // echoed so the shim can match against BANNER_WORTHY
};
```

**Error-shape contract (load-bearing).** The unmodified webview
consumes responses in `shared.ts:59-66`: it `resolve`s `msg.data`
**unless** `msg.data.error` is truthy, in which case it
`reject`s with `new Error(String(msg.data.error))`. There is **no**
sibling-`error` code path. Therefore the server emits *every* error as
`{ type: 'response', id, data: { error, code, method } }` — never as a
top-level `error` field. A sibling `error` would leave `msg.data`
`undefined`, hit the `else` branch, and `resolve(undefined)` — silently
swallowing the failure. This is the production form of `errorResult(...)`
(`panel-shared.ts:16`), which already returns `{ error, ...extra }`.

The shim (see [04-webview-shim](04-webview-shim.md)) forwards each raw WS
frame to `window.postMessage`, where the listener above handles it; the
shim itself inspects `data.code` to decide whether to show the roadmap
banner.

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

## Standalone-native methods (not in the registry)

`V1_ALLOWED` gates only the upstream `getRpcHandler` registry. Upstream, the
dropped host special-cased three non-registry methods (`panel.ts:269,279`).
In v1 the fork reimplements **one** as a native handler checked *before* the
allowlist gate (see [02-dispatcher](02-dispatcher.md#three-tier-dispatch)):

| Method         | Caller (visible page) | Native behavior                                                        |
|----------------|-----------------------|------------------------------------------------------------------------|
| `openExternal` | `page-peers.ts:336`   | `open` package, **after** `new URL()` validates `http:`/`https:` only. |

The model-budget pair (`loadModelBudgets`/`saveModelBudgets`,
`panel.ts:279`) is **deferred to v2**: its only caller is `page-burndown.ts`,
which is unreachable while `FF_TOKEN_REPORTING_ENABLED` is `false` (see the
flag note below). Every other non-registry method the webview can emit (the
16 `PanelRequestService` LLM/SDLC methods, plus the rule-authoring methods)
is left to the disabled path.

## Feature flag: token reporting (`FF_TOKEN_REPORTING_ENABLED`)

`src/core/constants.ts:127` sets `FF_TOKEN_REPORTING_ENABLED = false`
upstream. The fork **must not** flip it (additive-only; `constants.ts` is
upstream). Consequences the implementing agent must respect:

- The `burndown` nav entry is gated server-side (`panel-html.ts:34`) and any
  navigation to it is redirected to `dashboard` (`app.ts:27`); it never
  renders in v1.
- The five token methods in `V1_ALLOWED` (`getConsumption`, `getBurndown`,
  `getAiCredits`, `getAiCreditBurndown`, `getTokenCoverage`) return an
  `errorResult` behind the flag. They stay in the allowlist (harmless,
  read-only no-ops) but back no visible page in v1.
- Model-budget persistence (the two native budget handlers above and the
  `UserState` half of [06-state](06-state.md)) is deferred to v2 because its
  only caller is the unreachable burndown page.

Re-enable all of the above in v2 when the flag flips.

## Disabled-method UX: banner vs. silent

A disabled method is one in neither `V1_ALLOWED` nor `STANDALONE_NATIVE`.
The webview fires some of these *proactively* on visible pages — the
dashboard alone calls `triageSkills` / `discoverCatalog` / `triageCatalog`
on load (`page-dashboard.ts:395-407`). So "show a banner on any disabled
response" would pop the roadmap banner on the home screen every visit.
Disabled methods therefore split in two (the shim owns the set):

- **Banner-worthy** — genuinely user-initiated content creation
  (`createSkill`, `generateSkillContent`, `generateLearningQuiz`,
  `generateLearningResources`, `generateCodeComparison`,
  `generateDidYouKnow`, `installSkill`, `installCatalogItem`,
  `triageCatalog`, plus deep-linked hidden-page methods like
  `getRuleEditor`). → disabled envelope **+ roadmap banner**.
- **Silent-disabled** — proactively fired by visible pages, each already
  guarded by `.catch(() => null)` (`triageSkills`, `discoverCatalog`,
  `reviewContextFiles`, `getSdlcToolAnalysis`, `getSdlcRepoScan`,
  `getSdlcGitHubData`, `getWorkspaceDeps`). → disabled envelope, **no
  banner**; the page degrades its section quietly.

All disabled responses use the same `{ data: { error, code:
'standalone-v1-disabled', method } }` shape; the split lives only in the
shim's banner decision (keyed on `method ∈ BANNER_WORTHY`).

## Security model

| Concern         | Decision                                                                 |
|-----------------|--------------------------------------------------------------------------|
| Bind address    | `127.0.0.1` only. No `--host` flag in v1.                                |
| Auth            | Random 32-byte hex token. Required on every HTTP and WS request.         |
| Token transport | URL query `?t=<token>` for initial GET `/`; thereafter via cookie set on first GET. The WS token is handed to the shim via a `<meta name="coach-token">` tag in the served HTML (the cookie is `HttpOnly`, so JS cannot read it for the `ws://…?t=` URL). |
| Token storage   | `~/.ai-engineer-coach/server-state.json` (mode 0600). Reused across boots. Regenerable via `--rotate-token`. |
| CSP             | `default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; font-src 'self'`. Sent as both a `Content-Security-Policy` header and `<meta>` tag. |
| No inline scripts | `script-src 'self'` (no nonce, no `'unsafe-inline'`). The shim is therefore served as an **external** `/standalone-shim.js`, not an inline `<script>` — an inline polyfill would be blocked by this policy and `acquireVsCodeApi` would never be defined. See [03-standalone-html](03-standalone-html.md) / [04-webview-shim](04-webview-shim.md). |
| `unsafe-inline` (style) | Required because chart.js sets element styles inline and the shim's roadmap banner uses an inline `style` attribute. Justified by same-origin and token gate. Does **not** extend to `script-src`. |
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
| `~/.ai-engineer-coach/server-state.json`   | standalone        |

(No `state.json` in v1 — the `UserState`/model-budget file is deferred to
v2 with the burndown page; see the feature-flag note above.)

Rules:

- Standalone uses the same `Analyzer` / cache module as the extension.
  Both processes may run concurrently. No lock files in v1; rely on the
  cache's existing self-healing invalidation path. Add locking in v1.1
  only if real-world corruption is observed.
- The only standalone-owned file in v1 is `server-state.json` (single-
  instance handshake). Client-side preferences (e.g. last filter) live in
  the browser's `localStorage` via the shim's `getState`/`setState`
  ([04-webview-shim](04-webview-shim.md)), not on the server.

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
- `esbuild.mjs` — add only: new entries for `src/standalone/cli.ts` and
  the external shim, plus a `vscode` → `src/standalone/vscode-stub.ts`
  **alias scoped to the standalone entry only** (the extension build must
  keep the real external `vscode`). Do not modify existing entries.
- the test config (vitest) — add only: a matching `resolve.alias`
  mapping `vscode` to the stub, so tests that import the real
  `panel-rpc` library do not fail to resolve `vscode`.

`bin/coach` and `src/standalone/vscode-stub.ts` are new files (allowed).
`docs-fork/` is fork-only.

**Why the `vscode` alias is required (not optional).** One reused upstream
module pulls a **top-level** `import * as vscode` that runs the moment the
standalone loads it: `panel-shared.ts:7` (via `getRpcHandler` →
`errorResult`, used only in `postResponse`/`postError`, which the standalone
never calls). `core/rule-compiler.ts` (reached via `panel-rpc.ts:37`) uses a
**lazy `require('vscode')`** inside a function (`rule-compiler.ts:77`), so it
does *not* pull `vscode` at module load — but the single global alias covers
that path too if it ever runs. In addition, the HTML wrapper reuses
`getDashboardHtml`, which **actively calls** `vscode.Uri.joinPath`
(`panel-html.ts:11`). A production esbuild bundle *might* tree-shake unused
namespaces; vitest (which transforms, not bundles) will not. One **global**
stub alias resolves the import deterministically and supplies the
`Uri.joinPath` the HTML path needs. See
[02-dispatcher](02-dispatcher.md#transitive-vscode-import) and
[03-standalone-html](03-standalone-html.md).

**When these come into existence.** The `vscode-stub.ts` file, the vitest
`resolve.alias`, and the `open` dependency are a shared foundation, not a
07/08 deliverable: they are bootstrapped at first use by
[02-dispatcher](02-dispatcher.md) — the earliest spec whose unit tests load the
real `panel-rpc` — and are also required by
[03-standalone-html](03-standalone-html.md). [07-build](07-build.md) and
[08-testing](08-testing.md) *formalize* the build-side (esbuild) alias and the
CI matrix; they do not introduce the stub/alias/dep. Treat their creation as
idempotent (check-and-skip if already present).

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
4. The nav shows the upstream entries unchanged (10 entries; `burndown` is
   gated off by `FF_TOKEN_REPORTING_ENABLED`). Deep-link-only routes
   (rule-editor, rule-playground, data-explorer) are reachable by hash URL
   and render their working/degraded views. The roadmap banner appears on
   user-initiated content-creation methods (e.g. `createSkill` on the skills
   page), not on page loads.
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
| RPC error shape                       | Nested in `data`: `{ data: { error, code, method } }`     | The unmodified webview reads `data.error` (`shared.ts:62`); a sibling `error` would silently `resolve(undefined)` |
| Disabled-method response              | `{ data: { error, code: 'standalone-v1-disabled', method } }` | Webview rejects → page error boundary; shim reads `data.code` for the banner |
| Shim delivery                         | External `/standalone-shim.js` + `<meta name="coach-token">` | `script-src 'self'` forbids an inline polyfill; cookie is `HttpOnly` so JS reads the WS token from the meta tag |
| Parse lifecycle                       | Serve-then-parse; `dataReady` mandatory (not deferrable)  | The webview gates *all* rendering on `dataReady` (`app.ts:444`); `progress` forwarding is the only deferrable piece |
| `vscode` import safety                | Alias `vscode` → `vscode-stub.ts` (standalone build + tests) | `panel-rpc` transitively pulls a top-level `import * as vscode` via `panel-shared.ts:7` |
| Non-registry methods                  | Front-of-line `STANDALONE_NATIVE` table before the allowlist (`openExternal` only in v1) | `openExternal` (`page-peers.ts:336`) isn't in `getRpcHandler`; the model-budget pair is deferred to v2 with the flag-gated burndown page |
| Disabled-method banner                | Curated `BANNER_WORTHY` set in the shim; rest silent       | The dashboard fires disabled methods on load; a global banner would pop on the home screen |
