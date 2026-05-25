# Standalone HTML Wrapper (03-standalone-html) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `src/standalone/standalone-html.ts`, exporting `renderStandaloneHtml(opts)` — it reuses the unmodified upstream `getDashboardHtml` (`panel-html.ts:10`) via a stub webview to produce the exact body `app.js` expects, then performs two assert-once string replacements that swap the VS Code CSP for the standalone CSP (+ a `coach-token` meta) and replace the nonce'd inline-bundle `<script>` with the external `/standalone-shim.js` + `/dist/webview/app.js`.

**Architecture:** One leaf module. `renderStandaloneHtml` validates the 64-hex token, calls `getDashboardHtml(stubWebview, {})` (the stub returns plain `/dist/webview/<file>` asset URLs and `'self'` for `cspSource`; the transitive `vscode.Uri.joinPath` call is satisfied by the standalone `vscode-stub`), then runs the markup through `replaceOnce(...)` twice. `replaceOnce` counts matches and **throws** unless exactly one is found, so an upstream `panel-html.ts` reformat becomes a loud build/test failure instead of a silently blank page. The function is pure: the only randomness in `getDashboardHtml` is a per-call `getNonce()`, and both transforms strip every place that nonce appears, so identical input yields byte-identical output.

**Tech Stack:** TypeScript (strict, ES2022 modules, `moduleResolution: bundler`), vitest (`vitest run`, node environment — the default). Tests parse output with `jsdom` (already a devDependency: `jsdom@29.1.1`) imported directly as a library, and use `vi.spyOn` on the `panel-html` namespace for the two drift-guard tests. No new runtime or dev dependencies. The reused upstream `panel-html` transitively pulls a top-level `import * as vscode` (`panel-html.ts:6` and `panel-shared.ts:7`), so this plan depends on the standalone `vscode-stub` + vitest `vscode` alias — bootstrapped idempotently in Task 1.

---

## Spec references

- Spec under implementation: `docs-fork/specs/03-standalone-html.md`
- Shared contract: `docs-fork/specs/00-overview.md` — relevant pieces:
  - **Security model / CSP** — the standalone CSP is
    `default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; font-src 'self'`.
    `script-src 'self'` (no nonce, no `'unsafe-inline'`) forbids an inline polyfill, so the
    shim is served as the **external** `/standalone-shim.js`; the `HttpOnly coach_token`
    cookie is unreadable from JS, so the WS token rides a `<meta name="coach-token">` tag.
  - **Shim delivery decision** — external `/standalone-shim.js` + `<meta name="coach-token">`,
    shim loaded **before** `app.js` so `acquireVsCodeApi` exists when the webview bundle evaluates.
  - **Feature flag `FF_TOKEN_REPORTING_ENABLED` (= `false`)** — the `burndown` nav entry is
    gated server-side at `panel-html.ts:34`, so it is **absent** from `getDashboardHtml`'s output;
    the wrapper inherits that for free (no nav surgery, no `nav-config.ts`).
  - **`vscode` import safety** — the alias `vscode` → `vscode-stub.ts` (standalone build + tests)
    resolves the transitive `import * as vscode` **and** supplies the `Uri.joinPath` the HTML path
    actively calls (`panel-html.ts:11`).
  - **Additive-only fork discipline** — every `+` line lives under `src/standalone/`. This spec
    creates two new files there. It also relies on the shared `vscode-stub.ts` + vitest `vscode`
    alias, which are **idempotent** shared foundations created at first use (Task 1 checks-and-skips).
  - **Style conventions** — vitest, kebab-case filenames under `src/standalone/`, named exports only,
    TS strict, comments only where the *why* is non-obvious.

### Dependency note — this is the 4th plan in the queue

Per `00-overview.md`'s dependency table, `03-standalone-html` **blocks** `01-server` (the server
serves the string this module returns from GET `/`) and depends on no earlier-planned spec's *code*.
The three already-planned specs (`06-state`, `02-dispatcher`, `04-webview-shim`) share **no importable
interface** with this module:

- `06-state.plan.md` — server-side `server-state.json`; irrelevant to HTML rendering.
- `02-dispatcher.plan.md` — its `dispatch`/`DispatchResult` types are host-internal; this module
  emits HTML, never dispatches. **But** `02-dispatcher` is the spec that first creates the shared
  `src/standalone/vscode-stub.ts` and the vitest `vscode` alias. Per topological execution order,
  02 runs before 03, so they will already exist; Task 1 below re-creates them idempotently
  (identical content) so this plan is also runnable in isolation.
- `04-webview-shim.plan.md` — produces `/standalone-shim.js` (referenced here only by **URL**, never
  imported) and locks the `coach-token` meta-tag contract this module must emit.

The contracts this plan **honors** from `04-webview-shim` (must stay byte-identical):
- The shim reads its token from `<meta name="coach-token" content="<64-hex>">` — this module emits
  exactly that tag (`tokenMeta`).
- The shim is served at `/standalone-shim.js` — this module injects exactly that `src`.

The contracts this plan **locks in** for `01-server` to honor:
- GET `/` serves `renderStandaloneHtml({ token, appVersion })` verbatim.
- The page links `/dist/webview/styles.css` and `/dist/webview/app.js` and `/standalone-shim.js` —
  `01-server` must mount routes that serve all three.

Keep these strings (`coach-token`, `/standalone-shim.js`, `/dist/webview/app.js`,
`/dist/webview/styles.css`) identical to the already-written plans.

### One deliberate deviation from the spec's code sketch

The spec's `replaceOnce` (line 109) is described as a string replacement. This plan implements the
final replacement with the **function form** `html.replace(pattern, () => replacement)` instead of
`html.replace(pattern, replacement)`. Rationale: a string replacement interprets `$`-sequences
(`$&`, `$1`, `$$`) inside the replacement. Our replacements are static and `$`-free and the token is
validated hex, so the two forms are behaviorally identical here — but the function form is immune to
that footgun if a future replacement ever contains a `$`. This is the only change to the sketch; the
match-counting / throw behavior is exactly as specified.

## File Structure

| Path | Responsibility | Created/edited by |
|------|----------------|-------------------|
| `src/standalone/vscode-stub.ts` | Stub the `vscode` namespace the alias resolves to (supplies `Uri.joinPath`). **Identical** content to `02-dispatcher`/`07-build`. | Task 1 (idempotent — skip if present) |
| `vitest.config.mts` | Add top-level `resolve.alias` mapping `vscode` → the stub. **Identical** to `02-dispatcher`/`08-testing`. | Task 1 (idempotent — skip if present) |
| `src/standalone/standalone-html.ts` | `HtmlOptions` + `renderStandaloneHtml(opts)`; internal `basename`, `replaceOnce`, `STANDALONE_CSP_META`, `tokenMeta`. | Task 2 (grown through Task 4) |
| `src/standalone/__tests__/standalone-html.test.ts` | Output structure, CSP swap, body-preservation, drift-guard, determinism, well-formedness tests. | Task 2 (grown through Task 5) |

`src/standalone/` already exists from the earlier plans (or is created implicitly by the first new
file path here). The test path matches the existing vitest `include: ['src/**/*.test.ts']`
(`vitest.config.mts:10`), so **no `include` change is needed**.

### Task order

```
Task 1  prerequisites: vscode-stub.ts + vitest vscode alias   (idempotent; unblocks importing getDashboardHtml)
Task 2  standalone-html.ts: validation + stub-webview reuse (no transforms)   (body/token/styles/burndown tests)
Task 3  add replaceOnce + Transform 1 (CSP swap + coach-token meta)           (CSP/meta/drift-guard tests)
Task 4  add Transform 2 (external shim + app.js, no nonce)                    (script/order/no-inline/drift-guard tests)
Task 5  well-formedness + determinism                                          (jsdom parse + pure-function tests)
Task 6  full suite + tsc + additive-only verification
```

## Conventions to copy (already in the repo)

- vitest imports come from `'vitest'`:
  `import { afterEach, describe, expect, it, vi } from 'vitest';`
- Single test file run: `npx vitest run <path>`; full suite: `npm test` (`npm test` is
  `vitest run`, see `package.json:86`).
- Strict TS, named exports only, kebab-case filenames under `src/standalone/`, comments only where
  the *why* is non-obvious (the specs carry the rationale).
- `package.json` declares `vscode: ^1.118.0` under **`engines`** (the editor version floor) and
  `@types/vscode` under `devDependencies`; there is **no runtime `vscode` package**. tsc resolves the
  `import * as vscode` type via `@types/vscode`; the vitest `resolve.alias` resolves it at **runtime**
  to the stub. The two are independent — tsc passing and vitest resolving are both satisfied.

### Preconditions

If `node_modules/` is empty in your checkout, run `npm install` once before starting (the project's
existing devDeps — vitest, jsdom, `@types/vscode` — must be present). The plan assumes the baseline
upstream suite is green (`npm test` passes) before any changes; a pre-existing red suite is an
escalation, not something this plan introduces.

---

## Task 1: Prerequisites — `vscode` stub + vitest alias (idempotent)

`renderStandaloneHtml` imports `getDashboardHtml` from `../webview/panel-html`, which has a top-level
`import * as vscode` (`panel-html.ts:6`) and **actively calls** `vscode.Uri.joinPath`
(`panel-html.ts:11-12`). There is no runtime `vscode` package, so the test cannot even load the module
without the alias. This task front-loads the two shared foundations. They are **identical** to the
ones created by `02-dispatcher` (Task 1) and `07-build`/`08-testing`; per the dependency order
`02-dispatcher` runs first, so in a normal end-to-end run **both already exist and this task is a
no-op** (check-and-skip). Creating them here keeps this plan runnable in isolation.

**Files:**
- Create (if absent): `src/standalone/vscode-stub.ts`
- Modify (if alias absent): `vitest.config.mts`

- [ ] **Step 1: Ensure the `vscode` stub exists with the exact shared content**

If `src/standalone/vscode-stub.ts` already exists, open it and confirm it matches the content below
**verbatim** (it should, from `02-dispatcher`). If it does not exist, create it with exactly this:

```ts
// src/standalone/vscode-stub.ts
// Resolves the transitive `import * as vscode` pulled in by reused webview
// files — panel-shared.ts:7 (via getRpcHandler) — AND satisfies the one live
// call on the standalone path: getDashboardHtml -> vscode.Uri.joinPath
// (panel-html.ts:11), used by 03-standalone-html.
export const Uri = {
  joinPath: (_base: unknown, ...parts: string[]) => ({
    path: parts.join('/'),
    fsPath: parts.join('/'),
  }),
};
export default { Uri };
```

- [ ] **Step 2: Ensure the vitest config has the `vscode` alias**

Open `vitest.config.mts`. If it already has a top-level `resolve.alias` mapping `vscode` to the stub
(from `02-dispatcher`), leave it unchanged. If it does **not**, add the `node:url` import at the top
and a top-level `resolve` block (a **sibling** of `test`, not inside it). The full file after the edit:

```ts
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/webview/**',
        'src/extension.ts',
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 60,
        statements: 70,
      },
      reporter: ['text', 'text-summary'],
    },
  },
  resolve: {
    // Reused upstream webview modules pull a top-level `import * as vscode`
    // (panel-html.ts:6, panel-shared.ts:7). Map it to the standalone stub so tests
    // importing the real panel-html/panel-rpc resolve. Mirrors the esbuild alias in 07-build.
    alias: {
      vscode: fileURLToPath(new URL('./src/standalone/vscode-stub.ts', import.meta.url)),
    },
  },
});
```

- [ ] **Step 3: Verify the alias resolves the real webview modules**

Run: `npx vitest run src/webview/panel-rpc.test.ts src/webview/panel-shared.test.ts`
Expected: PASS. These existing upstream tests import the real `panel-rpc`/`panel-shared` (which import
`vscode`); with the alias resolving `vscode` → stub they stay green. A `Cannot find module 'vscode'`
failure means the alias path in Step 2 is wrong (it must resolve relative to the repo root).

- [ ] **Step 4: Commit (only if Step 1 or 2 created/changed a file)**

If both artifacts already existed from `02-dispatcher`, there is nothing to commit — skip. Otherwise:

```bash
git add src/standalone/vscode-stub.ts vitest.config.mts
git commit -m "build(standalone): ensure vscode stub and vitest alias present for html wrapper"
```

---

## Task 2: `standalone-html.ts` — token validation + stub-webview reuse (no transforms yet)

Creates the module with `HtmlOptions`, `basename`, and a `renderStandaloneHtml` that validates the
token and returns the **raw** `getDashboardHtml` output through a stub webview. At this stage the
output is byte-identical to upstream (VS Code CSP + single nonce'd script still present) — the
transforms land in Tasks 3 and 4. Covers spec test rows
`keeps the real body (#content, #sidebar, filters)`, `links upstream styles.css`,
`throws on bad token`, `omits burndown nav while flag is false`, and spec acceptance #3, #4, #6, #8.

**Files:**
- Create: `src/standalone/standalone-html.ts`
- Create: `src/standalone/__tests__/standalone-html.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/standalone/__tests__/standalone-html.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { renderStandaloneHtml } from '../standalone-html';

const TOKEN = 'a'.repeat(64); // 64 hex chars

describe('renderStandaloneHtml — token validation', () => {
  it('throws on a non-hex / wrong-length token', () => {
    expect(() => renderStandaloneHtml({ token: 'bad', appVersion: '0.1.0' })).toThrow(
      /64-char hex/,
    );
    expect(() => renderStandaloneHtml({ token: 'A'.repeat(64), appVersion: '0.1.0' })).toThrow(
      /64-char hex/,
    ); // uppercase is not [0-9a-f]
  });
});

describe('renderStandaloneHtml — preserves the upstream body', () => {
  const html = renderStandaloneHtml({ token: TOKEN, appVersion: '0.1.0' });

  it('starts with the doctype', () => {
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
  });

  it('keeps the real DOM app.js targets', () => {
    expect(html).toContain('<main id="content">');
    expect(html).toContain('<nav id="sidebar">');
    expect(html).toContain('id="ws-filter"');
    expect(html).toContain('id="harness-filter"');
  });

  it('links the upstream styles.css via the stub asWebviewUri', () => {
    expect(html).toContain('href="/dist/webview/styles.css"');
  });

  it('omits the burndown nav while FF_TOKEN_REPORTING_ENABLED is false', () => {
    expect(html).not.toContain('data-page="burndown"');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/standalone/__tests__/standalone-html.test.ts`
Expected: FAIL — `Failed to resolve import "../standalone-html"` (the source file does not exist yet).
(If you instead see `Cannot find module 'vscode'`, Task 1's alias is not in effect — fix that first.)

- [ ] **Step 3: Write minimal implementation**

Create `src/standalone/standalone-html.ts` with token validation and the raw reuse only (transforms
added in Tasks 3–4):

```ts
// src/standalone/standalone-html.ts
// Wraps the unmodified upstream getDashboardHtml (panel-html.ts) for a plain
// browser. See docs-fork/specs/03-standalone-html.md. Transforms (CSP swap +
// external shim) are layered on in later tasks.
import { getDashboardHtml } from '../webview/panel-html'; // pulls panel-shared -> vscode (aliased to the stub)

export interface HtmlOptions {
  token: string; // 64-char hex; goes into the coach-token meta tag
  appVersion: string; // reserved for footer / about; not load-bearing in v1
}

function basename(p: string): string {
  return p.split('/').pop() ?? p;
}

export function renderStandaloneHtml(opts: HtmlOptions): string {
  if (!/^[0-9a-f]{64}$/.test(opts.token)) {
    throw new Error('renderStandaloneHtml: token must be 64-char hex');
  }

  // Stub webview: asWebviewUri -> /dist/webview/<file>; cspSource -> 'self'.
  // vscode.Uri.joinPath (called inside getDashboardHtml) is provided by the
  // vscode-stub and returns { path, fsPath } whose trailing segment we keep.
  const stubWebview = {
    asWebviewUri: (u: { path?: string; fsPath?: string }) =>
      `/dist/webview/${basename(u.path ?? u.fsPath ?? String(u))}`,
    cspSource: "'self'",
  };

  return getDashboardHtml(stubWebview as never, {} as never);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/standalone/__tests__/standalone-html.test.ts`
Expected: PASS — 5 tests passed (1 token-validation + 4 body-preservation).

- [ ] **Step 5: Commit**

```bash
git add src/standalone/standalone-html.ts src/standalone/__tests__/standalone-html.test.ts
git commit -m "feat(standalone): render standalone html by reusing getDashboardHtml via stub webview"
```

---

## Task 3: Transform 1 — swap the CSP meta + inject the `coach-token` meta

Adds the `replaceOnce` assert-once helper, the `STANDALONE_CSP_META`/`tokenMeta` constants, and
Transform 1: replace the VS Code CSP `<meta>` with the standalone CSP and inject the `coach-token`
meta immediately after it. Covers spec test rows `swaps in the standalone CSP, drops VS Code CSP`,
`emits coach-token meta tag`, `throws if CSP anchor missing (drift guard)`, and spec acceptance #2, #5, #7.

**Files:**
- Modify: `src/standalone/standalone-html.ts`
- Modify: `src/standalone/__tests__/standalone-html.test.ts`

- [ ] **Step 1: Write the failing tests**

First, extend the import line at the top of `src/standalone/__tests__/standalone-html.test.ts` to add
`vi` and a namespace import of `panel-html` (used by the drift-guard test). The import block becomes:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as panelHtml from '../../webview/panel-html';
import { renderStandaloneHtml } from '../standalone-html';
```

Then append these blocks to the file:

```ts
afterEach(() => {
  vi.restoreAllMocks(); // restores the getDashboardHtml spy used by drift-guard tests
});

describe('renderStandaloneHtml — Transform 1: CSP + coach-token meta', () => {
  const html = renderStandaloneHtml({ token: TOKEN, appVersion: '0.1.0' });

  it('swaps in the standalone CSP and drops the VS Code CSP', () => {
    expect(html).toContain(
      "default-src 'self'; style-src 'self' 'unsafe-inline'; " +
        "script-src 'self'; img-src 'self' data:; font-src 'self'",
    );
    expect(html).not.toContain("default-src 'none'");
    expect(html).not.toContain('require-trusted-types-for');
    expect(html).not.toContain('nonce-'); // the CSP's 'nonce-<n>' source is gone
  });

  it('emits the coach-token meta tag with the token', () => {
    expect(html).toContain(`<meta name="coach-token" content="${TOKEN}">`);
  });

  it('throws if the CSP-meta anchor is missing (drift guard)', () => {
    // Feed a getDashboardHtml output with no Content-Security-Policy meta.
    vi.spyOn(panelHtml, 'getDashboardHtml').mockReturnValue(
      '<!DOCTYPE html><html><head><title>x</title></head><body></body></html>',
    );
    expect(() => renderStandaloneHtml({ token: TOKEN, appVersion: '0.1.0' })).toThrow(
      /expected exactly one CSP meta tag, found 0/,
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/standalone/__tests__/standalone-html.test.ts`
Expected: FAIL — the `swaps in the standalone CSP …` test fails because the raw output still contains
`default-src 'none'` (no Transform 1 yet); `emits the coach-token meta tag …` fails (no token meta);
`throws if the CSP-meta anchor is missing …` fails (no `replaceOnce` guard yet — the function returns
the spy's output unchanged instead of throwing). The 5 Task-2 tests still pass.

- [ ] **Step 3: Write minimal implementation**

Replace the full contents of `src/standalone/standalone-html.ts` with the version below — it adds the
constants, `replaceOnce`, and Transform 1 (Transform 2 still to come in Task 4):

```ts
// src/standalone/standalone-html.ts
// Wraps the unmodified upstream getDashboardHtml (panel-html.ts) for a plain
// browser: swaps the VS Code CSP for the standalone CSP and injects the
// coach-token meta. See docs-fork/specs/03-standalone-html.md.
import { getDashboardHtml } from '../webview/panel-html'; // pulls panel-shared -> vscode (aliased to the stub)

export interface HtmlOptions {
  token: string; // 64-char hex; goes into the coach-token meta tag
  appVersion: string; // reserved for footer / about; not load-bearing in v1
}

const STANDALONE_CSP_META =
  `<meta http-equiv="Content-Security-Policy" ` +
  `content="default-src 'self'; style-src 'self' 'unsafe-inline'; ` +
  `script-src 'self'; img-src 'self' data:; font-src 'self'">`;

const tokenMeta = (token: string): string =>
  `<meta name="coach-token" content="${token}">`;

function basename(p: string): string {
  return p.split('/').pop() ?? p;
}

// Replace exactly one occurrence of `pattern`, or throw. Converts an upstream
// panel-html.ts reformat into a build/test failure instead of a half-transformed,
// silently-blank page. Function-form replacement avoids `$`-sequence interpretation.
function replaceOnce(html: string, pattern: RegExp, replacement: string, label: string): string {
  const count = (html.match(new RegExp(pattern, 'g')) ?? []).length;
  if (count !== 1) {
    throw new Error(`coach: expected exactly one ${label}, found ${count}`);
  }
  return html.replace(pattern, () => replacement);
}

export function renderStandaloneHtml(opts: HtmlOptions): string {
  if (!/^[0-9a-f]{64}$/.test(opts.token)) {
    throw new Error('renderStandaloneHtml: token must be 64-char hex');
  }

  // Stub webview: asWebviewUri -> /dist/webview/<file>; cspSource -> 'self'.
  // vscode.Uri.joinPath (called inside getDashboardHtml) is provided by the
  // vscode-stub and returns { path, fsPath } whose trailing segment we keep.
  const stubWebview = {
    asWebviewUri: (u: { path?: string; fsPath?: string }) =>
      `/dist/webview/${basename(u.path ?? u.fsPath ?? String(u))}`,
    cspSource: "'self'",
  };

  let html = getDashboardHtml(stubWebview as never, {} as never);

  // Transform 1: replace the VS Code CSP <meta> with the standalone CSP, and inject
  // the coach-token meta immediately after it. (The CSP content has no '>' char, so
  // [^>]* stops at the tag's closing '>'.)
  html = replaceOnce(
    html,
    /<meta http-equiv="Content-Security-Policy"[^>]*>/,
    `${STANDALONE_CSP_META}\n${tokenMeta(opts.token)}`,
    'CSP meta tag',
  );

  return html;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/standalone/__tests__/standalone-html.test.ts`
Expected: PASS — 8 tests passed (5 + 3). The drift-guard test relies on vitest's live-binding spy
support: `vi.spyOn(panelHtml, 'getDashboardHtml')` replaces the export on the shared module namespace,
and `renderStandaloneHtml` (which imported it by name) calls through that live binding, so it sees the
fake output and `replaceOnce` throws.

- [ ] **Step 5: Commit**

```bash
git add src/standalone/standalone-html.ts src/standalone/__tests__/standalone-html.test.ts
git commit -m "feat(standalone): swap VS Code CSP for standalone CSP and inject coach-token meta"
```

---

## Task 4: Transform 2 — external shim + app.js (drop the nonce'd inline-bundle script)

Adds Transform 2: replace the single nonce'd `app.js` `<script>` with two external, nonce-free
scripts — `/standalone-shim.js` then `/dist/webview/app.js`, in that document order. Covers spec test
rows `loads external shim before app.js`, `contains no inline script`,
`throws if app.js script anchor missing (drift guard)`, and spec acceptance #1, #7.

**Files:**
- Modify: `src/standalone/standalone-html.ts`
- Modify: `src/standalone/__tests__/standalone-html.test.ts`

- [ ] **Step 1: Write the failing tests**

Add a `jsdom` import to the top of `src/standalone/__tests__/standalone-html.test.ts` (used to
enumerate `<script>` elements). The import block becomes:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import * as panelHtml from '../../webview/panel-html';
import { renderStandaloneHtml } from '../standalone-html';
```

Then append this block:

```ts
describe('renderStandaloneHtml — Transform 2: external scripts', () => {
  const html = renderStandaloneHtml({ token: TOKEN, appVersion: '0.1.0' });

  it('loads the external shim before app.js', () => {
    const shimAt = html.indexOf('<script src="/standalone-shim.js">');
    const appAt = html.indexOf('<script src="/dist/webview/app.js">');
    expect(shimAt).toBeGreaterThan(-1);
    expect(appAt).toBeGreaterThan(-1);
    expect(shimAt).toBeLessThan(appAt);
  });

  it('contains exactly two scripts, both external, none inline', () => {
    const scripts = [...new JSDOM(html).window.document.querySelectorAll('script')];
    expect(scripts).toHaveLength(2);
    expect(scripts.every((s) => s.hasAttribute('src'))).toBe(true);
    expect(scripts.map((s) => s.getAttribute('src'))).toEqual([
      '/standalone-shim.js',
      '/dist/webview/app.js',
    ]);
  });

  it('throws if the app.js script anchor is missing (drift guard)', () => {
    // Has a CSP meta (Transform 1 passes) but no nonce'd app.js <script>.
    vi.spyOn(panelHtml, 'getDashboardHtml').mockReturnValue(
      '<!DOCTYPE html><html><head>' +
        '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'">' +
        '</head><body><main id="content"></main></body></html>',
    );
    expect(() => renderStandaloneHtml({ token: TOKEN, appVersion: '0.1.0' })).toThrow(
      /expected exactly one app\.js script tag, found 0/,
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/standalone/__tests__/standalone-html.test.ts`
Expected: FAIL — `loads the external shim before app.js` fails (no `/standalone-shim.js` yet);
`contains exactly two scripts …` fails (the raw output has one nonce'd `<script>`, and it lacks
`src` after… in fact it still has the upstream single script, so length is 1);
`throws if the app.js script anchor is missing …` fails (no Transform 2 guard yet — the function
returns after Transform 1 without inspecting the app.js anchor). The 8 earlier tests still pass.

- [ ] **Step 3: Write minimal implementation**

Replace the full contents of `src/standalone/standalone-html.ts` with the final version below — it
adds Transform 2 after Transform 1:

```ts
// src/standalone/standalone-html.ts
// Wraps the unmodified upstream getDashboardHtml (panel-html.ts) for a plain
// browser: swaps the VS Code CSP for the standalone CSP, injects the coach-token
// meta, and replaces the nonce'd inline-bundle <script> with the external shim +
// app.js. Two assert-once replacements turn upstream markup drift into a loud
// failure instead of a silently blank page. See docs-fork/specs/03-standalone-html.md.
import { getDashboardHtml } from '../webview/panel-html'; // pulls panel-shared -> vscode (aliased to the stub)

export interface HtmlOptions {
  token: string; // 64-char hex; goes into the coach-token meta tag
  appVersion: string; // reserved for footer / about; not load-bearing in v1
}

const STANDALONE_CSP_META =
  `<meta http-equiv="Content-Security-Policy" ` +
  `content="default-src 'self'; style-src 'self' 'unsafe-inline'; ` +
  `script-src 'self'; img-src 'self' data:; font-src 'self'">`;

const tokenMeta = (token: string): string =>
  `<meta name="coach-token" content="${token}">`;

function basename(p: string): string {
  return p.split('/').pop() ?? p;
}

// Replace exactly one occurrence of `pattern`, or throw. Converts an upstream
// panel-html.ts reformat into a build/test failure instead of a half-transformed,
// silently-blank page. Function-form replacement avoids `$`-sequence interpretation.
function replaceOnce(html: string, pattern: RegExp, replacement: string, label: string): string {
  const count = (html.match(new RegExp(pattern, 'g')) ?? []).length;
  if (count !== 1) {
    throw new Error(`coach: expected exactly one ${label}, found ${count}`);
  }
  return html.replace(pattern, () => replacement);
}

export function renderStandaloneHtml(opts: HtmlOptions): string {
  if (!/^[0-9a-f]{64}$/.test(opts.token)) {
    throw new Error('renderStandaloneHtml: token must be 64-char hex');
  }

  // Stub webview: asWebviewUri -> /dist/webview/<file>; cspSource -> 'self'.
  // vscode.Uri.joinPath (called inside getDashboardHtml) is provided by the
  // vscode-stub and returns { path, fsPath } whose trailing segment we keep.
  const stubWebview = {
    asWebviewUri: (u: { path?: string; fsPath?: string }) =>
      `/dist/webview/${basename(u.path ?? u.fsPath ?? String(u))}`,
    cspSource: "'self'",
  };

  let html = getDashboardHtml(stubWebview as never, {} as never);

  // Transform 1: replace the VS Code CSP <meta> with the standalone CSP, and inject
  // the coach-token meta immediately after it. (The CSP content has no '>' char, so
  // [^>]* stops at the tag's closing '>'.)
  html = replaceOnce(
    html,
    /<meta http-equiv="Content-Security-Policy"[^>]*>/,
    `${STANDALONE_CSP_META}\n${tokenMeta(opts.token)}`,
    'CSP meta tag',
  );

  // Transform 2: replace the nonce'd app.js <script> with the external shim + app.js,
  // both nonce-free. Document order guarantees the shim defines acquireVsCodeApi
  // before app.js evaluates. No defer/async.
  html = replaceOnce(
    html,
    /<script nonce="[^"]*" src="\/dist\/webview\/app\.js"><\/script>/,
    `<script src="/standalone-shim.js"></script>\n<script src="/dist/webview/app.js"></script>`,
    'app.js script tag',
  );

  return html;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/standalone/__tests__/standalone-html.test.ts`
Expected: PASS — 11 tests passed (8 + 3).

- [ ] **Step 5: Commit**

```bash
git add src/standalone/standalone-html.ts src/standalone/__tests__/standalone-html.test.ts
git commit -m "feat(standalone): replace nonce'd bundle script with external shim + app.js"
```

---

## Task 5: Well-formedness + determinism

Pins two whole-output properties: the result parses as a well-formed HTML document (real structure,
not a string that merely contains substrings), and `renderStandaloneHtml` is a pure function (the
per-call `getNonce()` is stripped by both transforms, so identical input yields identical output).
Covers spec test rows `renders well-formed HTML` and `same input is deterministic`.

**Files:**
- Modify: `src/standalone/__tests__/standalone-html.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/standalone/__tests__/standalone-html.test.ts` (the `JSDOM` import is already present
from Task 4):

```ts
describe('renderStandaloneHtml — whole-output properties', () => {
  it('renders a well-formed HTML document', () => {
    const html = renderStandaloneHtml({ token: TOKEN, appVersion: '0.1.0' });
    const doc = new JSDOM(html).window.document;
    expect(doc.doctype?.name).toBe('html');
    expect(doc.documentElement.tagName).toBe('HTML');
    expect(doc.head).not.toBeNull();
    expect(doc.body).not.toBeNull();
    // Structural sanity: the body parsed into the nodes app.js targets.
    expect(doc.querySelector('main#content')).not.toBeNull();
    expect(doc.querySelector('nav#sidebar')).not.toBeNull();
  });

  it('is deterministic for the same input (the nonce never survives)', () => {
    const a = renderStandaloneHtml({ token: TOKEN, appVersion: '0.1.0' });
    const b = renderStandaloneHtml({ token: TOKEN, appVersion: '0.1.0' });
    expect(a).toBe(b);
    expect(a).not.toContain('nonce'); // both nonce sites (CSP + script) were stripped
  });
});
```

- [ ] **Step 2: Run the tests to verify they pass immediately (no source change)**

Run: `npx vitest run src/standalone/__tests__/standalone-html.test.ts`
Expected: PASS — 13 tests passed (11 + 2). Unlike Tasks 2–4 these assert properties the **finished**
function already satisfies, so they pass without an implementation step. If
`is deterministic …` fails, a nonce leaked through a transform — re-check that both `replaceOnce`
patterns matched (Task 6's full suite would also catch it). This is a regression pin, not new behavior.

> Note: this is the one task without a red→green source edit — the behavior was completed in Task 4.
> The tests are still written test-first relative to Task 4's commit; they lock the contract so a
> future change that reintroduces nonleterminism (e.g. an `appVersion` interpolated into the body)
> turns red here.

- [ ] **Step 3: Commit**

```bash
git add src/standalone/__tests__/standalone-html.test.ts
git commit -m "test(standalone): pin standalone html well-formedness and determinism"
```

---

## Task 6: Full-suite run, type-check, and additive-only verification

Confirms the new module passes the whole project runner, type-checks under strict, and respects the
fork's additive-only discipline (`00-overview.md` → "Additive-only fork discipline"; global
acceptance #11).

**Files:** none (verification only).

- [ ] **Step 1: Run the full vitest suite**

Run: `npm test`
Expected: PASS — the whole suite is green, including the 13 new
`src/standalone/__tests__/standalone-html.test.ts` cases. No pre-existing suite regresses under the
`vscode` alias (the alias is a superset of prior behavior). If a pre-existing test now fails, stop and
investigate.

- [ ] **Step 2: TypeScript strict check**

Run: `npx tsc --noEmit`
Expected: no errors. Confirms the `stubWebview as never` / `{} as never` casts, the
`u: { path?: string; fsPath?: string }` parameter type, and the `RegExp`/`match` usage in
`replaceOnce` all hold under the repo's strict config. (`standalone-html.ts` imports no `vscode`
itself; `panel-html.ts`'s `import * as vscode` type-checks via `@types/vscode`.)

- [ ] **Step 3: Verify additive-only fork discipline (src/)**

Run: `git diff upstream/main -- src/ | grep -E '^[-+]' | grep -vE '^[-+]{3}'`
Expected: every line is an addition (`+`) inside `src/standalone/`. The only new `src/` files from
this spec are `standalone-html.ts` and `__tests__/standalone-html.test.ts` (plus `vscode-stub.ts` if
this plan created it rather than `02-dispatcher`). No deletions and no edits outside `src/standalone/`.
(If `upstream/main` is not fetched: `git fetch upstream`. The `upstream` remote is
`https://github.com/microsoft/AI-Engineering-Coach.git`.)

- [ ] **Step 4: Verify the only shared-file edit is the additive vitest alias**

Run: `git diff upstream/main -- vitest.config.mts package.json esbuild.mjs`
Expected: `vitest.config.mts` shows **additions only** — the `node:url` import and the `resolve.alias`
block (shared with `02-dispatcher`; if `02-dispatcher` already added it, this spec shows no further
change). `package.json` and `esbuild.mjs` are **untouched** by this spec — `03-standalone-html` adds
no dependency, and the esbuild browser entry / served routes belong to `07-build` and `01-server`.

- [ ] **Step 5: Confirm `standalone-html.ts` has no direct `vscode` import**

Run: `grep -rn "vscode" src/standalone/standalone-html.ts src/standalone/__tests__/standalone-html.test.ts`
Expected: no matches. The `vscode` pull is purely transitive (via `panel-html`); this module's source
never imports it directly. (The test's `panelHtml` namespace import is `panel-html`, not `vscode`.)

- [ ] **Step 6: Final commit (only if Steps 1–5 required a fix)**

If Steps 1–5 surfaced nothing, there is nothing to commit. If a fix was needed:

```bash
git add src/standalone/ vitest.config.mts
git commit -m "test(standalone): verify standalone html passes full suite and additive checks"
```

---

## Acceptance criteria mapping (self-review)

Every acceptance criterion in `docs-fork/specs/03-standalone-html.md` maps to a task/test:

| Spec acceptance criterion | Task | Test |
|---------------------------|------|------|
| 1. Returns string starting `<!DOCTYPE html>`, exactly two `<script>`, both `src`, no inline | Tasks 2 & 4 | `starts with the doctype`; `contains exactly two scripts, both external, none inline` |
| 2. Contains standalone CSP; no `default-src 'none'` / `nonce-` / `require-trusted-types-for` | Task 3 | `swaps in the standalone CSP and drops the VS Code CSP` |
| 3. Contains `href="/dist/webview/styles.css"` | Task 2 | `links the upstream styles.css via the stub asWebviewUri` |
| 4. Preserves real body: `<main id="content">`, `<nav id="sidebar">`, `id="ws-filter"`, `id="harness-filter"` | Task 2 | `keeps the real DOM app.js targets` |
| 5. Contains `<meta name="coach-token" content="<token>">`; shim before app.js | Tasks 3 & 4 | `emits the coach-token meta tag with the token`; `loads the external shim before app.js` |
| 6. Bad token (`'bad'`) throws | Task 2 | `throws on a non-hex / wrong-length token` |
| 7. Drift guard: missing CSP anchor OR app.js anchor → throws `expected exactly one …` | Tasks 3 & 4 | `throws if the CSP-meta anchor is missing (drift guard)`; `throws if the app.js script anchor is missing (drift guard)` |
| 8. `burndown` nav absent while `FF_TOKEN_REPORTING_ENABLED` is `false` | Task 2 | `omits the burndown nav while FF_TOKEN_REPORTING_ENABLED is false` |

Spec **test-plan** coverage — all 12 named rows are present:
`renders well-formed HTML` (Task 5),
`swaps in the standalone CSP, drops VS Code CSP` (Task 3),
`keeps the real body (#content, #sidebar, filters)` (Task 2),
`links upstream styles.css` (Task 2),
`emits coach-token meta tag` (Task 3),
`loads external shim before app.js` (Task 4),
`contains no inline script` (Task 4 — `contains exactly two scripts, both external, none inline`),
`throws on bad token` (Task 2),
`throws if CSP anchor missing (drift guard)` (Task 3),
`throws if app.js script anchor missing (drift guard)` (Task 4),
`omits burndown nav while flag is false` (Task 2),
`same input is deterministic` (Task 5).

One **extra** assertion beyond the spec's 12, pinning a contract: the uppercase-token branch in
`throws on a non-hex / wrong-length token` (Task 2) confirms the regex is `[0-9a-f]` (lowercase),
matching the 64-hex token format the server generates.

**Type-consistency check:** `renderStandaloneHtml` and `HtmlOptions` are the module's only exports,
spelled identically in source and tests. The string contracts — `coach-token` (meta name),
`/standalone-shim.js`, `/dist/webview/app.js`, `/dist/webview/styles.css` — match the already-written
`04-webview-shim.plan.md` exactly (the shim reads `coach-token` and is served at `/standalone-shim.js`).
The `replaceOnce` error format `coach: expected exactly one <label>, found N` matches the spec, with
labels `CSP meta tag` and `app.js script tag` used consistently in source and asserted in tests.
`vscode-stub.ts`'s content and the vitest `resolve.alias` are byte-identical to `02-dispatcher.plan.md`
(idempotent).

**Placeholder scan:** no TBD/TODO/"handle edge cases"/"similar to" — every code step shows complete,
compilable code (the full `renderStandaloneHtml` is re-shown at each task that changes it, so a worker
reading tasks out of order never sees a partial function); every run step shows the exact command and
expected pass/fail output.

**Deviations from the spec text, all intentional and noted inline:**
- `replaceOnce` uses the **function-form** replacement (`html.replace(pattern, () => replacement)`)
  rather than the sketch's string form, to be immune to `$`-sequence interpretation. Behavior is
  identical for our static, `$`-free replacements. (See "One deliberate deviation" above.)
- Task 1 re-creates the shared `vscode-stub.ts` + vitest alias **idempotently** (check-and-skip),
  because this plan can run in isolation; in the normal topological order `02-dispatcher` already
  created them and Task 1 is a no-op. This matches `00-overview.md`'s "treat their creation as
  idempotent" rule.
- Drift-guard tests use `vi.spyOn(panelHtml, 'getDashboardHtml')` (vitest live-binding spy) to "feed a
  fake getDashboardHtml output", per the spec's stated test intent.
- Task 5 has no red→green source edit because the behavior completed in Task 4; its tests are
  regression pins for well-formedness/determinism (called out explicitly in the task).
