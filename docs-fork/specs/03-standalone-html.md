# 03 — Standalone HTML wrapper

The HTML page returned by GET `/` in [01-server](01-server.md). Mirrors
the structure of upstream `src/webview/panel-html.ts` minus VS Code
URI handling, with the [04-webview-shim](04-webview-shim.md) polyfill
injected before the webview bundle and the hidden-page nav entries
removed.

## Goal

Render an HTML document that:

- Sets the documented CSP.
- Defines `globalThis.acquireVsCodeApi` (via the shim) before
  `<script src="/dist/webview/app.js">` loads.
- Includes the upstream `styles.css`.
- Renders the nav with five entries omitted (see "Nav omissions").
- Carries no inline `<script>` other than the shim.

## Files

| Path                                             | Purpose                            | LOC |
|--------------------------------------------------|------------------------------------|-----|
| `src/standalone/standalone-html.ts`              | `renderStandaloneHtml(opts)`       | ~90 |
| `src/standalone/nav-config.ts`                   | List of nav entries + omission set | ~30 |
| `src/standalone/__tests__/standalone-html.test.ts` | Output structure tests           | ~80 |

`nav-config.ts` is split out so the test for "hidden entries are not
present" can import the same source of truth as the renderer (avoids
hard-coding the list in two places).

## Public API

```ts
// src/standalone/standalone-html.ts

export interface HtmlOptions {
  token: string;            // for shim interpolation
  appVersion: string;       // for footer / about page
  cspNonce?: string;        // unused in v1; reserved for v2 if needed
}

export function renderStandaloneHtml(opts: HtmlOptions): string;
```

```ts
// src/standalone/nav-config.ts

export interface NavEntry {
  id: string;            // matches webview's page id
  label: string;
  iconSvg: string;       // inline SVG markup
}

export const ALL_NAV_ENTRIES: NavEntry[];   // mirror of upstream nav
export const HIDDEN_IN_STANDALONE_V1: ReadonlySet<string>;  // entry ids

export function visibleNavEntries(): NavEntry[];   // ALL_NAV_ENTRIES filtered
```

## Behavior

### Document structure

The returned HTML string is exactly this skeleton (whitespace
normalized; specific values interpolated):

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; font-src 'self'" />
  <title>AI Engineer Coach</title>
  <link rel="stylesheet" href="/dist/webview/styles.css" />
</head>
<body>
  <nav id="coach-nav">
    <!-- visibleNavEntries() rendered here -->
  </nav>
  <main id="coach-main"></main>
  <script>/* renderShimScript(token) inlined here */</script>
  <script src="/dist/webview/app.js"></script>
</body>
</html>
```

The CSP `<meta>` mirrors the HTTP header sent by [01-server](01-server.md);
having both means the browser enforces it even if a future caching
proxy strips the header.

### Nav rendering

Each visible entry renders as:

```html
<a href="#{id}" data-page="{id}" class="coach-nav-entry">
  {iconSvg}
  <span>{label}</span>
</a>
```

The webview's existing client-side router already listens for hash
changes and `data-page` clicks. We do not duplicate router logic; we
only ensure the markup matches what `app.js` expects.

### Nav omissions

```ts
export const HIDDEN_IN_STANDALONE_V1: ReadonlySet<string> = new Set([
  'rule-editor',
  'rule-playground',
  'antipatterns-editor',
  'data-explorer',
  'learning',           // and variants (quiz, comparison, did-you-know)
]);
```

`dsl-reference`: include in `ALL_NAV_ENTRIES`. The implementing agent
verifies on first end-to-end test whether the page is static docs (then
it stays visible) or LLM-driven (then it joins `HIDDEN_IN_STANDALONE_V1`).
This deferral is acceptable because the rendering code is data-driven —
moving one entry to the hidden set is a one-line change with no other
consequences.

### Shim injection

The inline `<script>` between `</main>` and the bundle `<script>` is
literally `<script>${renderShimScript(opts.token)}</script>`. Per
[04-webview-shim](04-webview-shim.md), `renderShimScript` throws if
the token is not 64-char hex; the renderer surfaces that error.

Order matters: the polyfill must define `acquireVsCodeApi` before
`app.js` runs, and modern browsers guarantee execution order for
classic (non-`type="module"`) scripts in document order. We do **not**
use `defer` or `async` on either tag.

## Decisions

| Open question                                       | Decision                                                                 | Why |
|-----------------------------------------------------|--------------------------------------------------------------------------|-----|
| Nav data source — duplicate or reuse upstream?      | Duplicate (`nav-config.ts`)                                              | Upstream nav is built dynamically inside `panel-html.ts`; extracting a shared module would require editing upstream. Additive-only discipline wins. |
| Drift detection                                     | `08-testing` adds a CI check that diff's the visible nav set against an upstream-extracted reference | Cheap; flags the duplication when it matters |
| CSP nonce                                           | Not used in v1                                                           | We avoid all inline scripts other than the shim; the shim is small enough that the source is self-evident |
| Inline SVG vs. external `<img>` icons               | Inline SVG (matches upstream)                                            | Avoids a second style for icons; cacheable inside the HTML |
| Static `dsl-reference` verification timing          | Deferred to first E2E test in [08-testing](08-testing.md)                | Cheap to flip later; no architectural impact |

## Dependencies

- [04-webview-shim](04-webview-shim.md) — `renderShimScript`
- No upstream code imported. The nav structure is duplicated from
  `panel-html.ts`; the duplication is documented and tested.

## Acceptance criteria

1. `renderStandaloneHtml({ token, appVersion: '0.1.0' })` returns a
   string starting with `<!doctype html>` and containing exactly two
   `<script>` tags (one inline, one external).
2. The returned HTML contains the literal CSP string from this spec.
3. The returned HTML contains a `<link rel="stylesheet" href="/dist/webview/styles.css">`.
4. For every entry in `HIDDEN_IN_STANDALONE_V1`, the returned HTML does
   **not** contain `data-page="<id>"`.
5. For every entry returned by `visibleNavEntries()`, the returned HTML
   does contain `data-page="<id>"`.
6. The inline `<script>` content is non-empty and contains the literal
   `globalThis.acquireVsCodeApi`.
7. `renderStandaloneHtml({ token: 'bad', appVersion: '0.1.0' })`
   throws.

## Test plan

`src/standalone/__tests__/standalone-html.test.ts`:

| Test name                                              | Intent                                            |
|--------------------------------------------------------|---------------------------------------------------|
| `renders well-formed HTML`                             | Parse with a tiny HTML parser, assert no errors   |
| `includes documented CSP meta`                         | Exact match                                       |
| `links upstream styles.css`                            | Path + relative correctness                       |
| `inlines shim before app.js`                           | Indices: shim `<script>` index < bundle `<script>` index |
| `omits all hidden nav entries`                         | Loop over `HIDDEN_IN_STANDALONE_V1`               |
| `includes all visible nav entries`                     | Loop over `visibleNavEntries()`                   |
| `propagates shim validation error`                     | Bad token → throw                                 |
| `same input is deterministic`                          | Pure function                                     |
