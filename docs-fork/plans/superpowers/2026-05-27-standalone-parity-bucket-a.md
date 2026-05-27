# Standalone Parity — Bucket A Quick Wins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose all four bucket-A features (Data Explorer, Rule Playground eval, Burndown, Output token breakdown) in the standalone build without editing any upstream `src/` file outside `src/standalone/`, and without re-enabling token reporting in the published extension.

**Architecture:** Two sequenced streams. **Stream 1** is purely additive: two entries on the frozen RPC allowlist (`getDataExplorer`, `evaluateExpression`) plus a single injected "Explore" nav group in `standalone-html.ts`. **Stream 2** is a standalone-only build-time override of `FF_TOKEN_REPORTING_ENABLED`: a wrapper module (`standalone-constants.ts`) re-exports core constants but flips the flag, an esbuild `onResolve` plugin redirects `core/constants` → the wrapper for the standalone CLI bundle **and** a new second copy of the webview bundle, the server serves that second copy, and `standalone-html.ts` points its `<script>` at it. The published extension and its shared `dist/webview/app.js` stay byte-identical (FF=false).

**Tech Stack:** TypeScript, esbuild 0.28 (`esbuild.mjs`), Vitest 4.1.6 (unit + integration), Playwright 1.60 (smoke), Express + `ws` (standalone server).

**Source design:** `docs-fork/superpowers/spec/2026-05-27-standalone-parity-bucket-a-design.md`

---

## Why the streams are sequenced (not parallel)

Both streams touch `src/standalone/standalone-html.ts`, its test `standalone-html.test.ts`, and the snapshot `standalone-html.snapshot.test.ts.snap`. Executing them in order (Stream 1 fully, then Stream 2) means each stream leaves the tree green and regenerates the snapshot from a known state. Do **not** start Stream 2 until Stream 1's tasks are all committed and green.

## File structure

| Path | Stream | Change | Responsibility |
| --- | --- | --- | --- |
| `src/standalone/v1-allowed.ts` | 1 | Modify | Add `getDataExplorer`, `evaluateExpression` (40 → 42) |
| `src/standalone/__tests__/v1-allowed.test.ts` | 1 | Modify | Assert size 42 + new membership |
| `src/standalone/standalone-html.ts` | 1 & 2 | Modify | S1: inject "Explore" nav group (Transform 3). S2: point app.js `<script>` at the standalone webview bundle (Transform 2 replacement) |
| `src/standalone/__tests__/standalone-html.test.ts` | 1 & 2 | Modify | S1: assert injected nav. S2: FF mock, flip burndown assertion, update script-path assertions |
| `src/standalone/__tests__/standalone-html.snapshot.test.ts` | 2 | Modify | Add FF mock so the snapshot reflects shipped FF=true |
| `src/standalone/__tests__/__snapshots__/standalone-html.snapshot.test.ts.snap` | 1 & 2 | Regenerate | Whole-document pin |
| `tests/standalone/integration/cli-rpc-lifecycle.test.ts` | 1 & 2 | Modify | S1: gate-passed + ok data for the two new methods. S2: getBurndown no longer returns the disabled sentinel |
| `tests/standalone/playwright/smoke.spec.ts` | 1 & 2 | Modify | S1: cover data-explorer/rule-playground + eval REPL. S2: rewrite burndown behavior, Output token tab, burndown render |
| `src/standalone/standalone-constants.ts` | 2 | **Create** | Re-export `core/constants`, override `FF_TOKEN_REPORTING_ENABLED = true` |
| `src/standalone/__tests__/standalone-constants.test.ts` | 2 | **Create** | Assert the override shadows, other constants pass through, core untouched |
| `esbuild.mjs` | 2 | Modify (additive) | Redirect plugin + second webview bundle + plugin on CLI build + optional watch entry |
| `src/standalone/server.ts` | 2 | Modify | `resolveStandaloneWebviewRoot()` + static route for `/dist/standalone/webview` |
| `src/standalone/__tests__/server.test.ts` | 2 | Modify | Assert the new helper's path |
| `docs-fork/STANDALONE-PARITY-GAPS.md` | 2 | Modify | Mark bucket A shipped; correct "no new infra" framing |
| `README.md` | 2 | Modify | Token data-quality caveat under "Measure" |
| `docs-fork/specs/07-build.md` | 2 | Modify | Document the standalone webview bundle + redirect plugin |

**Invariant:** all `src/` edits live under `src/standalone/`. `esbuild.mjs`, `README.md`, `tests/`, and `docs-fork/` are not under `src/`. No upstream `src/` file outside `src/standalone/` is modified. This is verified in the final task.

---

# Stream 1 — Allowlist + Nav (Data Explorer + Rule Playground eval)

## Task 1: Add `getDataExplorer` and `evaluateExpression` to the v1 allowlist

**Files:**
- Modify: `src/standalone/v1-allowed.ts`
- Test: `src/standalone/__tests__/v1-allowed.test.ts`

Both handlers are pure-core (`panel-rpc.ts:1062` `evaluateExpression`, `panel-rpc.ts:1175` `getDataExplorer`) and reachable by an exposed page: `page-data-explorer.ts:133` calls `getDataExplorer`; `page-rule-playground.ts` calls `evaluateExpression` on Run. `calibrateRule`/`runRuleTests` are deliberately **not** added (deferred — no exposed page calls them).

- [ ] **Step 1: Update the allowlist test to expect 42 and the two new methods**

Replace the body of `src/standalone/__tests__/v1-allowed.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { V1_ALLOWED } from '../v1-allowed';

describe('V1_ALLOWED', () => {
  it('contains exactly the documented 42', () => {
    expect(V1_ALLOWED.size).toBe(42);
  });

  it('is frozen / readonly', () => {
    // Cast back to a mutable shape at compile time to attempt a write; the
    // runtime Set must reject mutation (frozen) so the size is unchanged.
    expect(() => {
      (V1_ALLOWED as Set<string>).add('saveRule');
    }).toThrow();
    expect(V1_ALLOWED.size).toBe(42);
  });

  it('includes representative read-only methods and excludes write methods', () => {
    expect(V1_ALLOWED.has('getSessions')).toBe(true);
    expect(V1_ALLOWED.has('getStats')).toBe(true);
    expect(V1_ALLOWED.has('getRegistryCatalog')).toBe(true);
    expect(V1_ALLOWED.has('saveRule')).toBe(false);
    expect(V1_ALLOWED.has('getRuleEditor')).toBe(false); // deliberately excluded
  });

  it('includes the bucket-A additions reachable by an exposed page', () => {
    expect(V1_ALLOWED.has('getDataExplorer')).toBe(true); // page-data-explorer.ts:133
    expect(V1_ALLOWED.has('evaluateExpression')).toBe(true); // page-rule-playground.ts (Run)
  });

  it('does NOT add the deferred rule-write methods (no exposed page calls them)', () => {
    expect(V1_ALLOWED.has('calibrateRule')).toBe(false);
    expect(V1_ALLOWED.has('runRuleTests')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/standalone/__tests__/v1-allowed.test.ts`
Expected: FAIL — `expected 40 to be 42` and the bucket-A membership assertions fail.

- [ ] **Step 3: Add the two methods to the frozen set**

In `src/standalone/v1-allowed.ts`, add `getDataExplorer` and `evaluateExpression` to the `_inner` Set, and update the header comment count. Change the set's last grouping (lines 18-21) to:

```ts
  'getRuleCoverage', 'getFieldSchema', 'getMetricPrimitives',
  'getFunctionCatalog', 'getMetricList', 'getDataExplorerFields',
  'getRegistryCatalog', 'getDataExplorer', 'evaluateExpression',
]);
```

And update the file's top comment (lines 2-4) from "All 40 are read-only..." to:

```ts
// The authoritative v1 method allowlist (see docs-fork/specs/00-overview.md).
// 40 read-only getRpcHandler methods + 2 bucket-A additions (getDataExplorer,
// evaluateExpression) = 42. getRuleEditor is deliberately excluded (its handler
// calls require('vscode')); calibrateRule/runRuleTests are deferred (no exposed
// page reaches them — see docs-fork/superpowers/spec bucket-A design).
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/standalone/__tests__/v1-allowed.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/standalone/v1-allowed.ts src/standalone/__tests__/v1-allowed.test.ts
git commit -m "feat(standalone): allowlist getDataExplorer + evaluateExpression (bucket A)"
```

---

## Task 2: Inject the "Explore" nav group in `standalone-html.ts`

**Files:**
- Modify: `src/standalone/standalone-html.ts`
- Test: `src/standalone/__tests__/standalone-html.test.ts`

Upstream renders **no** nav `<li>` for Data Explorer / Rule Playground — they are deep-link-only routes (the extension reaches them via VS Code commands). Standalone has no command palette, so a nav-less route is unreachable. Injecting nav links is the standalone equivalent of the extension's command entrypoints. The router already handles both page IDs (`app.ts:649` `data-explorer`, `app.ts:650` `rule-playground`).

The injection is **one block** (group header + both links) inserted after the last nav item (`data-page="level-up"`), anchored on the `level-up`→`</ul>` boundary so a nav reorder that moves Level Up off the end fails loudly — the same "exactly one match or throw" contract as the existing `replaceOnce`.

- [ ] **Step 1: Write the failing nav assertions**

In `src/standalone/__tests__/standalone-html.test.ts`, append this describe block at the end of the file (after the existing `whole-output properties` block):

```ts
describe('renderStandaloneHtml — Transform 3: injected Explore nav group', () => {
  const html = renderStandaloneHtml({ token: TOKEN, appVersion: '0.1.0' });
  const occurrences = (needle: string): number => html.split(needle).length - 1;

  it('adds the Explore group header exactly once', () => {
    expect(occurrences('<li class="nav-group-header">Explore</li>')).toBe(1);
  });

  it('adds the Data Explorer and Rule Playground links exactly once each', () => {
    expect(occurrences('data-page="data-explorer"')).toBe(1);
    expect(occurrences('data-page="rule-playground"')).toBe(1);
  });

  it('injects the group after Level Up and before the nav </ul>', () => {
    const levelUpAt = html.indexOf('data-page="level-up"');
    const exploreAt = html.indexOf('<li class="nav-group-header">Explore</li>');
    const ulCloseAt = html.indexOf('</ul>');
    expect(levelUpAt).toBeGreaterThan(-1);
    expect(levelUpAt).toBeLessThan(exploreAt);
    expect(exploreAt).toBeLessThan(ulCloseAt);
  });

  it('throws if the level-up→</ul> nav boundary is missing (drift guard)', () => {
    vi.spyOn(panelHtml, 'getDashboardHtml').mockReturnValue(
      '<!DOCTYPE html><html><head>' +
        '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'">' +
        '</head><body><main id="content"></main>' +
        '<script nonce="x" src="/dist/webview/app.js"></script></body></html>',
    );
    expect(() => renderStandaloneHtml({ token: TOKEN, appVersion: '0.1.0' })).toThrow(
      /expected exactly one level-up.*nav boundary, found 0/,
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/standalone/__tests__/standalone-html.test.ts`
Expected: FAIL — the Explore header / data-explorer / rule-playground are absent (occurrences 0, not 1).

- [ ] **Step 3: Implement Transform 3**

In `src/standalone/standalone-html.ts`, inside `renderStandaloneHtml`, add this block **after** Transform 2 (after the existing `html = replaceOnce(... 'app.js script tag')` call at line 71) and before `return html;`:

```ts
  // Transform 3 (standalone-only nav parity): inject an "Explore" group with the two
  // command-entrypoint pages after the last nav item (Level Up). Upstream renders no
  // nav <li> for these deep-link-only routes; standalone has no command palette, so the
  // nav link IS the entrypoint. Anchored on the level-up <li> immediately preceding the
  // nav </ul>, so a reorder that moves Level Up off the end yields 0 matches and throws
  // — same "fail loud on drift" contract as replaceOnce.
  const exploreNav =
    '\n      <li class="nav-group-header">Explore</li>' +
    '\n      <li><a href="#" data-page="data-explorer"><span class="nav-icon">&#128269;</span> Data Explorer</a></li>' +
    '\n      <li><a href="#" data-page="rule-playground"><span class="nav-icon">&#9881;</span> Rule Playground</a></li>';
  const navBoundary = /(<a href="#" data-page="level-up"[\s\S]*?<\/a><\/li>)(\s*<\/ul>)/;
  const navCount = (html.match(new RegExp(navBoundary, 'g')) ?? []).length;
  if (navCount !== 1) {
    throw new Error(`coach: expected exactly one level-up→</ul> nav boundary, found ${navCount}`);
  }
  html = html.replace(navBoundary, (_m, levelUpLi: string, ulClose: string) => `${levelUpLi}${exploreNav}${ulClose}`);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/standalone/__tests__/standalone-html.test.ts`
Expected: PASS (all blocks, including the 4 new Transform 3 tests).

- [ ] **Step 5: Regenerate the snapshot and eyeball the diff**

Run: `npx vitest run -u src/standalone/__tests__/standalone-html.snapshot.test.ts`
Then: `git diff src/standalone/__tests__/__snapshots__/standalone-html.snapshot.test.ts.snap`
Expected: the **only** added lines are the three injected nav `<li>`s (Explore header + Data Explorer + Rule Playground) immediately after the Level Up `<li>`. No other lines change (still FF=false → no burndown `<li>`; script still `/dist/webview/app.js`). If anything else changed, stop and investigate.

- [ ] **Step 6: Commit**

```bash
git add src/standalone/standalone-html.ts src/standalone/__tests__/standalone-html.test.ts src/standalone/__tests__/__snapshots__/standalone-html.snapshot.test.ts.snap
git commit -m "feat(standalone): inject Explore nav group (Data Explorer + Rule Playground)"
```

---

## Task 3: Integration test — the two new methods pass the allowlist gate and return data

**Files:**
- Modify: `tests/standalone/integration/cli-rpc-lifecycle.test.ts`

This test runs against the **built** `dist/standalone/cli.js`, so it must be built first. The CLI boots serve-then-parse; `cli.ts:120-121` always calls `handle.setData(...)` after the (empty-home) parse, so waiting for the `dataReady` frame makes the allowlisted handlers reachable deterministically. `getDataExplorerFields` is already allowlisted — use it to fetch a valid field name rather than hardcoding one.

- [ ] **Step 1: Add the integration test**

In `tests/standalone/integration/cli-rpc-lifecycle.test.ts`, update the helpers import on line 7 to include `wsWaitFor`:

```ts
import { bootCli, makeTmpHome, stopCli, wsConnect, wsRequest, wsWaitFor, type Booted, CLI } from './helpers';
```

Then add this test inside the `describe('cli rpc + lifecycle', ...)` block (after the first `it(...)`):

```ts
  it('exposes getDataExplorer + evaluateExpression (bucket-A allowlist), returning data not the disabled gate', async () => {
    const home = makeTmpHome();
    const b = track(await bootCli(home, ['--port', '7360']), home);
    const ws = await wsConnect(b);
    await wsWaitFor(ws, 'dataReady'); // serve-then-parse: analyzer present after this frame

    // getDataExplorerFields is already allowlisted; use it to get a valid field name.
    const fieldsRes = await wsRequest(ws, 'getDataExplorerFields', {}, 'f1');
    const fieldName = (fieldsRes.data as { fields: Array<{ name: string }> }).fields[0].name;

    const de = await wsRequest(ws, 'getDataExplorer', { field: fieldName }, 'de1');
    const ev = await wsRequest(ws, 'evaluateExpression', { expr: 'messageLength > 0', scope: 'requests' }, 'ev1');
    ws.close();

    // Before this change both returned { code: 'standalone-v1-disabled' } (tier-2 gate).
    expect((de.data as { code?: string }).code).not.toBe('standalone-v1-disabled');
    expect((ev.data as { code?: string }).code).not.toBe('standalone-v1-disabled');
    // ...and they reached the real pure-core handler (ok shape: no error field).
    expect((de.data as { error?: string }).error).toBeUndefined();
    expect((ev.data as { error?: string }).error).toBeUndefined();
    expect((ev.data as { total?: number }).total).toBeTypeOf('number'); // evaluateExpression result
  });
```

- [ ] **Step 2: Build the standalone bundle (the integration test runs the built CLI)**

Run: `npm run build`
Expected: prints `Build complete.` and exits 0.

- [ ] **Step 3: Run the integration test**

Run: `npx vitest run --config tests/standalone/integration/vitest.config.ts -t "bucket-A allowlist"`
Expected: PASS. (Sanity: if you revert Task 1's allowlist change and rebuild, this test fails with `standalone-v1-disabled` — that is the regression it guards.)

- [ ] **Step 4: Commit**

```bash
git add tests/standalone/integration/cli-rpc-lifecycle.test.ts
git commit -m "test(standalone): integration coverage for getDataExplorer + evaluateExpression"
```

---

## Task 4: Smoke coverage — Data Explorer + Rule Playground pages and the eval REPL

**Files:**
- Modify: `tests/standalone/playwright/smoke.spec.ts`

The Playwright smoke seeds a home with fixture data (`global-setup.ts` → `seed-home.mjs`) and boots the built CLI, so pages render with real data. Data Explorer and Rule Playground are **not** FF-gated, so this task works against the current (FF=false) standalone bundle — leave all burndown handling untouched here (Stream 2 rewrites it). The page IDs render via `app.ts:649-650`; the eval results panel is `#playground-results`, whose empty placeholder text is `Write an expression and click Run to see results` (`page-rule-playground.ts:84`).

- [ ] **Step 1: Add the two new pages to the per-page NAV loop**

In `tests/standalone/playwright/smoke.spec.ts`, extend the `NAV` array (lines 16-19) to include the two new pages:

```ts
const NAV = [
  'dashboard', 'timeline', 'image-gallery', 'output', 'burndown',
  'patterns', 'anti-patterns', 'skills', 'config-health', 'level-up',
  'data-explorer', 'rule-playground',
];
```

(Leave `activeId`/`activeLink` as-is in this stream; `data-explorer`/`rule-playground` are not special-cased, so `activeId` returns them unchanged.)

- [ ] **Step 2: Add the eval REPL test**

Append at the end of `tests/standalone/playwright/smoke.spec.ts`:

```ts
test('rule playground eval REPL returns a result for a sample expression', async ({ page }) => {
  await page.goto(pageUrl('rule-playground'), { waitUntil: 'load' });
  await expect(page.locator('.nav-links a[data-page="rule-playground"]')).toHaveClass(/active/, { timeout: 15_000 });
  await page.fill('#playground-expr', 'messageLength > 0');
  await page.click('#playground-run');
  // The results panel replaces its empty placeholder once evaluateExpression resolves.
  await expect(page.locator('#playground-results')).not.toContainText(
    'Write an expression and click Run', { timeout: 10_000 },
  );
});
```

- [ ] **Step 3: Build and run the smoke suite**

Run: `npm run build` then `npm run test:playwright:standalone`
Expected: PASS — including the 12 per-page checks (now with `#data-explorer` and `#rule-playground`) and the new eval REPL test. (If `npm run build` was just run in Task 3 with no source change since, you may skip the rebuild.)

- [ ] **Step 4: Commit**

```bash
git add tests/standalone/playwright/smoke.spec.ts
git commit -m "test(standalone): smoke coverage for Data Explorer, Rule Playground + eval REPL"
```

- [ ] **Step 5: Verify the additive-only invariant for Stream 1**

Run: `git diff upstream/main -- src/`
Expected: every changed path is under `src/standalone/`. (If `upstream/main` is not configured as a remote-tracking ref, compare against the documented baseline commit `abc0a6c` per `docs-fork/STANDALONE-PARITY-GAPS.md`.) If any `src/` file outside `src/standalone/` appears, stop and revert it.

---

# Stream 2 — Token override (Burndown + Output token breakdown)

> Do not begin until Stream 1 is fully committed and green.

## Task 5: Create the standalone constants wrapper module

**Files:**
- Create: `src/standalone/standalone-constants.ts`
- Test: `src/standalone/__tests__/standalone-constants.test.ts`

In ESM, an explicit local `export const` shadows a wildcard `export *` re-export for that one name; esbuild and Vite both honor this. This module is the redirect target for Task 6.

- [ ] **Step 1: Write the failing test**

Create `src/standalone/__tests__/standalone-constants.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import * as standalone from '../standalone-constants';
import * as core from '../../core/constants';

describe('standalone-constants', () => {
  it('overrides FF_TOKEN_REPORTING_ENABLED to true while core stays false', () => {
    expect(standalone.FF_TOKEN_REPORTING_ENABLED).toBe(true);
    expect(core.FF_TOKEN_REPORTING_ENABLED).toBe(false); // upstream constant untouched
  });

  it('re-exports every other core constant unchanged', () => {
    expect(standalone.CONTEXT_WINDOW_DEFAULT).toBe(core.CONTEXT_WINDOW_DEFAULT);
    expect(standalone.TOKEN_DATA_AVAILABLE_FROM).toBe(core.TOKEN_DATA_AVAILABLE_FROM);
    expect(standalone.FLOW_DEEP_SCORE).toBe(core.FLOW_DEEP_SCORE);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/standalone/__tests__/standalone-constants.test.ts`
Expected: FAIL — cannot resolve `../standalone-constants` (module does not exist).

- [ ] **Step 3: Create the wrapper module**

Create `src/standalone/standalone-constants.ts`:

```ts
// src/standalone/standalone-constants.ts
// Standalone-only override of the shared feature flag. Re-exports every upstream
// core constant, then shadows FF_TOKEN_REPORTING_ENABLED with `true`. An explicit
// local export wins over the `export *` re-export for that one name (ESM rule).
//
// This module is NEVER imported by upstream code directly — esbuild's
// constants-redirect plugin (esbuild.mjs) swaps `core/constants` for this file
// ONLY in the standalone CLI bundle and the standalone webview bundle, so the
// published extension and the shared dist/webview/app.js keep FF=false.
export * from '../core/constants';
export const FF_TOKEN_REPORTING_ENABLED = true;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/standalone/__tests__/standalone-constants.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/standalone/standalone-constants.ts src/standalone/__tests__/standalone-constants.test.ts
git commit -m "feat(standalone): add standalone-constants wrapper (FF override target)"
```

---

## Task 6: esbuild redirect plugin + second webview bundle + plugin on the CLI build

**Files:**
- Modify: `esbuild.mjs`

The plugin keys on the **resolved absolute path** (not the import specifier) so it catches every relative spelling of `core/constants` uniformly across the bundled core — the exact reason esbuild `alias` (specifier-keyed) and `define` (unbound-identifier-only) cannot do this job. A per-build match counter throws on zero redirects so an upstream rename of `constants.ts` fails the build loudly instead of silently shipping FF=false.

- [ ] **Step 1: Add the plugin factory near the top of `esbuild.mjs`**

In `esbuild.mjs`, after the imports and `const isWatch = ...` (line 10), insert:

```js
// --- Standalone-only FF_TOKEN_REPORTING_ENABLED override (see docs-fork/specs/07-build.md) ---
// Redirect every import that RESOLVES to src/core/constants.ts -> src/standalone/
// standalone-constants.ts (re-exports core + flips the flag), but ONLY inside the
// builds this plugin is attached to (standalone CLI + standalone webview). Keyed on
// the resolved absolute path so it catches every relative spelling uniformly — the
// reason `alias` (specifier-keyed) can't do this. New instance per build so each
// build independently asserts >=1 redirect.
function makeConstantsRedirectPlugin() {
  const realConstants = path.resolve('src', 'core', 'constants.ts');
  const standaloneConstants = path.resolve('src', 'standalone', 'standalone-constants.ts');
  return {
    name: 'standalone-constants-redirect',
    setup(build) {
      let redirects = 0;
      build.onResolve({ filter: /constants$/ }, (args) => {
        // standalone-constants.ts's own `export * from '../core/constants'` must reach
        // the REAL module — break recursion here (compare OS-native absolute paths).
        if (path.resolve(args.importer) === standaloneConstants) return undefined;
        // Manual resolution (NOT build.resolve(), which would re-enter onResolve).
        const resolved = path.resolve(args.resolveDir, args.path);
        if (resolved === realConstants || `${resolved}.ts` === realConstants) {
          redirects++;
          return { path: standaloneConstants };
        }
        return undefined;
      });
      build.onEnd(() => {
        if (redirects === 0) {
          throw new Error(
            'standalone-constants-redirect: 0 redirects. src/core/constants.ts was ' +
              'renamed/moved or its import spelling changed; the standalone bundle would ' +
              'ship FF_TOKEN_REPORTING_ENABLED=false and re-disable burndown. Fix the plugin target.',
          );
        }
      });
    },
  };
}
```

- [ ] **Step 2: Attach the plugin to the standalone CLI build**

In the standalone CLI build object (`esbuild.mjs` ~line 134-167, `outfile: 'dist/standalone/cli.js'`), add a `plugins` key alongside the existing `alias`:

```js
    alias: {
      vscode: './src/standalone/vscode-stub.ts',
    },
    plugins: [makeConstantsRedirectPlugin()],
```

- [ ] **Step 3: Add the standalone webview bundle entry**

In the standalone `await Promise.all([ ... ])` (the block that builds cli/shim/workers, ending at line 218), add this entry (e.g. right after the shim build, item 2):

```js
  // Standalone webview bundle: a SECOND copy of src/webview/app.ts with the constants
  // redirect, so the CLIENT reads FF_TOKEN_REPORTING_ENABLED=true (keeps the burndown
  // route/nav, renders the Output "Token Usage" tab, drops the dashboard hidden banner).
  // The shared dist/webview/app.js stays FF=false for the published extension.
  // sourcemap:false matches the sibling dist/standalone/ bundles.
  esbuild.build({
    entryPoints: ['src/webview/app.ts'],
    outfile: 'dist/standalone/webview/app.js',
    platform: 'browser',
    target: 'es2022',
    format: 'iife',
    bundle: true,
    sourcemap: false,
    plugins: [makeConstantsRedirectPlugin()],
    logLevel: 'info',
  }),
```

- [ ] **Step 4 (optional, dev parity): add the standalone webview to the `--watch` block**

In the `if (isWatch)` block, after `ctx4` (line 288), add:

```js
  const ctx6 = await esbuild.context({
    entryPoints: ['src/webview/app.ts'],
    outfile: 'dist/standalone/webview/app.js',
    platform: 'browser',
    target: 'es2022',
    format: 'iife',
    bundle: true,
    sourcemap: false,
    plugins: [makeConstantsRedirectPlugin()],
  });
```

and add `ctx6.watch()` to the `await Promise.all([...])` watch call (line 289):

```js
  await Promise.all([ctx1.watch(), ctx2.watch(), ctx3.watch(), ctx4.watch(), ctx5.watch(), ctx6.watch()]);
```

- [ ] **Step 5: Build and verify the override took effect**

Run: `npm run build`
Expected: prints `Build complete.` and exits 0 (the build would have thrown `standalone-constants-redirect: 0 redirects` if the plugin matched nothing).

Then verify the standalone webview bundle exists and differs from the shared (FF=false) one:

```powershell
Test-Path dist/standalone/webview/app.js
(Get-FileHash dist/webview/app.js).Hash -ne (Get-FileHash dist/standalone/webview/app.js).Hash
```

Expected: `True` and `True` — the file exists and the two bundles are not byte-identical (proves the flag override changed the standalone bundle). The semantic proof (server returns real burndown data) is Task 9.

- [ ] **Step 6: Commit**

```bash
git add esbuild.mjs
git commit -m "build(standalone): redirect core/constants -> standalone-constants for CLI + webview bundles"
```

---

## Task 7: Serve the standalone webview bundle

**Files:**
- Modify: `src/standalone/server.ts`
- Test: `src/standalone/__tests__/server.test.ts`

The client now loads `/dist/standalone/webview/app.js`; the server must expose it under auth, mirroring the existing `/dist/webview` static route. `styles.css` is flag-independent and continues to load from `/dist/webview/styles.css`.

- [ ] **Step 1: Write the failing helper test**

In `src/standalone/__tests__/server.test.ts`, add `resolveStandaloneWebviewRoot` to the import on line 21:

```ts
import { createServer, probeExistingInstance, resolveShimPath, resolveStandaloneWebviewRoot, resolveWebviewRoot, type ServerHandle } from '../server';
```

Then add a focused test (place it near any existing `resolveWebviewRoot`/path assertions, or in a fresh `describe`):

```ts
describe('resolveStandaloneWebviewRoot', () => {
  it('points at dist/standalone/webview under the project root', () => {
    const root = resolveStandaloneWebviewRoot();
    expect(root.endsWith(path.join('dist', 'standalone', 'webview'))).toBe(true);
    // It is a sibling of the shared webview root, one level deeper under dist/standalone.
    expect(root).toContain(path.join('dist', 'standalone'));
    expect(resolveWebviewRoot().endsWith(path.join('dist', 'webview'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/standalone/__tests__/server.test.ts -t "resolveStandaloneWebviewRoot"`
Expected: FAIL — `resolveStandaloneWebviewRoot` is not exported (import/type error or undefined).

- [ ] **Step 3: Add the helper and the static route**

In `src/standalone/server.ts`, add the helper right after `resolveWebviewRoot` (line 53):

```ts
export function resolveStandaloneWebviewRoot(): string {
  return path.join(resolveProjectRoot(), 'dist', 'standalone', 'webview');
}
```

Then register the static route immediately after the existing `/dist/webview` route (line 262):

```ts
  app.use('/dist/webview', auth, express.static(resolveWebviewRoot()));
  app.use('/dist/standalone/webview', auth, express.static(resolveStandaloneWebviewRoot()));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/standalone/__tests__/server.test.ts`
Expected: PASS (existing server tests + the new helper test).

- [ ] **Step 5: Commit**

```bash
git add src/standalone/server.ts src/standalone/__tests__/server.test.ts
git commit -m "feat(standalone): serve dist/standalone/webview (FF=true app.js)"
```

---

## Task 8: Point `standalone-html.ts` at the standalone bundle + reflect FF=true in its tests

**Files:**
- Modify: `src/standalone/standalone-html.ts`
- Modify: `src/standalone/__tests__/standalone-html.test.ts`
- Modify: `src/standalone/__tests__/standalone-html.snapshot.test.ts`
- Regenerate: `src/standalone/__tests__/__snapshots__/standalone-html.snapshot.test.ts.snap`

Transform 2 already matches the upstream nonce'd `<script src="/dist/webview/app.js">` — only the **replacement** changes to point at the standalone bundle (the shim ordering is preserved). The unit/snapshot tests render `panel-html`, which reads `FF_TOKEN_REPORTING_ENABLED` as a build-time const; mock `core/constants` **file-locally** (NOT a config-wide vitest alias, which `vitest.config.mts` cannot scope to standalone and would flip FF for the whole repo) so both files reflect the shipped FF=true reality — the burndown nav `<li>` returns from `panel-html` automatically.

- [ ] **Step 1: Update the failing unit assertions (script path + burndown nav)**

In `src/standalone/__tests__/standalone-html.test.ts`:

(a) Add the FF mock at the top, immediately after the imports (lines 1-6, before the first `describe`):

```ts
// Standalone ships FF_TOKEN_REPORTING_ENABLED=true (esbuild constants redirect). Mock it
// file-locally so panel-html (imported transitively) renders the burndown nav <li>, matching
// the shipped standalone bundle. vitest keys module mocks on the resolved path, so panel-html's
// own `import ... from '../core/constants'` is intercepted too. (Config-wide alias is wrong: it
// would flip FF for every unit test in the repo — see docs-fork/superpowers/spec bucket-A design.)
vi.mock('../../core/constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/constants')>();
  return { ...actual, FF_TOKEN_REPORTING_ENABLED: true };
});
```

(b) Replace the `omits the burndown nav...` test (lines 37-39) with:

```ts
  it('emits the burndown nav <li> (standalone FF override is true)', () => {
    expect(html).toContain('data-page="burndown"');
  });
```

(c) In the `Transform 2: external scripts` block, update the app.js path assertions. Change line 79 to:

```ts
    const appAt = html.indexOf('<script src="/dist/standalone/webview/app.js">');
```

and the array in `contains exactly two scripts` (lines 89-92) to:

```ts
    expect(scripts.map((s) => s.getAttribute('src'))).toEqual([
      '/standalone-shim.js',
      '/dist/standalone/webview/app.js',
    ]);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/standalone/__tests__/standalone-html.test.ts`
Expected: FAIL — `appAt` is `-1` / the script array is `['/standalone-shim.js', '/dist/webview/app.js']` (Transform 2 replacement not changed yet). The burndown assertion should already pass via the FF mock.

- [ ] **Step 3: Change the Transform 2 replacement to the standalone bundle path**

In `src/standalone/standalone-html.ts`, in the Transform 2 `replaceOnce` call (lines 66-71), change only the replacement string's app.js path:

```ts
  html = replaceOnce(
    html,
    /<script nonce="[^"]*" src="\/dist\/webview\/app\.js"><\/script>/,
    `<script src="/standalone-shim.js"></script>\n<script src="/dist/standalone/webview/app.js"></script>`,
    'app.js script tag',
  );
```

(The regex — what we match in the upstream output — is unchanged; `panel-html` still emits `/dist/webview/app.js`. Only the rewritten target moves.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/standalone/__tests__/standalone-html.test.ts`
Expected: PASS (all blocks, including Transform 3 from Stream 1 and the updated Transform 2 + burndown assertions).

- [ ] **Step 5: Add the FF mock to the snapshot test and regenerate**

In `src/standalone/__tests__/standalone-html.snapshot.test.ts`, add the same mock after the imports (lines 1-2), so the snapshot reflects shipped FF=true. Add `vi` to the import on line 1:

```ts
import { describe, expect, it, vi } from 'vitest';
import { renderStandaloneHtml } from '../standalone-html';

vi.mock('../../core/constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/constants')>();
  return { ...actual, FF_TOKEN_REPORTING_ENABLED: true };
});
```

Then regenerate: `npx vitest run -u src/standalone/__tests__/standalone-html.snapshot.test.ts`
Then: `git diff src/standalone/__tests__/__snapshots__/standalone-html.snapshot.test.ts.snap`
Expected — exactly **two** changes versus the Stream 1 snapshot:
1. the burndown `<li>` (`data-page="burndown"`) now present in the "Measure" group (the empty line at snapshot line 24 becomes the burndown link);
2. the final `<script>` src changes from `/dist/webview/app.js` to `/dist/standalone/webview/app.js`.
If anything else changed, stop and investigate.

- [ ] **Step 6: Commit**

```bash
git add src/standalone/standalone-html.ts src/standalone/__tests__/standalone-html.test.ts src/standalone/__tests__/standalone-html.snapshot.test.ts src/standalone/__tests__/__snapshots__/standalone-html.snapshot.test.ts.snap
git commit -m "feat(standalone): serve FF=true webview bundle + reflect burndown nav in tests"
```

---

## Task 9: Integration test — the standalone server enables token reporting

**Files:**
- Modify: `tests/standalone/integration/cli-rpc-lifecycle.test.ts`

This is the server-side proof of the override: with the redirect plugin active in the CLI bundle, `getBurndown` reaches the real handler instead of `errorResult('Token reporting is temporarily disabled')` (which `panel-shared.ts:16` shapes as `{ error: '...' }`). Runs against the built CLI; the override would otherwise be invisible to the unit/integration layer (the design's load-bearing end-to-end check is the smoke in Task 10).

- [ ] **Step 1: Add the integration test**

In `tests/standalone/integration/cli-rpc-lifecycle.test.ts`, add inside the `describe` block:

```ts
  it('standalone bundle enables token reporting (getBurndown is not the disabled sentinel)', async () => {
    const home = makeTmpHome();
    const b = track(await bootCli(home, ['--port', '7361']), home);
    const ws = await wsConnect(b);
    await wsWaitFor(ws, 'dataReady');
    const bd = await wsRequest(ws, 'getBurndown', {}, 'bd1');
    const tc = await wsRequest(ws, 'getTokenCoverage', {}, 'tc1');
    ws.close();
    // FF override active in the built CLI bundle -> the false-branch sentinel is gone.
    expect((bd.data as { error?: string }).error).not.toBe('Token reporting is temporarily disabled');
    expect((tc.data as { error?: string }).error).not.toBe('Token reporting is temporarily disabled');
  });
```

- [ ] **Step 2: Build and run the integration test**

Run: `npm run build` then `npx vitest run --config tests/standalone/integration/vitest.config.ts -t "enables token reporting"`
Expected: PASS. (Sanity: against a pre-Task-6 build the CLI bundle is FF=false and this test fails — `getBurndown` returns the disabled sentinel.)

- [ ] **Step 3: Commit**

```bash
git add tests/standalone/integration/cli-rpc-lifecycle.test.ts
git commit -m "test(standalone): integration proof the CLI bundle enables token reporting"
```

---

## Task 10: Rewrite the smoke for FF=true (burndown, Output token tab, burndown render)

**Files:**
- Modify: `tests/standalone/playwright/smoke.spec.ts`

The existing smoke encodes the **old FF=false** behavior — `activeId('burndown') → 'dashboard'` and a header comment asserting the redirect / absent nav. With the override, burndown's nav `<li>` is present and `navigateTo('burndown')` no longer normalizes to dashboard. Rewrite, don't augment. Labels confirmed: the Output tab button is `data-tab="token-usage">Token Usage` (`page-output.ts:238`, emitted only when FF=true); the FF=false-only banners read `temporarily disabled` (`page-output.ts:700`, `page-burndown.ts:127`).

- [ ] **Step 1: Rewrite the NAV header comment and `activeId`**

In `tests/standalone/playwright/smoke.spec.ts`, replace the comment block + `activeId` (lines 11-24) with:

```ts
// The 12 real nav page ids. The shim's hash bridge (04-webview-shim Task 5) selects the page
// from `#<id>` after dataReady; navigateTo toggles `active` on the matching nav link (app.ts:466).
// The standalone bundle ships FF_TOKEN_REPORTING_ENABLED=true (esbuild constants redirect), so
// burndown's nav <li> IS emitted and navigateTo('burndown') is no longer normalized to dashboard.
const NAV = [
  'dashboard', 'timeline', 'image-gallery', 'output', 'burndown',
  'patterns', 'anti-patterns', 'skills', 'config-health', 'level-up',
  'data-explorer', 'rule-playground',
];

const pageUrl = (id: string): string => `${origin}/?t=${token}#${id}`;
// FF=true: every page (including burndown) owns its own active nav link.
const activeLink = (id: string): string => `.nav-links a[data-page="${id}"]`;
```

(This removes the `activeId` helper; the per-page loop's `activeLink(id)` now uses `id` directly. Confirm no other reference to `activeId` remains — there is none after this edit.)

- [ ] **Step 2: Add the Output token-tab and burndown-render tests**

Append at the end of `tests/standalone/playwright/smoke.spec.ts`:

```ts
test('output page shows the Token Usage tab (token reporting enabled in standalone)', async ({ page }) => {
  await page.goto(pageUrl('output'), { waitUntil: 'load' });
  await expect(page.locator('.nav-links a[data-page="output"]')).toHaveClass(/active/, { timeout: 15_000 });
  // The token-usage tab button is rendered only when FF_TOKEN_REPORTING_ENABLED is true.
  await expect(page.locator('button[data-tab="token-usage"]')).toBeVisible({ timeout: 10_000 });
});

test('burndown page renders end-to-end (override active, not the disabled banner)', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(pageUrl('burndown'), { waitUntil: 'load' });
  // burndown now owns its own active nav link (no redirect to dashboard).
  await expect(page.locator('.nav-links a[data-page="burndown"]')).toHaveClass(/active/, { timeout: 15_000 });
  await expect.poll(() => page.locator('main#content > *').count(), { timeout: 15_000 }).toBeGreaterThan(0);
  // Server returned real burndown data, so the FF=false gated notice is absent.
  await expect(page.locator('main#content')).not.toContainText('temporarily disabled');
  expect(errors, `console errors on #burndown:\n${errors.join('\n')}`).toEqual([]);
});
```

- [ ] **Step 3: Build and run the smoke suite**

Run: `npm run build` then `npm run test:playwright:standalone`
Expected: PASS — the 12 per-page checks now assert burndown's own active link (rendered by the FF=true bundle), plus the eval REPL test (Stream 1), the Token Usage tab test, and the burndown render test.

- [ ] **Step 4: Commit**

```bash
git add tests/standalone/playwright/smoke.spec.ts
git commit -m "test(standalone): rewrite smoke for FF=true (burndown, Token Usage tab)"
```

---

## Task 11: Docs + pack check + final invariant verification

**Files:**
- Modify: `docs-fork/STANDALONE-PARITY-GAPS.md`
- Modify: `README.md`
- Modify: `docs-fork/specs/07-build.md`

- [ ] **Step 1: Mark bucket A shipped in the parity-gaps doc**

In `docs-fork/STANDALONE-PARITY-GAPS.md`, replace the `## A. Quick wins — allowlist/flag flips, no new infra` heading and its four bullets (lines 24-49) with a shipped section that corrects the "no new infra" framing for the token items:

```markdown
## A. Quick wins — SHIPPED (2026-05-27)

All four exposed in the standalone build. Note: only two were genuinely
"no new infra"; the token items required a standalone-only build override.

- **Data Explorer** ✅ — `getDataExplorer` added to the allowlist (40 → 42) and a
  nav link injected in `standalone-html.ts` (deep-link-only upstream). Pure-core,
  no infra.
- **Rule Playground (eval)** ✅ — `evaluateExpression` added to the allowlist and a
  nav link injected (same "Explore" group). Pure-core. `compileNlRule` (NL→rule,
  bucket D) and `saveRule` (bucket B) remain disabled and degrade gracefully.
- **Burndown** ✅ — NOT an allowlist gap (its RPC methods were already allowlisted);
  gated by `FF_TOKEN_REPORTING_ENABLED = false` in shared core. Exposed via a
  **standalone-only** override: `src/standalone/standalone-constants.ts` re-exports
  core constants with the flag flipped, and an esbuild `onResolve` plugin redirects
  `core/constants` to it for the standalone CLI bundle + a new
  `dist/standalone/webview/app.js`. The published extension stays FF=false. (So the
  original "flip the one flag" framing was wrong — the flag is shared between the
  extension and standalone via one bundle.)
- **Output token breakdown** ✅ — same `FF_TOKEN_REPORTING_ENABLED` override; the
  Output page now renders its "Token Usage" tab in standalone.
```

- [ ] **Step 2: Add the token data-quality caveat to the README**

In `README.md`, add a note line immediately after the "Measure" table (after line 98, the Patterns row). Insert:

```markdown

> **Standalone token reporting.** The standalone build enables the Burndown and Output
> "Token Usage" views. Reported token numbers are derived from local transcripts and
> **may not align with GitHub billing** — treat them as directional, not authoritative.
```

- [ ] **Step 3: Document the standalone webview bundle + redirect plugin in 07-build.md**

In `docs-fork/specs/07-build.md`, append a subsection (after the "esbuild.mjs additions" content) documenting:
- the second webview bundle `dist/standalone/webview/app.js` (browser/iife/es2022, `sourcemap:false`), built from the shared `src/webview/app.ts` with the constants-redirect plugin;
- the `makeConstantsRedirectPlugin` factory: resolved-absolute-path match (not specifier), the `standalone-constants.ts` recursion guard, the zero-redirect `onEnd` throw, and that it is attached to both the standalone CLI build and the standalone webview build (so server and client agree on FF=true);
- that `files: ["dist/standalone/"]` already ships the new bundle, and the shared `dist/webview/app.js` stays FF=false for the extension.

Use this text:

```markdown
## Standalone token-reporting override (bucket A)

The standalone build ships `FF_TOKEN_REPORTING_ENABLED = true` without editing the
shared `src/core/constants.ts`. Mechanism:

- `src/standalone/standalone-constants.ts` — `export *` from `core/constants` plus a
  local `export const FF_TOKEN_REPORTING_ENABLED = true` (ESM shadow).
- `makeConstantsRedirectPlugin()` in `esbuild.mjs` — an `onResolve` plugin that
  redirects any import resolving to the absolute `src/core/constants.ts` to the
  wrapper. It matches on the **resolved absolute path** (not the specifier, so every
  relative spelling is caught), skips the wrapper's own `export *` (recursion guard),
  and throws in `onEnd` if it made zero redirects (loud failure on an upstream rename).
- The plugin is attached to **two** builds: the standalone CLI bundle
  (`dist/standalone/cli.js`, server-side handlers) and a **new** standalone webview
  bundle `dist/standalone/webview/app.js` (browser/iife/es2022, `sourcemap:false`),
  built from the shared `src/webview/app.ts`. Both must agree on FF=true.
- The shared `dist/webview/app.js` and the published extension keep FF=false.
  `files: ["dist/standalone/"]` ships the new bundle automatically; the server serves
  it from `/dist/standalone/webview` and `standalone-html.ts` points its `<script>` there.
```

- [ ] **Step 4: Pack check — the new bundle ships**

Run: `npm run build` then `npm run pack:check`
Expected: the `npm pack --dry-run` tarball listing includes `dist/standalone/webview/app.js` (covered by the `dist/standalone/` entry in `package.json#files`).

- [ ] **Step 5: Full verification sweep**

Run the whole pipeline: `npm run test:all`
Expected: build, unit (`vitest run`), integration, e2e, and standalone playwright suites all PASS.

Then verify the additive-only invariant:

Run: `git diff upstream/main -- src/`
Expected: every changed path is under `src/standalone/` — specifically `src/standalone/v1-allowed.ts`, `src/standalone/standalone-constants.ts`, `src/standalone/standalone-html.ts`, `src/standalone/server.ts`, and `src/standalone/__tests__/*`. No upstream `src/` file outside `src/standalone/` is modified. (If `upstream/main` is unavailable as a ref, diff against baseline `abc0a6c`.)

- [ ] **Step 6: Commit**

```bash
git add docs-fork/STANDALONE-PARITY-GAPS.md README.md docs-fork/specs/07-build.md
git commit -m "docs(standalone): mark bucket A shipped + document the token override"
```

---

## Self-review notes (for the executor)

- **Spec coverage:** Allowlist (Task 1), nav injection (Task 2), standalone constants wrapper (Task 5), redirect plugin + second webview bundle (Task 6), server route (Task 7), script-path swap (Task 8), unit/snapshot updates (Tasks 1/2/8), integration (Tasks 3/9), smoke rewrite (Tasks 4/10), docs (Task 11), invariant verification (Tasks 4/11). The deferred `calibrateRule`/`runRuleTests` are explicitly asserted absent (Task 1). Graceful degradation of `compileNlRule`/`saveRule` is covered implicitly by the smoke's zero-console-error per-page check (they are only invoked on user action, not on page load).
- **Integration `{ ok: true }` nuance:** the design says the integration test asserts `{ ok: true }`. Because the CLI serves before parse completes, the test first awaits the `dataReady` frame (after which `cli.ts:121` `setData` has run), then asserts the gate is passed (`code !== 'standalone-v1-disabled'`) **and** the handler returned data (no `error` field). This is the deterministic form of "ok"; full rendering with seeded data is the smoke's job (the design's load-bearing end-to-end check).
- **Type consistency:** `resolveStandaloneWebviewRoot` (Task 7) is named identically in server.ts, its test, and 07-build.md. `makeConstantsRedirectPlugin` is named identically across its definition and both build sites. The injected page IDs `data-explorer`/`rule-playground` match `app.ts:649-650` and the nav `data-page` attributes.
- **Snapshot regenerates twice** (Task 2 end, Task 8 end) because both streams change the rendered HTML; each regen is from a known green state with an eyeballed diff. This is expected when executing one plan top-to-bottom (the design's "avoid double regen" warning was about parallel streams).

---

## EXECUTION STATUS — paused 2026-05-27 (session 2; resume here)

**Branch:** working directly on `main` (user opted out of a worktree).

### Committed (green)
- **Task 1** ✅ `942c0d2` — allowlist `getDataExplorer` + `evaluateExpression` (42). Test passes (5).
- **Task 2** ✅ `cb04841` — Transform 3 Explore nav injection + snapshot regen. Test passes (17).
- **Task 3** ✅ `a09172f` — integration test for the two new methods. Passes against the built CLI.
- **Task R** ✅ `cda8485` — warm-server dataReady race fix in `webview-shim.ts` (`forwardDataReady`/`deliverDataReady`, defer to `DOMContentLoaded` when `readyState==='loading'`). The previously-failing 24th shim test was fixed (removed the premature `vi.advanceTimersByTime(1)`). `webview-shim.test.ts` = **24 passed**.
- **Task 4** ✅ `1d43c39` — smoke NAV additions (`data-explorer`,`rule-playground`) + eval-REPL test. (At the time of commit the smoke was 15/15 green under FF=false bundle.)
- **Task 5** ✅ `6dd4e3f` — `standalone-constants.ts` wrapper (FF override target). Test passes (2).
- **Task 6** ✅ `18e4ca5` — esbuild `makeConstantsRedirectPlugin()` + second webview bundle `dist/standalone/webview/app.js` + plugin on CLI build + watch (`ctx6`). Build verified: standalone bundle has `FF_TOKEN_REPORTING_ENABLED = true`, shared bundle `= false` (grepped the built bundles directly — the Task-6-Step-5 file-hash check is weak because `sourcemap:true` vs `false` alone makes them differ).
- **Task 7** ✅ `0e16cb7` — `resolveStandaloneWebviewRoot()` + `/dist/standalone/webview` static route. server.test.ts = 19 passed.
- **Task 8** ✅ `3334486` — Transform 2 replacement → `/dist/standalone/webview/app.js`; FF mock added to `standalone-html.test.ts` (17 passed) + `standalone-html.snapshot.test.ts` (regenerated). Snapshot diff was EXACTLY the two expected changes (burndown `<li>` + script src).
- **Task 9** ✅ `aeff6c9` — integration proof the CLI bundle enables token reporting (`getBurndown`/`getTokenCoverage` not the disabled sentinel). Passes against the built CLI.

### In progress / NOT committed
- **Task 10** (rewrite smoke for FF=true): edits **done but uncommitted** in `tests/standalone/playwright/smoke.spec.ts`:
  - NAV comment rewritten for FF=true; `activeId` helper removed; `activeLink(id)` now uses `id` directly.
  - Added `output page shows the Token Usage tab` test and `burndown page renders end-to-end` test.
  - **Status:** 16/17 smoke tests pass. The **`burndown render` test PASSES** (proves the served standalone bundle is genuinely FF=true: burndown nav present, real data, no "temporarily disabled"). The **Output Token-Usage-tab test FAILS** — but see Task R2; it is a render race, NOT a wrong selector. **Do not commit Task 10 until the smoke is green.**

### ⛔ NEW BLOCKER — Task R2: warm-suite double-render race crashes `renderOutput`

**Symptom:** `output page shows the Token Usage tab` fails ONLY inside the full smoke suite (it is test #16, warm server). Run **alone** (`-g "Token Usage tab"`) it **PASSES**. So the FF=true bundle renders the `button[data-tab="token-usage"]` correctly; the suite-position is the variable.

**Root cause (fully diagnosed this session, evidence-based — not a guess):**
- The Output page hits the `withErrorBoundary('Output', …)` fallback ("⚠️ Failed to render Output") with message **`Cannot read properties of null (reading 'addEventListener')`**. Confirmed by reading the Playwright `error-context.md` DOM snapshot AND by temporarily instrumenting `shared.ts`' `showErrorFallback` to log the stack.
- Stack maps to **`page-output.ts:746`** → `document.getElementById('outputRange')!.addEventListener('click', …)` returning **null** (bundle `app.js:16520`, verified by `sed` on the built bundle). `#outputRange` is rendered synchronously at `page-output.ts:235`, then `renderOutput` `await`s `renderActiveTab()`→`getCodeProduction` at line **712**, then wires `#outputRange`/`#output-tabs` at lines **746/760**.
- **Mechanism — two concurrent async page renders clobber `main#content`.** Temporary `renderPage()` instrumentation in `app.ts` logged the exact sequence for the failing test:
  - `[nav] dashboard` @ t≈90ms — `onDataReady` (`app.ts:444 navigateTo(currentPage)`, default `currentPage='dashboard'`) starts `renderDashboard` (async, awaits RPCs).
  - `[nav] output` @ t≈94ms — the shim's `navFromHash` (`setTimeout(navFromHash,0)` in `forwardDataReady`) clicks `[data-page=output]` → `renderPage('output')` → `content.textContent=''` (`app.ts:629`), renders the Output tab-bar (`#outputRange` now present), then `await`s `getCodeProduction`.
  - The in-flight **`renderDashboard` RPC resolves DURING `renderOutput`'s await** and writes into the **same** `main#content`, wiping `#outputRange`.
  - `renderOutput` resumes at line 746 → `getElementById('outputRange')` is null → throws → boundary → no tab-bar → no token-usage button.
- This is the SAME class as Task R (shim drives navigation while app.js races) but a **different leg**: Task R fixed the *inbound* deliver-before-listener drop; R2 is the shim's "post `dataReady` (→ app renders default page) THEN `navFromHash` (→ deep-link page)" producing **two overlapping async renders** into one container. It is FF-independent in principle (FF=false Output also awaits `getCodeProduction`), but only surfaces now because (a) test #16 is warm enough for the RPC timings to align, and (b) the new token-tab test strictly requires a *successful* render (a crashed Output still satisfied the old NAV `#output` checks — see "blind spot" below).

**Constraint:** the crash site (`page-output.ts`, `app.ts`, `shared.ts`) is **upstream — NOT editable** (additive-only invariant: only `src/standalone/` may change). So the fix must live in **`src/standalone/webview-shim.ts`**: make the deep-link navigation the *sole/last* render so no in-flight default-page render clobbers it. Candidate directions (NOT yet implemented — pick after a quick check of `onDataReady`):
  1. **Suppress the wasteful default render**: have the shim navigate to the hash page such that app.ts's `onDataReady`→`navigateTo(currentPage)` already targets the deep-link page (e.g. drive `navFromHash` so `currentPage` is the hash page *before* `onDataReady` runs), yielding one page identity (still verify no double-render of that same page races — `renderPage` clears `content` then async-renders, so even same-page double nav has a small null window).
  2. **Serialize**: defer `navFromHash` until the default render has *settled* (not just `setTimeout 0`). The shim can't await app.ts's async render, so this needs a robust signal (e.g. observe `#content` stops mutating / loading-spinner gone) — fragile; prefer (1).
  3. Reconsider whether `forwardDataReady` should post `dataReady` at all before the hash is applied.
  Whatever the fix: add failing-first tests in `src/standalone/__tests__/webview-shim.test.ts` (simulate `onDataReady`→default-nav followed by `navFromHash`, assert only one surviving navigation / no clobber), then verify the full smoke goes 17/17. Suggested commit msg: `fix(standalone): single deep-link render on warm connect (renderOutput clobber race)`.

**`#output` NAV-test blind spot (worth a follow-up, low priority):** the per-page NAV loop asserts `main#content > * count > 0` + no console errors. A crashed render still satisfies BOTH (the error-boundary `<div>` is a child, and `shared.ts`' `showErrorFallback` does **not** `console.error`). So the NAV `#output` test silently passes on a crashed Output page. Consider asserting absence of `.error-boundary` in the NAV loop. (Out of plan; note only.)

### Debug instrumentation — REVERTED (verify clean before resuming)
This session temporarily instrumented `src/webview/render.ts`, `src/webview/shared.ts`, `src/webview/app.ts` (console logs) and `tests/standalone/playwright/smoke.spec.ts` (page-console capture to `.debug.log`). **All reverted.** Verified: `git diff --name-only -- src/ | grep -v '^src/standalone/'` is **empty** and `git diff --name-only abc0a6c -- src/ | grep -v '^src/standalone/'` is **empty** (invariant holds). The built `dist/standalone/webview/app.js` may still carry stale instrumentation — **`npm run build` before re-testing.**

### Resume checklist (in order)
1. Confirm clean tree: upstream `src/` diff empty (see above). `npm run build`.
2. **Fix Task R2** in `src/standalone/webview-shim.ts` (candidate (1) above). Add failing-first shim unit tests; `npx vitest run src/standalone/__tests__/webview-shim.test.ts` green.
3. `npm run build` → `npm run test:playwright:standalone` → expect **17/17** (read the summary line; `tail` masks exit code).
4. Commit Task R2 (own message), then commit **Task 10** (smoke rewrite) with `test(standalone): rewrite smoke for FF=true (burndown, Token Usage tab)`.
5. Do **Task 11** (docs + `pack:check` + `test:all` + final invariant). Use baseline `abc0a6c` for the invariant check, **not** `upstream/main` (drifted ~99 commits): `git diff --name-only abc0a6c -- src/ | grep -v '^src/standalone/'` must be empty.

### Working-tree / repo notes (leave alone)
- `tests/standalone/playwright/smoke.spec.ts` is the only uncommitted *code* change (Task 10 edits; debug already removed).
- `.claude/scheduled_tasks.lock` — untracked `ScheduleWakeup` artifact; ignore.
- Commit `9b9734e docs(plan): add bucket-D standalone-parity implementation plan` (top of log) is **not** from this execution and is unrelated (bucket D) — leave it.

### Pre-existing unrelated test failures (full `test:all` only; not introduced here)
`src/core/metric-engine.test.ts` and `src/core/parser-codex.test.ts` (64 s file-cap timeout) fail on a clean tree too — both upstream `src/core/`, outside this plan's scope. A `-u` snapshot run this session swept the whole suite and showed exactly these 2 failing (1142 passed); the standalone files this plan touches are all green.
```