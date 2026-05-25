# 04 — Webview shim (browser-side polyfill)

**External** browser script, built to `dist/standalone/standalone-shim.js`
and loaded via `<script src="/standalone-shim.js">` from
[03-standalone-html](03-standalone-html.md) *before* `app.js`. Defines
`globalThis.acquireVsCodeApi` so the unmodified webview bundle works in a
plain browser, and bridges its `postMessage` traffic to the WebSocket
exposed by [01-server](01-server.md).

It is an **external** asset (not an inline `<script>`) because the CSP is
`script-src 'self'` with no nonce — an inline polyfill would be blocked
and `acquireVsCodeApi` would never be defined. It reads its auth token
from the `<meta name="coach-token">` tag the wrapper emits, because the
`coach_token` cookie is `HttpOnly` and unreadable from JS.

## Goal

Zero edits to `src/webview/`. The existing `shared.ts:9` calls
`acquireVsCodeApi()` at module load; the shim, loaded first, defines it.
Existing `webview-smoke.test.ts:19` proves the polyfill shape works in
tests; this spec productionizes the same pattern with a WebSocket
transport and a meta-tag token.

## Files

| Path                                          | Purpose                                | LOC |
|-----------------------------------------------|----------------------------------------|-----|
| `src/standalone/webview-shim.ts`              | Browser shim source (IIFE)             | ~55 |
| `src/standalone/__tests__/webview-shim.test.ts` | Unit tests (jsdom + mock WS)         | ~90 |

The shim **is** bundled by esbuild as a browser-target entrypoint to
`dist/standalone/standalone-shim.js` (see [07-build](07-build.md)). This
reverses an earlier draft that emitted the shim as an inline string: an
inline `<script>` is blocked by `script-src 'self'`, so the shim must be
a same-origin external asset served at `/standalone-shim.js`.

## Public API

```ts
// src/standalone/webview-shim.ts  (browser target)

// Self-executes at module scope in the bundle. Exported so jsdom unit
// tests can drive it deterministically. Reads the token from the
// <meta name="coach-token"> tag in the served HTML.
export function installShim(): void;

// Curated set: only these disabled methods trigger the roadmap banner.
// Everything else disabled is silent (the calling page degrades via its
// own .catch). See 00-overview "Disabled-method UX".
export const BANNER_WORTHY: ReadonlySet<string>;
```

There is **no** `renderShimScript(token)` — the token is no longer
interpolated server-side. The shim reads it at runtime via
`document.querySelector('meta[name="coach-token"]')?.content`. If the
meta tag is absent or not 64-char hex, the shim logs to `console.warn`
and does not open a socket (the page will surface RPC timeouts, which is
the correct failure mode for a missing token).

## Behavior (runtime, in the browser)

0. **Read the token from the meta tag.** At script start,
   `const token = document.querySelector('meta[name="coach-token"]')?.content`.
   Validate `/^[0-9a-f]{64}$/`; if it fails, `console.warn` and skip the
   connection (do not throw — `acquireVsCodeApi` is still defined so
   `app.js` loads; RPCs simply time out).
1. **Synchronous polyfill registration.** Before any `await` or
   listener-binding, define `globalThis.acquireVsCodeApi` to a factory
   that returns the polyfill object. Because the shim is an external
   `<script src>` placed before `app.js`, classic-script document order
   guarantees this completes before `app.js` evaluates.
2. **WebSocket connection.** Open
   `new WebSocket(\`ws://${location.host}/rpc?t=${token}\`)` at script
   evaluation time (only if the token validated). Do not lazy-init; the
   webview will call `postMessage` immediately and we cannot lose those
   frames.
3. **Outbound queue.** Until the WebSocket is `OPEN`, buffer
   `postMessage` payloads in a local array. On `open`, drain in FIFO
   order. Cap buffer at 100 entries; over-cap → log to console and drop
   oldest.
4. **Inbound forwarding.** On each `message` event, parse `ev.data` as
   JSON and call `window.postMessage(parsed, '*')`. This matches the
   existing webview listener in `shared.ts:57`.
5. **State storage.** `getState()` reads `coach-state` from
   `localStorage` (JSON-parsed, falling back to `null`). `setState(s)`
   JSON-stringifies and writes. Mirror of the VS Code webview API.
6. **Reconnect on close.** If the WebSocket closes for any reason,
   reconnect with exponential backoff: 250 ms × 2^attempt, capped at
   30 000 ms. After 5 consecutive failures, dispatch a custom event
   `coach:disconnected` on `window` (the UI may display a banner; if
   it does not, behavior is unchanged from a hung connection).
7. **No reconnect storms.** Reset the backoff counter on successful
   `open`.
8. **Errors.** Log to `console.warn` only. Do not show alerts. Do not
   reload the page.
9. **Roadmap banner for *banner-worthy* disabled methods.** Inspect each
   inbound frame *before* forwarding it. Show the banner **only when**
   `data.code === 'standalone-v1-disabled'` **and** `data.method ∈
   BANNER_WORTHY`. Note `data.code`/`data.method`, **not** a sibling
   `error.code` — errors ride inside `data`
   (see [00-overview](00-overview.md#rpc-contract)). The banner is a
   single sticky DOM element (id `coach-roadmap-banner`) with copy:
   *"This feature is coming to standalone in v2. Today it lives in the
   VS Code extension."* Idempotent — repeat disabled responses just
   refresh its timestamp; a close button removes it; the next
   banner-worthy response re-adds it.

   **Why the curated set (not "any disabled response").** Visible pages
   fire disabled methods *proactively* — the dashboard alone calls
   `triageSkills`/`discoverCatalog`/`triageCatalog` on load
   (`page-dashboard.ts:395-407`). Banner-on-any-disabled would pop the
   roadmap banner on the home screen every visit. So `BANNER_WORTHY`
   lists only genuinely user-initiated content-creation methods:

   ```ts
   export const BANNER_WORTHY: ReadonlySet<string> = new Set([
     'createSkill', 'generateSkillContent', 'generateLearningQuiz',
     'generateLearningResources', 'generateCodeComparison',
     'generateDidYouKnow', 'installSkill', 'installCatalogItem',
     'triageCatalog',                 // user-clicked on the visible skills page; silent on the dashboard would need page-awareness we don't have, so banner is acceptable here
     'getRuleEditor',                 // fired by a button on the (working) anti-patterns/rule-editor view
   ]);
   ```

   The real banner trigger is **user-initiated content creation on visible
   pages** — chiefly `createSkill`/`installSkill`/`installCatalogItem` on the
   Skill Finder page, and the `generate*` learning methods. The
   "hidden authoring pages" framing from the feasibility doc does not apply:
   the deep-link-only routes (`rule-editor`, `rule-playground`,
   `data-explorer`) actually render working/partly-working pages
   (see [08-testing](08-testing.md) Layer 0).

   Everything else disabled (`triageSkills`, `discoverCatalog`,
   `reviewContextFiles`, `getSdlc*`, `getWorkspaceDeps`, and the unlisted
   rule-authoring methods like `reviewLocalRules`/`evaluateExpression`) is
   **silent-disabled** by default: the frame still forwards (so the page's
   `.catch(() => null)` degrades the section), but no banner appears.

   **In all cases the frame is still forwarded** to `window.postMessage`,
   so the webview's `shared.ts:62` rejects on `data.error` and the page's
   error boundary handles it.

## Decisions

| Open question                              | Decision                                                  | Why |
|--------------------------------------------|-----------------------------------------------------------|-----|
| Buffer cap on outbound queue               | 100 entries                                               | Large enough for a slow handshake; small enough to bound memory |
| Reconnect strategy                         | Exponential 250 ms → 30 s cap, 5 failures → event         | Survives sleep/wake; bounded log noise |
| `coach:disconnected` event vs. modal       | Event only                                                | Optional UI; do not couple shim to UI choices |
| Shim delivery                              | External `/standalone-shim.js`; token via `<meta name="coach-token">` | `script-src 'self'` blocks inline scripts; `HttpOnly` cookie is unreadable from JS |
| Token visible in `view-source:`            | Accepted (now in a meta tag, not inline JS)               | Same-origin only; token is for inter-process gating, not secrecy from the page |
| TypedArray frames vs. JSON text            | JSON text                                                 | Matches RPC contract in 00-overview; trivial to debug |
| Roadmap banner owner                       | Shim (DOM injection on inbound frame inspection)          | Keeps webview untouched; only place that sees every RPC frame |
| Banner trigger                             | `data.code === 'standalone-v1-disabled'` **and** `data.method ∈ BANNER_WORTHY` | Visible pages fire disabled methods proactively; a global trigger would banner the dashboard |
| `triageCatalog` bucket                     | Banner-worthy                                             | User-clicks it on the skills page; the dashboard's proactive call accepting a banner is the lesser evil vs. a page-aware shim |
| Banner styling                             | Inline `style` attribute (CSP allows `style-src 'unsafe-inline'`) | Avoids adding a new CSS file; tiny ruleset |

## Dependencies

- Runs in browser; no runtime imports. Built by esbuild as a browser
  target ([07-build](07-build.md)).
- Reads `location.host` and the token from
  `<meta name="coach-token">` (emitted by [03-standalone-html](03-standalone-html.md)).
- Reads/writes `localStorage[coach-state]`.

## Code sketch (full shim — fits the budget)

```ts
// src/standalone/webview-shim.ts  (esbuild browser target → standalone-shim.js)

export const BANNER_WORTHY: ReadonlySet<string> = new Set([
  'createSkill', 'generateSkillContent', 'generateLearningQuiz',
  'generateLearningResources', 'generateCodeComparison',
  'generateDidYouKnow', 'installSkill', 'installCatalogItem',
  'triageCatalog', 'getRuleEditor',
]);

export function installShim(): void {
  const token = document
    .querySelector('meta[name="coach-token"]')
    ?.getAttribute('content') ?? '';

  const outbox: string[] = [];
  let ws: WebSocket | null = null;
  let attempt = 0;

  function connect() {
    ws = new WebSocket(`ws://${location.host}/rpc?t=${token}`);
    ws.addEventListener('open', () => { attempt = 0; while (outbox.length) ws!.send(outbox.shift()!); });
    ws.addEventListener('message', (ev) => {
      let frame: any;
      try { frame = JSON.parse(ev.data); } catch (e) { console.warn('[coach] bad frame', e); return; }
      // Banner decision happens here — the shim is the only place that sees every frame.
      if (frame?.data?.code === 'standalone-v1-disabled' && BANNER_WORTHY.has(frame.data.method)) {
        showRoadmapBanner();
      }
      window.postMessage(frame, '*');          // always forward; page handles data.error
    });
    ws.addEventListener('close', () => {
      ws = null; attempt += 1;
      if (attempt >= 5) window.dispatchEvent(new Event('coach:disconnected'));
      setTimeout(connect, Math.min(250 * 2 ** attempt, 30000));
    });
    ws.addEventListener('error', (e) => console.warn('[coach] ws error', e));
  }

  globalThis.acquireVsCodeApi = () => ({
    postMessage: (msg: unknown) => {
      const frame = JSON.stringify(msg);
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(frame);
      else { if (outbox.length >= 100) outbox.shift(); outbox.push(frame); }
    },
    getState: () => { try { return JSON.parse(localStorage.getItem('coach-state') || 'null'); } catch { return null; } },
    setState: (s: unknown) => localStorage.setItem('coach-state', JSON.stringify(s)),
  });

  if (/^[0-9a-f]{64}$/.test(token)) connect();
  else console.warn('[coach] missing/invalid coach-token meta; RPC disabled');
}

installShim();   // self-execute in the bundle
```

`acquireVsCodeApi` is defined **before** the `connect()`/token check, so
`app.js` always loads even when the token is missing — the failure mode
is RPC timeouts, not a blank page. `showRoadmapBanner()` is the idempotent
sticky-banner helper described in behavior step 9.

## Acceptance criteria

1. After `installShim()` runs in a jsdom window with a valid
   `<meta name="coach-token">`, `globalThis.acquireVsCodeApi` is defined
   and returns an object with `postMessage`, `getState`, `setState`.
2. With a missing or non-hex meta token, `installShim()` still defines
   `acquireVsCodeApi`, opens **no** socket, and logs a `console.warn`.
3. With a mock WebSocket, calling `postMessage({hello:1})` before `open`
   and then firing `open` results in the mock receiving `'{"hello":1}'`.
4. Triggering five `close` events fires exactly one `coach:disconnected`
   event on `window`.
5. After a `close`/`open` cycle, the backoff attempt counter resets
   (verified by short interval to next reconnect).
6. A frame with `data.code === 'standalone-v1-disabled'` and
   `data.method` **in** `BANNER_WORTHY` appends `#coach-roadmap-banner`;
   a frame whose `method` is **not** in the set does not (silent), yet
   both are still forwarded to `window.postMessage`.

## Test plan

`src/standalone/__tests__/webview-shim.test.ts`, jsdom environment.
Use vitest's `vi.useFakeTimers` for backoff verification and a manual
`WebSocket` mock attached to `globalThis`.

| Test name                                                  | Intent                                         |
|------------------------------------------------------------|------------------------------------------------|
| `reads token from coach-token meta`                        | jsdom sets the meta; shim opens ws with `?t=`  |
| `missing token → no socket, warn, api still defined`       | Graceful degradation                           |
| `defines acquireVsCodeApi synchronously`                   | Polyfill registration order                    |
| `buffers messages before open and drains on open`          | FIFO + drain                                   |
| `drops oldest beyond buffer cap`                           | 101st message replaces 1st                     |
| `forwards inbound frames to window.postMessage`            | Inbound bridge                                 |
| `getState/setState round-trip localStorage`                | Persistence shape                              |
| `reconnect uses exponential backoff capped at 30 s`        | Backoff math                                   |
| `dispatches coach:disconnected after 5 close events`       | Event signal                                   |
| `resets backoff counter on successful open`                | No reconnect storm after recovery              |
| `ignores malformed JSON frames`                            | Logs warn, no throw                            |
| `banners a BANNER_WORTHY disabled method`                  | `data.method` in set → `#coach-roadmap-banner` |
| `does NOT banner a silent-disabled method`                 | e.g. `triageSkills` → no banner, still forwarded |
| `banner close button removes the element`                  | Click handler wiring                           |
| `repeated disabled responses do not stack banners`         | Idempotent re-render                           |
