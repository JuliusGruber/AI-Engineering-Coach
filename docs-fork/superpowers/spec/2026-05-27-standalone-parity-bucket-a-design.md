# Standalone Parity — Bucket A Quick Wins (design)

**Date:** 2026-05-27
**Status:** Approved (brainstorming + grilling) — ready for implementation planning
**Source:** `docs-fork/STANDALONE-PARITY-GAPS.md` § "A. Quick wins"

> **Grilling pass (2026-05-27).** Five decisions were refined against the code; see
> the inline **[G1]–[G5]** markers. Summary: (G1) nav injection reframed as
> *standalone command-entrypoint parity*, not "matches upstream"; (G2) the override
> plugin is kept, with rejected alternatives recorded and the Playwright smoke named
> as the load-bearing safety net; (G3) the plugin gains a defined implementation +
> a match-counter anti-drift guard; (G4) the unit-test mechanism switches from a
> config-wide vitest alias (which cannot be standalone-scoped — see below) to a
> file-local `vi.mock`; (G5) nav items land in a new "Explore" group anchored on the
> `level-up` boundary.

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
| Data Explorer + Rule Playground nav **[G1]** | **Inject nav links via `standalone-html.ts`** | *Standalone command-entrypoint parity* — NOT "matches upstream." Upstream renders **no** nav `<li>` for these (`panel-html.ts:27-41`); they are deep-link-only routes reached in the extension via VS Code commands / deep-links. Standalone has no command palette or equivalent surface, so a nav-less route is effectively unreachable by a normal user. Injecting nav links is therefore the standalone equivalent of the extension's command entrypoints — parity-restoring, not enhancement. Uses the file's single-match anti-drift transform. |
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
the frozen set (40 → 42). "Frozen" here means *additions require a deliberate,
documented criterion* — not "never changes." The criterion is **reachable by an
exposed page**; both additions meet it (below), while `calibrateRule` /
`runRuleTests` are deferred precisely because they do not (see Decisions, YAGNI).
Both handlers are pure-core and reachable by an exposed page:

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
   `standalone-constants.ts`. **[G3]** Implementation contract:
   - **Match on the resolved absolute path, not the specifier.** Use a cheap
     filter regex (e.g. `/constants$/`) as a prefilter, then compute
     `path.resolve(args.resolveDir, args.path)` and redirect **only** on an exact
     match against the absolute `src/core/constants.ts`. Matching the specifier
     would catch `other-constants` and miss alternate relative spellings; matching
     the resolved path catches every spelling uniformly (the reason `alias` can't
     do this job — see "Alternatives rejected" below).
   - **Compute the path manually with `path.resolve` — do NOT use `build.resolve()`.**
     `build.resolve()` re-enters `onResolve` and introduces a *second* recursion
     class; manual resolution avoids it entirely.
   - **Recursion guard (first class):** when `args.importer` is
     `standalone-constants.ts` itself (its `export *`), return `undefined` so
     esbuild's default resolution reaches the real module.
   - **Windows:** normalize both sides with `path.resolve` (OS-native) before the
     `===` importer/target comparisons. Never compare against a hardcoded
     `/`-joined string — on win32 the guard would silently fail.
   - **Anti-drift guard (match counter):** count redirects and `throw` in
     `build.onEnd` if the count is **zero**. This mirrors the `replaceOnce`
     "exactly one or throw" philosophy: if upstream renames/moves `constants.ts`
     or changes the import spelling, the build fails loudly instead of silently
     emitting an `FF=false` bundle that re-disables burndown (caught otherwise only
     by the smoke test, or not at all).

3. **New esbuild entry**: bundle `src/webview/app.ts` →
   `dist/standalone/webview/app.js` (platform `browser`, format `iife`,
   target `es2022`, **`sourcemap: false`** to match the sibling `dist/standalone/`
   bundles — cli/shim/workers all use `sourcemap: false`) with the redirect plugin
   attached. This is a **second full webview bundle**; it exists because the client
   reads `FF_TOKEN_REPORTING_ENABLED` as a build-time const in upstream files
   (`app.ts:27` redirect, `app.ts:32-35` nav strip, `page-output`/`page-dashboard`/
   `page-burndown`), so the flag cannot be flipped at runtime without editing
   `src/webview` — which would breach the additive-only invariant. The shared
   `dist/webview/app.js` keeps `FF_TOKEN_REPORTING_ENABLED = false` for the
   extension. (Tarball note: `files` ships both `dist/webview/` and
   `dist/standalone/`, so the published package carries both `app.js` copies; the
   `FF=false` one is unused by standalone but harmless.) Add the same entry to the
   `--watch` block for `dev:standalone` parity (nice-to-have, not load-bearing for
   acceptance).

4. **Server route** `src/standalone/server.ts`:
   `app.use('/dist/standalone/webview', auth, express.static(<dist/standalone/webview>))`,
   resolved via a new `resolveStandaloneWebviewRoot()` helper mirroring
   `resolveWebviewRoot()`. (`styles.css` is flag-independent and continues to load
   from `/dist/webview/styles.css`.)

5. **Script-path swap** `src/standalone/standalone-html.ts`: transform 2 points
   the `app.js` `<script>` at `/dist/standalone/webview/app.js` instead of
   `/dist/webview/app.js`. The shim ordering (shim before app.js) is preserved.
   **Test fallout (must be updated, not just added — see Testing):**
   `standalone-html.test.ts:79` and `:89-92` hardcode `/dist/webview/app.js`, and
   the snapshot (`standalone-html.snapshot.test.ts.snap:54`) too; all three flip to
   `/dist/standalone/webview/app.js`.

**Alternatives rejected (override mechanism) [G2].** Recorded so a reviewer does
not re-derive or "simplify" the plugin into a latent bug:
- **esbuild `define`** (`define: { FF_TOKEN_REPORTING_ENABLED: 'true' }`) — fails:
  every consumer imports it as a *bound* name, and `define` only substitutes
  *unbound* identifiers. The import binding shadows the define.
- **esbuild `alias`** (the mechanism used for `vscode` at `esbuild.mjs:150`) —
  fails: `alias` keys on the import *specifier as written*. Once the whole CLI is
  bundled, core reaches `constants.ts` via many relative spellings; a single alias
  string can't catch them all, risking two module copies with divergent flag
  values. The `onResolve` plugin keys on the resolved absolute path, so it catches
  every spelling — which is exactly why a plugin (not `alias`) is required.
- **tsconfig path remap** — doesn't reach esbuild's resolver; same specifier problem.

**Load-bearing safety net.** A too-narrow match could give the *server* bundle
`FF=true` while a transitively-bundled copy stays `FF=false` (or vice versa for the
webview). The unit/integration tests would not catch a burndown mismatch — only the
**Playwright smoke asserting burndown data actually renders end-to-end** exercises
both bundles' copies agreeing. The smoke test, not the unit/integration tests, is
the real guard here.

**Effect.** The standalone CLI bundle (server side) now compiles `panel-rpc`
handlers to return real token data instead of `errorResult('Token reporting is
temporarily disabled')`, and `panel-html` emits the burndown nav `<li>`. The
standalone `app.js` (client side) keeps the burndown route (no
`burndown → dashboard` redirect), keeps the burndown nav link, renders the Output
"Token Usage" tab, and drops the dashboard "temporarily hidden" banner. All
coherent, standalone-only. The published extension is byte-identical.

### C. Nav injection

`src/standalone/standalone-html.ts`: inject a **single block** **[G5]** — one new
group header plus both links — via **one** `replaceOnce`, mirroring the existing
"exactly one match or throw" anti-drift guard:

```html
<li class="nav-group-header">Explore</li>
<li><a href="#" data-page="data-explorer">… Data Explorer</a></li>
<li><a href="#" data-page="rule-playground">… Rule Playground</a></li>
```

(Page IDs `data-explorer` / `rule-playground` confirmed in the router,
`app.ts:649-650`.)

- **Placement — new "Explore" group, not the existing groups.** The nav is grouped
  *Observe / Measure / Improve* (`panel-html.ts:28,32,36`). Bare `<li>`s before
  `</ul>` would render under *Improve* (after "Level Up"), which is semantically
  wrong for Data Explorer. Injecting both into their "native" groups would mean
  **two** anchors / two drift points. One new group = one insertion = one drift
  point, and it honestly marks these as the standalone-only command-entrypoints
  reframed in G1.
- **Anchor — the `level-up` `<li>` closing boundary, not bare `</ul>`.** `</ul>` is
  currently unique (one `<ul class="nav-links">`, `panel-html.ts:27/41`), but a
  future unrelated `<ul>` would make `replaceOnce` throw on a benign change.
  Anchoring on the last nav item (`data-page="level-up"`'s closing boundary) keeps
  the drift-guard sensitive to *nav* changes specifically. Accepted cost: if
  upstream reorders the nav so `level-up` is no longer last, the guard throws —
  consistent with the fork's "fail loud on drift" philosophy.

Burndown's nav link is **not** injected here — it returns automatically from
`panel-html` once the override flips the flag server-side.

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
- **Unit — standalone HTML [G4]**: **do not use a config-wide vitest alias.** There
  is no standalone-scoped unit config — `vitest.config.mts` (`include: ['src/**/*.test.ts']`)
  runs core, webview, and standalone unit tests in one project, and its `vscode`
  alias is repo-wide. Adding `core/constants → standalone-constants` there would
  flip `FF=true` for *every* unit test in the repo — the opposite of "standalone
  only." Instead force `FF=true` **file-locally** with `vi.mock('../../core/constants', …)`
  + `vi.hoisted` (the established standalone pattern — cf. `rule-loader.test.ts`,
  and the `vi.mock`-over-`vi.spyOn` note for ESM). Apply it in **both**
  `standalone-html.test.ts` and its snapshot sibling, so both reflect the shipped
  `FF=true` reality. Then:
  - **flip** the existing "omits the burndown nav while `FF_TOKEN_REPORTING_ENABLED`
    is false" test to assert the burndown nav `<li>` **is** emitted;
  - **update** the transform-2 script-path assertions (`standalone-html.test.ts:79`,
    `:89-92`) from `/dist/webview/app.js` → `/dist/standalone/webview/app.js`;
  - add assertions that the injected "Explore" group header + Data Explorer +
    Rule Playground `<li>`s are present (and exactly once each — the single-match
    guard fires otherwise);
  - **regenerate the snapshot**, which now captures *three* simultaneous changes:
    the new script path, the burndown `<li>` now present, and the two injected
    nav `<li>`s. Eyeball the regen diff to confirm only those three changed.
- **Integration** (`tests/standalone/integration`): dispatching `getDataExplorer`
  and `evaluateExpression` returns `{ ok: true }`, not
  `{ code: 'standalone-v1-disabled' }`.
- **Playwright smoke [G4]** (built bundle — exercises the real override). This is
  the **load-bearing** test for the override (only path that proves both bundle
  copies agree). The existing `smoke.spec.ts` encodes the **old `FF=false`**
  behavior — `activeId('burndown') → 'dashboard'` (`smoke.spec.ts:23`) and the
  header comments asserting the redirect / absent nav — so those must be
  **rewritten, not augmented**:
  - burndown nav link present and navigable (no longer normalized to `dashboard`);
  - Output page shows the "Token Usage" tab, and burndown data actually renders
    end-to-end (server returns data **and** client renders it);
  - Data Explorer + Rule Playground nav links present and their pages render;
  - the Rule Playground eval REPL returns a result for a sample expression.
- **Pack**: `dist/standalone/webview/app.js` is emitted by `npm run build` and
  shipped under `files` (which lists both `dist/standalone/` and `dist/webview/`)
  (`npm pack --dry-run`).
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

Two units, **sequenced (not independent)** — both touch `standalone-html.ts`, its
test, and the snapshot, so Stream 2 rebases on Stream 1 (or they ship together) to
avoid a double snapshot regen and merge churn:

1. **Stream 1 — allowlist + nav** (Data Explorer + Rule Playground eval). Lower
   risk, ships first: two allowlist entries, the single-block nav injection (new
   "Explore" group, `level-up` anchor), `v1-allowed` size assertion, integration
   `{ ok: true }` checks, smoke nav/page-render coverage.
2. **Stream 2 — token override** (Burndown + Output token tab). The larger piece:
   wrapper module, esbuild redirect plugin (manual `path.resolve` match +
   recursion guard + match-counter guard) + standalone webview entry, server
   route, script-path swap, the file-local `vi.mock` `FF=true` flip, the burndown
   assertion flip + script-path assertion update + snapshot regen, the smoke
   **rewrite** of burndown behavior, README caveat.

Each stream verifies the additive-only invariant before completion
(`git diff upstream/main -- src/` touches only `src/standalone/`).
