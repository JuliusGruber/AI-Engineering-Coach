# 03 — Standalone HTML wrapper

The HTML page returned by GET `/` in [01-server](01-server.md). Mirrors
the structure of upstream `src/webview/panel-html.ts` minus VS Code
URI handling, with the [04-webview-shim](04-webview-shim.md) polyfill
loaded as an **external** `/standalone-shim.js` before the webview
bundle, the auth token carried in a `<meta>` tag, and the hidden-page
nav entries removed.

## Goal

Render an HTML document that:

- Sets the documented CSP (`script-src 'self'` — no nonce, no
  `'unsafe-inline'` for scripts).
- Loads `/standalone-shim.js` (which defines `globalThis.acquireVsCodeApi`)
  before `<script src="/dist/webview/app.js">`.
- Carries the auth token in `<meta name="coach-token" content="…">` so the
  external shim can read it for the `ws://…?t=` URL (the `coach_token`
  cookie is `HttpOnly` and unreadable from JS).
- Includes the upstream `styles.css`.
- Renders the nav with the hidden entries omitted (see "Nav omissions").
- Carries **zero** inline `<script>` tags — both scripts are external,
  so the page is clean under `script-src 'self'`.

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
  <meta name="coach-token" content="{token}" />
  <title>AI Engineer Coach</title>
  <link rel="stylesheet" href="/dist/webview/styles.css" />
</head>
<body>
  <nav id="coach-nav">
    <!-- visibleNavEntries() rendered here -->
  </nav>
  <main id="coach-main"></main>
  <script src="/standalone-shim.js"></script>
  <script src="/dist/webview/app.js"></script>
</body>
</html>
```

`{token}` is HTML-attribute-escaped before interpolation (it is 64-char
hex, so escaping is belt-and-suspenders). Both `<script>` tags are
external and load under `script-src 'self'`; document order guarantees
the shim defines `acquireVsCodeApi` before `app.js` evaluates (see
"Shim injection").

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
  'sdlc',               // see note: hidden for a DIFFERENT reason than the others
]);
```

**Two reasons a page is hidden — and they behave differently on
deep-link:**

- `rule-editor`, `rule-playground`, `antipatterns-editor`, `data-explorer`,
  `learning` — *authoring / LLM* features whose methods are
  **banner-worthy** (see [00-overview](00-overview.md#disabled-method-ux-banner-vs-silent)).
  A direct-URL hit fires a banner-worthy disabled method → roadmap banner.
- `sdlc` — hidden because its data source (`getSdlcRepoScan`,
  `getSdlcToolAnalysis`, `getSdlcGitHubData`) lives in the dropped
  `PanelRequestService`, **not** because it's a creation feature. Those
  methods are **silent-disabled**, so a direct-URL hit renders an empty
  page (no banner). It is hidden so users never see an empty page via the
  nav. (Reconciles the feasibility doc, which wrongly claimed sdlc's
  "read-only repo/PR data works".)

`dsl-reference`: include in `ALL_NAV_ENTRIES`. The implementing agent
verifies on first end-to-end test whether the page is static docs (then
it stays visible) or LLM-driven (then it joins `HIDDEN_IN_STANDALONE_V1`).
This deferral is acceptable because the rendering code is data-driven —
moving one entry to the hidden set is a one-line change with no other
consequences. The same first-build audit (see [08-testing](08-testing.md))
classifies every visible page's RPC calls; any page whose *primary* data
source is silent-disabled joins the hidden set.

### Shim injection (external, token via meta)

The shim is **not** inlined — an inline `<script>` would be blocked by
`script-src 'self'`. Instead the renderer emits two things:

1. `<meta name="coach-token" content="{escaped token}">` in `<head>`.
2. `<script src="/standalone-shim.js"></script>` immediately before the
   `app.js` `<script>`.

The shim ([04-webview-shim](04-webview-shim.md)) reads the token at
runtime via `document.querySelector('meta[name="coach-token"]')?.content`.
The renderer validates `opts.token` is 64-char hex (`/^[0-9a-f]{64}$/`)
and throws otherwise — same guard that `renderShimScript` used to carry,
now at the wrapper boundary since the shim is a static asset.

Order matters: the shim must define `acquireVsCodeApi` before `app.js`
runs. Modern browsers guarantee execution order for classic
(non-`type="module"`) external scripts in document order, so the shim
`<script src>` placed before the bundle `<script src>` is sufficient. We
do **not** use `defer` or `async` on either tag.

## Decisions

| Open question                                       | Decision                                                                 | Why |
|-----------------------------------------------------|--------------------------------------------------------------------------|-----|
| Nav data source — duplicate or reuse upstream?      | Duplicate (`nav-config.ts`)                                              | Upstream nav is built dynamically inside `panel-html.ts`; extracting a shared module would require editing upstream. Additive-only discipline wins. |
| Drift detection                                     | `08-testing` adds a CI check that diff's the visible nav set against an upstream-extracted reference | Cheap; flags the duplication when it matters |
| Shim delivery                                       | External `/standalone-shim.js` + `<meta name="coach-token">`             | `script-src 'self'` blocks an inline polyfill; the cookie is `HttpOnly`, so the token rides a meta tag the external shim reads |
| CSP nonce                                           | Not used in v1                                                           | With **zero** inline scripts, there is nothing to nonce; `script-src 'self'` covers both external scripts |
| Inline SVG vs. external `<img>` icons               | Inline SVG (matches upstream)                                            | Avoids a second style for icons; cacheable inside the HTML |
| Static `dsl-reference` verification timing          | Deferred to first E2E test in [08-testing](08-testing.md)                | Cheap to flip later; no architectural impact |

## Dependencies

- [04-webview-shim](04-webview-shim.md) — the renderer references the
  shim only by URL (`/standalone-shim.js`); it does **not** import shim
  source. The shim is a separately-built static asset.
- No upstream code imported. The nav structure is duplicated from
  `panel-html.ts`; the duplication is documented and tested.

## Acceptance criteria

1. `renderStandaloneHtml({ token, appVersion: '0.1.0' })` returns a
   string starting with `<!doctype html>` containing exactly two
   `<script>` tags, **both with a `src` attribute** and **no inline
   `<script>`** (regex: no `<script>` immediately followed by non-`src`
   content).
2. The returned HTML contains the literal CSP string from this spec.
3. The returned HTML contains a `<link rel="stylesheet" href="/dist/webview/styles.css">`.
4. For every entry in `HIDDEN_IN_STANDALONE_V1`, the returned HTML does
   **not** contain `data-page="<id>"`.
5. For every entry returned by `visibleNavEntries()`, the returned HTML
   does contain `data-page="<id>"`.
6. The returned HTML contains `<meta name="coach-token" content="<token>">`
   and `<script src="/standalone-shim.js">` positioned before
   `<script src="/dist/webview/app.js">`.
7. `renderStandaloneHtml({ token: 'bad', appVersion: '0.1.0' })`
   throws (token not 64-char hex).

## Test plan

`src/standalone/__tests__/standalone-html.test.ts`:

| Test name                                              | Intent                                            |
|--------------------------------------------------------|---------------------------------------------------|
| `renders well-formed HTML`                             | Parse with a tiny HTML parser, assert no errors   |
| `includes documented CSP meta`                         | Exact match                                       |
| `links upstream styles.css`                            | Path + relative correctness                       |
| `emits coach-token meta tag`                           | `<meta name="coach-token" content="<token>">` present, escaped |
| `loads external shim before app.js`                    | Indices: `/standalone-shim.js` `src` index < `app.js` `src` index |
| `contains no inline script`                            | Regex: every `<script>` has a `src` attribute      |
| `omits all hidden nav entries`                         | Loop over `HIDDEN_IN_STANDALONE_V1` (incl. `sdlc`) |
| `includes all visible nav entries`                     | Loop over `visibleNavEntries()`                   |
| `propagates token validation error`                    | Bad token → throw                                 |
| `same input is deterministic`                          | Pure function                                     |
