# 03 — Standalone HTML wrapper

The HTML page returned by GET `/` in [01-server](01-server.md). It does
**not** hand-write a page skeleton. It **reuses the upstream
`getDashboardHtml`** (`panel-html.ts:10`) to produce the exact body the
webview bundle expects — sidebar, workspace/harness filters, badges, and
`<main id="content">` — then rewrites only the VS Code-specific head and
script tags for a plain browser: standalone CSP, external
[04-webview-shim](04-webview-shim.md), and the auth token in a `<meta>` tag.

## Why reuse, not re-author

`app.js` renders into `#content` (`app.ts:624`) and wires up a specific DOM:
`<nav id="sidebar">`, `<ul class="nav-links">`, the workspace combobox
(`#ws-toggle`, `#ws-combobox`, `#ws-filter-input`, `#ws-filter-list`,
`#ws-filter`), `#harness-filter`, and badges (`#badge-sessions`, …). A
hand-written simplified skeleton would render a blank dashboard and dead
filters while still passing naive structural unit tests. Reusing
`getDashboardHtml` keeps the body **byte-identical to upstream by
construction** — no nav duplication, no drift, no `nav-config.ts`. The only
VS Code coupling lives in the head/script section, which we transform.

`getDashboardHtml(webview, extensionUri)` produces VS Code-specific output
only via the `webview`/`extensionUri` arguments and `getNonce()`:

- `webview.asWebviewUri(...)` for the `app.js` / `styles.css` URLs,
- `webview.cspSource` and a `getNonce()` nonce in the CSP,
- `vscode.Uri.joinPath(...)` to build the asset paths.

The wrapper passes a **stub webview** that returns plain `/dist/webview/*`
URLs and `'self'` for `cspSource` (so the `styles.css` link comes out
correct with no surgery), and the `vscode.Uri.joinPath` call is satisfied by
the `vscode-stub` ([07-build](07-build.md)). The wrapper then performs two
**assert-once** string replacements on the head/script section.

## Files

| Path                                             | Purpose                            | LOC |
|--------------------------------------------------|------------------------------------|-----|
| `src/standalone/standalone-html.ts`              | `renderStandaloneHtml(opts)` — reuse + transform | ~70 |
| `src/standalone/__tests__/standalone-html.test.ts` | Output structure + drift-guard tests | ~80 |

There is **no** `nav-config.ts`. The standalone nav is whatever
`getDashboardHtml` emits (10 entries; the `burndown` entry is already gated
server-side at `panel-html.ts:34` behind `FF_TOKEN_REPORTING_ENABLED`, so it
is absent while the flag is `false`).

## Public API

```ts
// src/standalone/standalone-html.ts

export interface HtmlOptions {
  token: string;            // 64-char hex; goes into the coach-token meta tag
  appVersion: string;       // reserved for footer / about; not load-bearing in v1
}

export function renderStandaloneHtml(opts: HtmlOptions): string;
```

## Behavior

### Construction

```ts
import { getDashboardHtml } from '../webview/panel-html';  // pulls panel-shared → vscode (aliased to stub)

function basename(p: string): string { return p.split('/').pop() ?? p; }

export function renderStandaloneHtml(opts: HtmlOptions): string {
  if (!/^[0-9a-f]{64}$/.test(opts.token)) {
    throw new Error('renderStandaloneHtml: token must be 64-char hex');
  }

  // Stub webview: asWebviewUri → /dist/webview/<file>; cspSource → 'self'.
  // vscode.Uri.joinPath (called inside getDashboardHtml) is provided by the
  // vscode-stub and returns { path, fsPath } whose trailing segment we keep.
  const stubWebview = {
    asWebviewUri: (u: { path?: string; fsPath?: string }) =>
      `/dist/webview/${basename(u.path ?? u.fsPath ?? String(u))}`,
    cspSource: "'self'",
  };

  let html = getDashboardHtml(stubWebview as never, {} as never);

  // Transform 1: replace the VS Code CSP <meta> with the standalone CSP,
  // and inject the coach-token meta immediately after it.
  html = replaceOnce(
    html,
    /<meta http-equiv="Content-Security-Policy"[^>]*>/,
    `${STANDALONE_CSP_META}\n${tokenMeta(opts.token)}`,
    'CSP meta tag',
  );

  // Transform 2: replace the nonce'd app.js <script> with shim + app.js,
  // both external, no nonce. Document order guarantees the shim defines
  // acquireVsCodeApi before app.js evaluates.
  html = replaceOnce(
    html,
    /<script nonce="[^"]*" src="\/dist\/webview\/app\.js"><\/script>/,
    `<script src="/standalone-shim.js"></script>\n<script src="/dist/webview/app.js"></script>`,
    'app.js script tag',
  );

  return html;
}
```

`replaceOnce(html, pattern, replacement, label)` counts matches and
**throws** unless there is exactly one (`coach: expected exactly one
<label>, found N`). This converts an upstream `panel-html.ts` reformat into a
loud build/test failure instead of silently serving the VS Code CSP
(`default-src 'none'`, nonce'd script) — which would blank the page.

### The standalone CSP and token meta

```ts
const STANDALONE_CSP_META =
  `<meta http-equiv="Content-Security-Policy" ` +
  `content="default-src 'self'; style-src 'self' 'unsafe-inline'; ` +
  `script-src 'self'; img-src 'self' data:; font-src 'self'">`;

const tokenMeta = (token: string) =>
  `<meta name="coach-token" content="${token}">`;
```

- Dropped vs. the VS Code CSP: `require-trusted-types-for 'script'` and
  `trusted-types coach-html default`. The webview's Trusted Types use is
  optional — `render.ts:21` and `shared.ts:152` create policies **only**
  `if (window.trustedTypes)` and the page works whether or not the policy is
  enforced; without `require-trusted-types-for`, nothing is enforced.
- `'unsafe-inline'` is kept for `style-src` only (chart.js inline styles +
  the shim's banner inline `style`), never for `script-src`.
- The token is 64-char hex (validated above), so HTML-attribute escaping is
  belt-and-suspenders; it is safe to interpolate directly.

### Shim delivery (external, token via meta)

`script-src 'self'` forbids an inline polyfill, so the shim is the external
`/standalone-shim.js` ([04-webview-shim](04-webview-shim.md)), injected by
Transform 2 immediately before `app.js`. The shim reads the token at runtime
from `document.querySelector('meta[name="coach-token"]')?.content` (the
`coach_token` cookie is `HttpOnly` and unreadable from JS). Both scripts are
classic (non-module) external scripts; document order guarantees the shim
defines `globalThis.acquireVsCodeApi` before `app.js` evaluates. We do **not**
use `defer`/`async`.

## Decisions

| Open question                                       | Decision                                                                 | Why |
|-----------------------------------------------------|--------------------------------------------------------------------------|-----|
| Hand-write the body or reuse upstream?              | **Reuse `getDashboardHtml` via a stub webview**                          | A hand-written skeleton mismatches the DOM `app.js` targets (`#content`, `#sidebar`, the filter block) → blank page; reuse stays byte-identical to upstream with zero drift |
| Nav omission / `nav-config.ts` / hidden-set         | **None — deleted**                                                       | No nav entry needs hiding (every entry works or degrades gracefully; `burndown` is already flag-gated server-side). The "hidden pages" the feasibility doc named are deep-link-only routes, not nav entries |
| Drift detection                                     | **`replaceOnce` assert-once guards**                                     | If upstream reformats the CSP meta or the app.js script tag, the transform throws — caught by build + unit test. Replaces the old nav-diff CI check |
| Shim delivery                                       | External `/standalone-shim.js` + `<meta name="coach-token">`             | `script-src 'self'` blocks an inline polyfill; the cookie is `HttpOnly`, so the token rides a meta tag |
| Trusted Types in the standalone CSP                 | Dropped                                                                  | Webview Trusted Types use is guarded by `if (window.trustedTypes)` and is not load-bearing; without `require-trusted-types-for` nothing is enforced |
| CSP nonce                                           | Not used                                                                 | With zero inline scripts, `script-src 'self'` covers both external scripts; the inherited nonce is stripped by Transform 2 |

## Dependencies

- `src/webview/panel-html` (upstream) — for `getDashboardHtml`. Imported as
  a library (we do not edit it). Transitively pulls `panel-shared` →
  `vscode`, resolved by the alias stub ([07-build](07-build.md)), which also
  supplies the `Uri.joinPath` that `getDashboardHtml` calls.
- [04-webview-shim](04-webview-shim.md) — referenced only by URL
  (`/standalone-shim.js`); not imported.

**Caveat for the implementing agent:** `getDashboardHtml` is currently
exported from `src/webview/panel-html.ts:10`. If the export name or its
head/script markup has changed in the upstream branch you check out, the
`replaceOnce` guards will throw — halt and update the anchors (and confirm
the body still renders into `#content`). Do not edit `panel-html.ts`.

## Acceptance criteria

1. `renderStandaloneHtml({ token, appVersion: '0.1.0' })` returns a string
   starting with `<!DOCTYPE html>` containing exactly two `<script>` tags,
   **both with a `src`** (`/standalone-shim.js` then `/dist/webview/app.js`)
   and **no inline `<script>`**.
2. The output contains the standalone CSP string and does **not** contain
   `default-src 'none'`, `nonce-`, or `require-trusted-types-for`.
3. The output contains `href="/dist/webview/styles.css"` (the stub
   `asWebviewUri` produced it; no surgery needed).
4. The output preserves the real body: it contains `<main id="content">`,
   `<nav id="sidebar">`, `id="ws-filter"`, and `id="harness-filter"`
   (regression guard against stripping or replacing the body).
5. The output contains `<meta name="coach-token" content="<token>">`, and
   `/standalone-shim.js` appears **before** `/dist/webview/app.js`.
6. `renderStandaloneHtml({ token: 'bad', appVersion: '0.1.0' })` throws
   (token not 64-char hex).
7. **Drift guard:** if `getDashboardHtml`'s output lacks the CSP-meta anchor
   or the nonce'd `app.js` script anchor, `renderStandaloneHtml` throws
   (`expected exactly one …`) rather than returning a half-transformed page.
8. The `burndown` nav entry is **absent** from the output while
   `FF_TOKEN_REPORTING_ENABLED` is `false` — inherited from
   `panel-html.ts:34`, confirming the flag-gated nav passes through.

## Test plan

`src/standalone/__tests__/standalone-html.test.ts` (vitest; `vscode` alias
required so `getDashboardHtml` resolves):

| Test name                                              | Intent                                            |
|--------------------------------------------------------|---------------------------------------------------|
| `renders well-formed HTML`                             | Parse with a tiny HTML parser, assert no errors   |
| `swaps in the standalone CSP, drops VS Code CSP`       | Contains standalone CSP; no `default-src 'none'` / `nonce-` / trusted-types |
| `keeps the real body (#content, #sidebar, filters)`    | `<main id="content">`, `#sidebar`, `#ws-filter`, `#harness-filter` present |
| `links upstream styles.css`                            | `href="/dist/webview/styles.css"`                 |
| `emits coach-token meta tag`                           | `<meta name="coach-token" content="<token>">` present |
| `loads external shim before app.js`                    | Index of `/standalone-shim.js` < index of `/dist/webview/app.js` |
| `contains no inline script`                            | Every `<script>` has a `src` attribute            |
| `throws on bad token`                                  | Non-hex token → throw                             |
| `throws if CSP anchor missing (drift guard)`           | Feed a fake `getDashboardHtml` output w/o the CSP meta → `replaceOnce` throws |
| `throws if app.js script anchor missing (drift guard)` | Likewise for the nonce'd script tag               |
| `omits burndown nav while flag is false`               | No `data-page="burndown"` in output               |
| `same input is deterministic`                          | Pure function                                     |
