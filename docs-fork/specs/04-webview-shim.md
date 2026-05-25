# 04 — Webview shim (browser-side polyfill)

Inline IIFE script injected by [03-standalone-html](03-standalone-html.md)
into the standalone HTML wrapper. Defines `globalThis.acquireVsCodeApi`
before `app.js` runs so the unmodified webview bundle works in a plain
browser, and bridges its `postMessage` traffic to the WebSocket exposed
by [01-server](01-server.md).

## Goal

Zero edits to `src/webview/`. The existing `shared.ts:9` calls
`acquireVsCodeApi()` at module load; a polyfill defined first satisfies
that call. Existing `webview-smoke.test.ts:19` proves the polyfill
shape works in tests; this spec productionizes the same pattern with a
WebSocket transport.

## Files

| Path                                          | Purpose                                | LOC |
|-----------------------------------------------|----------------------------------------|-----|
| `src/standalone/webview-shim.ts`              | `renderShimScript(token)` source       | ~50 |
| `src/standalone/__tests__/webview-shim.test.ts` | Unit tests (jsdom + mock WS)         | ~80 |

The shim is **not** bundled by esbuild as a browser entrypoint. It is
emitted as a string from a Node module and injected by the HTML wrapper.
This keeps the shim's source readable in `view-source:` and avoids a
second browser-target bundle.

## Public API

```ts
// src/standalone/webview-shim.ts

export function renderShimScript(token: string): string;
```

Returns a JavaScript source string suitable for placement inside an
inline `<script>...</script>` tag. The string is self-contained: no
imports, no module syntax. The `token` is interpolated literally; the
caller is responsible for ensuring it is URL-safe (32-byte hex per
[00-overview](00-overview.md#security-model)).

## Behavior (runtime, in the browser)

1. **Synchronous polyfill registration.** Before any `await` or
   listener-binding, define `globalThis.acquireVsCodeApi` to a factory
   that returns the polyfill object. This must complete before
   `<script src="/dist/webview/app.js">` evaluates.
2. **WebSocket connection.** Open
   `new WebSocket(\`ws://${location.host}/rpc?t=${TOKEN}\`)` at script
   evaluation time. Do not lazy-init; the webview will call
   `postMessage` immediately and we cannot lose those frames.
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
9. **Roadmap banner for disabled methods.** When an inbound RPC frame
   has `error.code === 'standalone-v1-disabled'`, render a single
   sticky banner DOM element (id `coach-roadmap-banner`) with copy:
   *"This feature is coming to standalone in v2. Today it lives in the
   VS Code extension."* The banner is idempotent — re-displaying for
   subsequent disabled responses just refreshes its timestamp. A close
   button on the banner removes it; the next disabled response re-adds
   it. This satisfies the "direct URL hits show a roadmap banner"
   acceptance criterion without editing the webview bundle.

## Decisions

| Open question                              | Decision                                                  | Why |
|--------------------------------------------|-----------------------------------------------------------|-----|
| Buffer cap on outbound queue               | 100 entries                                               | Large enough for a slow handshake; small enough to bound memory |
| Reconnect strategy                         | Exponential 250 ms → 30 s cap, 5 failures → event         | Survives sleep/wake; bounded log noise |
| `coach:disconnected` event vs. modal       | Event only                                                | Optional UI; do not couple shim to UI choices |
| Token visible in `view-source:`            | Accepted                                                  | Same-origin only; token is for inter-process gating, not secrecy from the page |
| TypedArray frames vs. JSON text            | JSON text                                                 | Matches RPC contract in 00-overview; trivial to debug |
| Roadmap banner owner                       | Shim (DOM injection on disabled-method response)          | Keeps webview untouched; only place that sees every RPC frame |
| Banner styling                             | Inline `style` attribute (CSP allows `style-src 'unsafe-inline'`) | Avoids adding a new CSS file; tiny ruleset |

## Dependencies

- Runs in browser; no runtime imports.
- Reads `location.host` and the literal `TOKEN` interpolated by
  `renderShimScript`.
- Reads/writes `localStorage[coach-state]`.

## Code sketch (full shim — fits the budget)

```ts
// src/standalone/webview-shim.ts
export function renderShimScript(token: string): string {
  if (!/^[0-9a-f]{64}$/.test(token)) {
    throw new Error('renderShimScript: token must be 64-char hex');
  }
  // Interpolated below; runs in the browser.
  return `
(() => {
  const TOKEN = ${JSON.stringify(token)};
  const url = 'ws://' + location.host + '/rpc?t=' + TOKEN;
  const outbox = [];
  let ws = null;
  let attempt = 0;

  function connect() {
    ws = new WebSocket(url);
    ws.addEventListener('open', () => {
      attempt = 0;
      while (outbox.length) ws.send(outbox.shift());
    });
    ws.addEventListener('message', (ev) => {
      try { window.postMessage(JSON.parse(ev.data), '*'); }
      catch (e) { console.warn('[coach] bad frame', e); }
    });
    ws.addEventListener('close', () => {
      ws = null;
      attempt += 1;
      if (attempt >= 5) window.dispatchEvent(new Event('coach:disconnected'));
      const delay = Math.min(250 * Math.pow(2, attempt), 30000);
      setTimeout(connect, delay);
    });
    ws.addEventListener('error', (e) => console.warn('[coach] ws error', e));
  }

  globalThis.acquireVsCodeApi = () => ({
    postMessage: (msg) => {
      const frame = JSON.stringify(msg);
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(frame);
      else {
        if (outbox.length >= 100) outbox.shift();
        outbox.push(frame);
      }
    },
    getState: () => { try { return JSON.parse(localStorage.getItem('coach-state') || 'null'); } catch { return null; } },
    setState: (s) => localStorage.setItem('coach-state', JSON.stringify(s)),
  });

  connect();
})();
`;
}
```

## Acceptance criteria

1. `renderShimScript(token)` with a valid 64-char hex token returns a
   non-empty string containing the literal `globalThis.acquireVsCodeApi`.
2. `renderShimScript('not-hex')` throws an `Error` (validation).
3. In a jsdom test, evaluating the returned source in a window context
   makes `acquireVsCodeApi` defined; calling it returns an object with
   `postMessage`, `getState`, `setState` functions.
4. With a mock WebSocket, calling `postMessage({hello:1})` before
   `open` and then firing `open` results in the mock receiving
   `'{"hello":1}'`.
5. Triggering five `close` events fires exactly one
   `coach:disconnected` event on `window`.
6. After a `close`/`open` cycle, the backoff attempt counter resets
   (verified by short interval to next reconnect).

## Test plan

`src/standalone/__tests__/webview-shim.test.ts`, jsdom environment.
Use vitest's `vi.useFakeTimers` for backoff verification and a manual
`WebSocket` mock attached to `globalThis`.

| Test name                                                  | Intent                                         |
|------------------------------------------------------------|------------------------------------------------|
| `validates token format`                                   | Bad token → throw                              |
| `defines acquireVsCodeApi synchronously`                   | Polyfill registration order                    |
| `buffers messages before open and drains on open`          | FIFO + drain                                   |
| `drops oldest beyond buffer cap`                           | 101st message replaces 1st                     |
| `forwards inbound frames to window.postMessage`            | Inbound bridge                                 |
| `getState/setState round-trip localStorage`                | Persistence shape                              |
| `reconnect uses exponential backoff capped at 30 s`        | Backoff math                                   |
| `dispatches coach:disconnected after 5 close events`       | Event signal                                   |
| `resets backoff counter on successful open`                | No reconnect storm after recovery              |
| `ignores malformed JSON frames`                            | Logs warn, no throw                            |
| `renders roadmap banner on standalone-v1-disabled error`   | Asserts `#coach-roadmap-banner` appended       |
| `banner close button removes the element`                  | Click handler wiring                           |
| `repeated disabled responses do not stack banners`         | Idempotent re-render                           |
