# Standalone Parity — Bucket A Quick Wins (design)

**Date:** 2026-05-27
**Status:** Approved (brainstorming) — ready for implementation planning
**Source:** `docs-fork/STANDALONE-PARITY-GAPS.md` § "A. Quick wins"

## Problem

`docs-fork/STANDALONE-PARITY-GAPS.md` lists four "quick win" parity gaps —
features present in the upstream extension but not exposed by this fork's
standalone build:

1. **Data Explorer** — ad-hoc field distributions & filters.
2. **Burndown page** — monthly token-budget progress + projections.
3. **Output token breakdown** — per-model / language token volume.
4. **Rule Playground (eval)** — DSL REPL.

The doc tags all four "Easy — allowlist/flag flips, no new infra." Tracing the
code shows that framing is only half right, and the gap between framing and
reality is the reason this spec exists.

### What the code actually shows

- **Data Explorer** and **Rule Playground** are pure-core RPC handlers
  (`panel-rpc.ts` — no `require('vscode')`), blocked only by the frozen v1
  allowlist (`src/standalone/v1-allowed.ts`). Exposing them is a genuinely
  additive, no-infra change. ✓
- **Burndown** and **Output token breakdown** are *not* allowlist gaps — their
  RPC methods (`getBurndown`, `getAiCreditBurndown`, `getTokenCoverage`,
  `getConsumption`, `getAiCredits`) are already on the allowlist. They are gated
  by the build-time constant `FF_TOKEN_REPORTING_ENABLED = false`
  (`src/core/constants.ts:127`), which is imported by *shared* core + webview
  files (`panel-rpc.ts`, `panel-html.ts`, `app.ts`, `page-output.ts`,
  `page-dashboard.ts`, `page-burndown.ts`). `esbuild.mjs` builds **one**
  `dist/webview/app.js`, shared by both the VS Code extension and the standalone
  server. So "flip the flag" cannot be standalone-scoped by editing the constant
  — that would also re-enable the feature in the published extension and surface
  token numbers upstream deliberately held back as unverified vs GitHub billing.

### Fork invariant (the constraint that shapes everything)

The fork is **additive-only**: `git diff upstream/main -- src/` touches only
`src/standalone/`; all upstream `src/` is byte-identical. Exposure happens
through (a) the frozen 40-method allowlist (`v1-allowed.ts`) and (b) the
CSP/token/script-tag swap in `standalone-html.ts`. The standalone fork bundles in
`esbuild.mjs` are an established **additive** section (lines 116+), so build-config
changes scoped to standalone bundles are consistent with existing precedent and do
not breach the `src/` invariant.

## Goal

Expose all four bucket-A features in the standalone build **without** editing any
upstream `src/` file outside `src/standalone/`, and without re-enabling token
reporting in the published extension.

## Decisions (from brainstorming)

| Decision | Choice | Rationale |
| --- | --- | --- |
| Flag-gated items (Burndown, Output token) | **Standalone-only override** | Preserves additive-only; keeps the extension untouched. Accepts a contained amount of new standalone build infra. |
| Data Explorer + Rule Playground nav | **Inject nav links via `standalone-html.ts`** | Discoverable; matches the file's existing single-match anti-drift transform philosophy. |
| Token data-quality caveat | **Document in standalone README/docs** | Surfaces numbers plainly in-app (no webview UI injection / drift); records the "may not match GitHub billing" caveat where it belongs. |
| `calibrateRule` / `runRuleTests` | **Defer** (do not allowlist) | Called by no standalone-exposed page (Rule Editor only, bucket B). Allowlisting now is inert and grows the frozen set for no user-visible gain (YAGNI). |

## Scope

Four doc items map to three work streams:

1. **Data Explorer** — allowlist `getDataExplorer`; inject nav link.
2. **Rule Playground (eval)** — allowlist `evaluateExpression`; inject nav link.
3. **Token reporting (Burndown + Output token tab)** — standalone-only
   `FF_TOKEN_REPORTING_ENABLED` override. No allowlist change.

### Out of scope (documented degradations, not regressions)

These are pre-existing gaps in other buckets that happen to share a page with a
bucket-A feature. They must **degrade gracefully** (surface an error, never
crash); they are not fixed here.

- **Rule Playground**: `compileNlRule` (NL→rule, bucket D — LLM) and `saveRule`
  (bucket B — write path) remain disabled. The page's eval REPL is the win.
- **Burndown**: model-budget `saveModelBudgets` / `loadModelBudgets` are not in
  the shared RPC handler map at all (dropped panel service, bucket E). The
  burndown chart + AI-credit projections are the win.

## Components

### A. Allowlist additions

`src/standalone/v1-allowed.ts`: add `getDataExplorer` and `evaluateExpression` to
the frozen set (40 → 42). Both handlers are pure-core and reachable by an exposed
page:

- `page-data-explorer.ts` calls `getDataExplorerFields` (already allowlisted) +
  `getDataExplorer`.
- `page-rule-playground.ts` calls `getFieldSchema` / `getFunctionCatalog` /
  `getMetricList` (already allowlisted) + `evaluateExpression`.

### B. Standalone-only flag override

The only nontrivial piece. Five small parts:

1. **New module** `src/standalone/standalone-constants.ts`:
   ```ts
   export * from '../core/constants';
   export const FF_TOKEN_REPORTING_ENABLED = true;
   ```
   In ESM, an explicit local export shadows the `export *` re-export for that one
   name; esbuild honors this.

2. **esbuild redirect plugin** in `esbuild.mjs`, applied **only** to the
   standalone CLI build and the new standalone webview build (below): an
   `onResolve` hook that redirects imports resolving to `core/constants` →
   `standalone-constants.ts`. **Recursion guard**: when the importer is
   `standalone-constants.ts` itself (its `export *`), resolve to the real module.

3. **New esbuild entry**: bundle `src/webview/app.ts` →
   `dist/standalone/webview/app.js` (platform `browser`, format `iife`,
   target `es2022`) with the redirect plugin attached. The shared
   `dist/webview/app.js` keeps `FF_TOKEN_REPORTING_ENABLED = false` for the
   extension. Add the same entry to the `--watch` block for `dev:standalone`
   parity (nice-to-have, not load-bearing for acceptance).

4. **Server route** `src/standalone/server.ts`:
   `app.use('/dist/standalone/webview', auth, express.static(<dist/standalone/webview>))`,
   resolved via a new `resolveStandaloneWebviewRoot()` helper mirroring
   `resolveWebviewRoot()`. (`styles.css` is flag-independent and continues to load
   from `/dist/webview/styles.css`.)

5. **Script-path swap** `src/standalone/standalone-html.ts`: transform 2 points
   the `app.js` `<script>` at `/dist/standalone/webview/app.js` instead of
   `/dist/webview/app.js`. The shim ordering (shim before app.js) is preserved.

**Effect.** The standalone CLI bundle (server side) now compiles `panel-rpc`
handlers to return real token data instead of `errorResult('Token reporting is
temporarily disabled')`, and `panel-html` emits the burndown nav `<li>`. The
standalone `app.js` (client side) keeps the burndown route (no
`burndown → dashboard` redirect), keeps the burndown nav link, renders the Output
"Token Usage" tab, and drops the dashboard "temporarily hidden" banner. All
coherent, standalone-only. The published extension is byte-identical.

### C. Nav injection

`src/standalone/standalone-html.ts`: insert two nav `<li>` entries —
`data-page="data-explorer"` and `data-page="rule-playground"` (page IDs confirmed
in the router, `app.ts:649-650`) — using a strict single-match insert anchored on
a stable nav landmark, mirroring the existing `replaceOnce` "exactly one match or
throw" anti-drift guard. Burndown's nav link is **not** injected here — it returns
automatically from `panel-html` once the override flips the flag server-side.

### D. Docs

- `docs-fork/STANDALONE-PARITY-GAPS.md`: move the four bucket-A items to a shipped
  state; correct the "no new infra" framing for the token items (they required the
  standalone-only override).
- Standalone README: add the token data-quality caveat ("reported token numbers
  may not align with GitHub billing").
- `docs-fork/specs/07-build.md`: document the standalone webview bundle + the
  constants-redirect plugin.

## Data flow

Unchanged for allowlist items:

```
webview → WebSocket /rpc → dispatcher.dispatch()
  → V1_ALLOWED gate (now includes getDataExplorer, evaluateExpression)
  → getRpcHandler(method) → pure-core handler → { ok, data }
```

Token items use the identical path; the bundle-time override is what flips the
`panel-rpc` handlers from `errorResult(...)` to real data, and what makes the
standalone `app.js` render the token UI.

## Testing

- **Unit — allowlist**: `v1-allowed.test.ts` asserts size 42 and membership of
  the two new methods.
- **Unit — standalone HTML**: extend the standalone **vitest alias** (the
  established mechanism) to map `core/constants` → `standalone-constants` for the
  standalone-scoped config only (must not affect core/webview test suites). Then:
  - **flip** the existing "omits the burndown nav while `FF_TOKEN_REPORTING_ENABLED`
    is false" test to assert the burndown nav `<li>` **is** emitted;
  - add assertions that the injected Data Explorer + Rule Playground `<li>`s are
    present (and exactly once each — the single-match guard fires otherwise).
- **Integration** (`tests/standalone/integration`): dispatching `getDataExplorer`
  and `evaluateExpression` returns `{ ok: true }`, not
  `{ code: 'standalone-v1-disabled' }`.
- **Playwright smoke** (built bundle — exercises the real override):
  - burndown nav link present and navigable;
  - Output page shows the "Token Usage" tab;
  - Data Explorer + Rule Playground nav links present and their pages render;
  - the Rule Playground eval REPL returns a result for a sample expression.
- **Pack**: `dist/standalone/webview/app.js` is emitted by `npm run build` and
  included by `files: ["dist/standalone/"]` (`npm pack --dry-run`).
- **Graceful degradation**: on the Rule Playground page, submitting NL→rule or
  save surfaces an error without crashing the page; on Burndown, absent
  model-budget persistence does not crash the page.

## Invariant verification

After implementation, `git diff upstream/main -- src/` must still touch only
`src/standalone/`. Changes live in: `src/standalone/v1-allowed.ts`,
`src/standalone/standalone-constants.ts` (new), `src/standalone/standalone-html.ts`,
`src/standalone/server.ts`, plus fork-owned build config (`esbuild.mjs` additive
section) and docs/tests. No upstream `src/` file outside `src/standalone/` is
modified.

## Suggested sequencing (for the implementation plan)

Two separable units:

1. **Stream 1 — allowlist + nav** (Data Explorer + Rule Playground eval). Low
   risk, independently shippable: two allowlist entries, one nav-injection
   transform, unit + integration + smoke coverage.
2. **Stream 2 — token override** (Burndown + Output token tab). The larger piece:
   wrapper module, esbuild plugin + standalone webview entry, server route,
   script-path swap, vitest-alias extension, assertion flips, README caveat.

Each stream verifies the additive-only invariant before completion.
