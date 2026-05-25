# Webview Shim (04-webview-shim) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `src/standalone/webview-shim.ts`, a browser-side polyfill that defines `globalThis.acquireVsCodeApi` (so the unmodified webview bundle runs in a plain browser) and bridges its `postMessage` traffic to the server's `/rpc` WebSocket, reading its auth token from a `<meta name="coach-token">` tag and surfacing a roadmap banner for the curated `BANNER_WORTHY` disabled methods.

**Architecture:** One leaf module exporting `installShim()` and `BANNER_WORTHY`. `installShim()` reads + validates the token, synchronously defines `acquireVsCodeApi` (whose `postMessage` buffers into a 100-entry FIFO until the socket opens, `getState`/`setState` mirror `localStorage['coach-state']`), then opens the WebSocket. Inbound frames are JSON-parsed and forwarded verbatim to `window.postMessage`; before forwarding, a `standalone-v1-disabled` frame whose `method ∈ BANNER_WORTHY` injects an idempotent sticky DOM banner. A `close` handler reconnects with exponential backoff (250 ms × 2^attempt, capped 30 s) and fires `coach:disconnected` after 5 consecutive failures. A bottom-of-file `if (typeof process === 'undefined') installShim()` self-executes only in the browser bundle, leaving the module inert when imported by the (Node-hosted) vitest suite so tests can drive `installShim()` deterministically.

**Tech Stack:** TypeScript (strict, ES2022 modules, `moduleResolution: bundler`, DOM lib), vitest with the **jsdom** environment (already a devDependency: `jsdom@29.1.1`), driven via a per-file `@vitest-environment jsdom` docblock. No new runtime or dev dependencies. No `vscode` import — this is pure browser code, so the standalone `vscode-stub`/vitest-alias scaffolding from `02-dispatcher` is irrelevant here.

---

## Spec references

- Spec under implementation: `docs-fork/specs/04-webview-shim.md`
- Shared contract: `docs-fork/specs/00-overview.md` — relevant pieces:
  - **RPC contract** — errors ride **inside** `data` (`{ data: { error, code, method } }`),
    never as a sibling field. The shim keys its banner decision on
    `frame.data.code` / `frame.data.method`, and **always** forwards the raw frame
    to `window.postMessage` so the webview's `shared.ts:62` listener handles
    `data.error`.
  - **Disabled-method UX** — `BANNER_WORTHY` is the curated set of user-initiated
    content-creation methods; every other disabled method is silent (forwarded, no
    banner). The split lives **only** in the shim.
    - **Why `triageCatalog` in `BANNER_WORTHY` does *not* violate global acceptance
      #4 ("banner not on page loads"):** its only two call sites
      (`page-dashboard.ts:407`, `page-skills.ts:366`) are both gated behind
      `discoverCatalog` returning items, and `discoverCatalog` is itself
      silent-disabled in v1 (returns the error envelope → `.catch(() => null)` /
      caught → the guard short-circuits). So `triageCatalog` is **never dispatched**
      in standalone v1 and can never banner on a load. It is kept in the set to
      mirror `00-overview`'s curated list verbatim (drift guard) and to be correct
      if `discoverCatalog` is ever enabled. The `BANNER_WORTHY.size === 10` test
      pins this; do not drop the member.
  - **Security model** — `script-src 'self'` (no nonce) forces the shim to be an
    **external** `/standalone-shim.js`, not an inline `<script>`; the
    `HttpOnly coach_token` cookie is unreadable from JS, so the WS token arrives via
    `<meta name="coach-token">`. `style-src 'unsafe-inline'` permits the banner's
    inline `style` attribute.
  - **Additive-only fork discipline** — every `+` line lives under
    `src/standalone/`. This spec touches **no** shared files (no `package.json`,
    `esbuild.mjs`, or vitest-config edit); verified in the final task.
  - **Style conventions** — vitest, kebab-case filenames under `src/standalone/`,
    named exports only, TS strict, comments only where the *why* is non-obvious.

### Dependency note — this is the 3rd plan in the queue

Per `00-overview.md`'s dependency table, `04-webview-shim` **blocks** `01-server`
(the server serves `/standalone-shim.js` and accepts the `/rpc` socket the shim
opens) and depends on no earlier-planned spec's code. The two already-planned
specs share **no interfaces** with the shim:

- `06-state.plan.md` — server-side `server-state.json`; the shim's client state
  lives in browser `localStorage`, a separate mechanism. Nothing to honor.
- `02-dispatcher.plan.md` — its `DispatchResult` union is internal to the host.
  The shim only ever sees the **wire** shape (`RpcResponse` with `data: { error,
  code, method }`) that `01-server` maps the dispatcher's union into. The shim
  consumes `code`/`method` strings; `BANNER_WORTHY` must list the exact method
  names the dispatcher disables. No type import crosses the boundary.

The contracts this plan locks in for `01-server` to honor:
- The shim opens `ws://${location.host}/rpc?t=${token}` — the server's WS route is
  `/rpc` with a `?t=<64-hex>` query param. The shim only connects when the token
  matches `/^[0-9a-f]{64}$/` (**lowercase** 64-hex). This is exactly the output of
  `crypto.randomBytes(32).toString('hex')`, the generator used by `01-server`,
  `05-cli` (`--rotate-token`), and validated identically in `06-state`'s `state.ts`.
  Those plans must keep emitting lowercase hex; an uppercase/base64 token would fail
  the shim's regex and silently disable RPC.
- The shim reads the token from `<meta name="coach-token" content="<64-hex>">` —
  `03-standalone-html` must emit exactly that tag and `01-server` must serve it.
- The shim sends each `postMessage` payload as a **single JSON text frame**
  (`JSON.stringify(msg)`) and expects each inbound text frame to be one JSON
  object — matching the `00-overview` "JSON text frames" decision.

Keep these strings (`/rpc`, `?t=`, `coach-token`, `coach-state`,
`coach:disconnected`, `coach-roadmap-banner`) identical in later plans.

### One deviation from the spec's code sketch (deliberate, solves a real test problem)

The spec sketch ends with a bare `installShim();` (line 221). Imported by the
vitest suite, that would self-execute **at module load** — before any test sets up
the DOM or the mock WebSocket, and only once (module cache), so tests could not
re-run it per-case with different DOM. This plan guards the self-exec:

```ts
if (typeof process === 'undefined') installShim();
```

In the esbuild **browser** bundle `process` is undefined (esbuild's browser
target leaves `typeof process` intact and injects no `process` global), so the
shim self-executes exactly as the spec intends. Under **vitest** the module runs
on Node, where `process` is defined, so the import is inert and each test calls
`installShim()` itself. This is the only change to the sketch; the runtime
behavior in the browser is identical. (The browser-only self-exec path is
therefore not unit-tested — that boot path is exercised by the Playwright smoke
layer in `08-testing`.)

## File Structure

| Path | Responsibility | Created/edited by |
|------|----------------|-------------------|
| `src/standalone/webview-shim.ts` | The shim: `BANNER_WORTHY` set, `installShim()` (token read/validate, `acquireVsCodeApi` factory with outbound FIFO + `localStorage` state, WebSocket connect/open-drain), inbound forwarding, reconnect/backoff, roadmap banner, guarded self-exec. | Task 1 (grown through Task 4) |
| `src/standalone/__tests__/webview-shim.test.ts` | jsdom unit tests + a manual `WebSocket` mock on `globalThis`. | Task 1 (grown through Task 4) |

No other files are created or modified. `src/standalone/` already exists from the
earlier plans (or is created implicitly by the first new file path). The test path
matches the existing vitest `include: ['src/**/*.test.ts']` in
`vitest.config.mts`, so **no config change is needed**; the file selects the jsdom
environment with its own docblock.

## Conventions to copy (already in the repo)

- **Per-file jsdom environment via docblock.** `src/webview/webview-smoke.test.ts`
  selects jsdom with a top-of-file JSDoc block — copy that exact form so the global
  `environment: 'node'` default is overridden only for this file:

  ```ts
  /**
   * @vitest-environment jsdom
   */
  ```

- **Stubbing `acquireVsCodeApi` is unnecessary here** — `webview-smoke.test.ts`
  stubs it because it imports `./shared` (which calls it at load); this test
  imports the shim, which *defines* it.
- vitest imports come from `'vitest'`:
  `import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';`
- Single test file run: `npx vitest run <path>`; full suite: `npm test`
  (`npm test` is `vitest run`, see `package.json:86`).
- Strict TS, named exports only, kebab-case filenames under `src/standalone/`,
  comments only where the *why* is non-obvious.

### jsdom globals this test relies on (all provided by `jsdom@29.1.1`)

`document`, `window`, `window.postMessage`, `window.dispatchEvent`, `Event`,
`localStorage`, `location` (default URL `http://localhost:3000/`, so
`location.host === 'localhost:3000'`). `WebSocket` is **mocked** by the test
(attached to `globalThis`), never jsdom's real one — the shim reads the global
`WebSocket.OPEN` constant and constructs `new WebSocket(url)`, both of which the
mock supplies.

### Preconditions

If `node_modules/` is empty, run `npm install` once (vitest + jsdom must be
present). The plan assumes the baseline upstream suite is green (`npm test`) before
any changes; a pre-existing red suite is an escalation, not something this plan
introduces.

---

## Task 1: Registration, token, outbound buffer + `localStorage` state

Creates the module with `BANNER_WORTHY`, the synchronous `acquireVsCodeApi`
polyfill (outbound FIFO buffer + `getState`/`setState`), token read/validation,
and a `connect()` that opens the socket and drains the buffer on `open`. Covers
spec behaviors #0, #1, #2, #3, #5 and acceptance #1, #2, #3.

**Files:**
- Create: `src/standalone/webview-shim.ts`
- Create: `src/standalone/__tests__/webview-shim.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/standalone/__tests__/webview-shim.test.ts`:

```ts
/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BANNER_WORTHY, installShim } from '../webview-shim';

const VALID_TOKEN = 'a'.repeat(64); // 64 hex chars

// Manual WebSocket mock attached to globalThis. The shim reads `WebSocket.OPEN`
// and constructs `new WebSocket(url)`; this supplies both, plus drivers
// (open/message/triggerClose) so tests fire socket events deterministically.
class MockWebSocket {
  static OPEN = 1;
  static instances: MockWebSocket[] = [];
  readyState = 0; // CONNECTING
  sent: string[] = [];
  url: string;
  private listeners: Record<string, Array<(ev: unknown) => void>> = {};

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
  addEventListener(type: string, fn: (ev: unknown) => void): void {
    (this.listeners[type] ??= []).push(fn);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
  }
  private fire(type: string, ev?: unknown): void {
    for (const fn of this.listeners[type] ?? []) fn(ev);
  }
  // --- test drivers ---
  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.fire('open');
  }
  message(data: string): void {
    this.fire('message', { data });
  }
  triggerClose(): void {
    this.readyState = 3;
    this.fire('close');
  }
}

function setMeta(content: string): void {
  const meta = document.createElement('meta');
  meta.setAttribute('name', 'coach-token');
  meta.setAttribute('content', content);
  document.head.appendChild(meta);
}

function installWithToken(token: string = VALID_TOKEN): void {
  setMeta(token);
  installShim();
}

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  localStorage.clear();
  delete (globalThis as { acquireVsCodeApi?: unknown }).acquireVsCodeApi;
  MockWebSocket.instances = [];
  (globalThis as { WebSocket?: unknown }).WebSocket = MockWebSocket;
  vi.spyOn(window, 'postMessage').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('BANNER_WORTHY', () => {
  it('contains the curated content-creation methods and excludes proactive ones', () => {
    expect(BANNER_WORTHY.has('createSkill')).toBe(true);
    expect(BANNER_WORTHY.has('installCatalogItem')).toBe(true);
    expect(BANNER_WORTHY.has('triageCatalog')).toBe(true);
    expect(BANNER_WORTHY.has('getRuleEditor')).toBe(true);
    expect(BANNER_WORTHY.has('triageSkills')).toBe(false); // proactive → silent
    expect(BANNER_WORTHY.has('getStats')).toBe(false); // allowed, not disabled
    expect(BANNER_WORTHY.size).toBe(10);
  });
});

describe('registration + token', () => {
  it('defines acquireVsCodeApi synchronously with the VS Code shape', () => {
    installWithToken();
    const factory = (globalThis as { acquireVsCodeApi?: () => unknown }).acquireVsCodeApi;
    expect(typeof factory).toBe('function');
    const api = factory!() as Record<string, unknown>;
    expect(typeof api.postMessage).toBe('function');
    expect(typeof api.getState).toBe('function');
    expect(typeof api.setState).toBe('function');
  });

  it('reads token from coach-token meta and opens ws with ?t=', () => {
    installWithToken();
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url).toBe(
      `ws://${location.host}/rpc?t=${VALID_TOKEN}`,
    );
  });

  it('missing token → no socket, warn, api still defined', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    installShim(); // no meta tag set
    expect(MockWebSocket.instances).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    expect(typeof (globalThis as { acquireVsCodeApi?: unknown }).acquireVsCodeApi).toBe(
      'function',
    );
  });

  it('non-hex token → no socket, warn, api still defined', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    installWithToken('not-a-valid-hex-token');
    expect(MockWebSocket.instances).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    expect(typeof (globalThis as { acquireVsCodeApi?: unknown }).acquireVsCodeApi).toBe(
      'function',
    );
  });
});

describe('outbound buffer + localStorage state', () => {
  it('buffers messages before open and drains on open (FIFO)', () => {
    installWithToken();
    const api = (globalThis as { acquireVsCodeApi: () => { postMessage(m: unknown): void } })
      .acquireVsCodeApi();
    const ws = MockWebSocket.instances[0];

    api.postMessage({ hello: 1 });
    expect(ws.sent).toEqual([]); // still CONNECTING → buffered

    ws.open();
    expect(ws.sent).toEqual(['{"hello":1}']);
  });

  it('drops oldest beyond the 100-entry buffer cap', () => {
    installWithToken();
    const api = (globalThis as { acquireVsCodeApi: () => { postMessage(m: unknown): void } })
      .acquireVsCodeApi();
    const ws = MockWebSocket.instances[0];

    for (let n = 0; n <= 100; n++) api.postMessage({ n }); // 101 messages, still CONNECTING
    ws.open();

    expect(ws.sent).toHaveLength(100);
    expect(JSON.parse(ws.sent[0]).n).toBe(1); // n:0 was dropped
    expect(JSON.parse(ws.sent[ws.sent.length - 1]).n).toBe(100);
  });

  it('getState/setState round-trip localStorage; getState null when absent', () => {
    installWithToken();
    const api = (
      globalThis as {
        acquireVsCodeApi: () => { getState(): unknown; setState(s: unknown): void };
      }
    ).acquireVsCodeApi();

    expect(api.getState()).toBeNull(); // nothing stored yet
    api.setState({ a: 1 });
    expect(localStorage.getItem('coach-state')).toBe('{"a":1}');
    expect(api.getState()).toEqual({ a: 1 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/standalone/__tests__/webview-shim.test.ts`
Expected: FAIL — `Failed to resolve import "../webview-shim"` (the source file does
not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/standalone/webview-shim.ts`. The `connect()` here registers only
`open` (drain + reset `attempt`) and `error`; the `message` and `close` handlers
are added in Tasks 2 and 3. The `declare global` block makes the
`globalThis.acquireVsCodeApi = …` assignment typecheck under strict:

```ts
// src/standalone/webview-shim.ts
// Browser-side polyfill. esbuild bundles this as a browser-target entrypoint to
// dist/standalone/standalone-shim.js (docs-fork/specs/07-build.md), loaded via
// <script src="/standalone-shim.js"> BEFORE app.js so acquireVsCodeApi exists
// when the unmodified webview bundle (shared.ts:9) calls it at module load.

declare global {
  // `var` (not let/const) so the assignment below augments globalThis under strict.
  // eslint-disable-next-line no-var
  var acquireVsCodeApi: () => {
    postMessage(msg: unknown): void;
    getState(): unknown;
    setState(s: unknown): void;
  };
}

// Curated set: only these disabled methods trigger the roadmap banner. Everything
// else disabled is silent (see docs-fork/specs/00-overview.md "Disabled-method UX").
export const BANNER_WORTHY: ReadonlySet<string> = new Set([
  'createSkill', 'generateSkillContent', 'generateLearningQuiz',
  'generateLearningResources', 'generateCodeComparison',
  'generateDidYouKnow', 'installSkill', 'installCatalogItem',
  'triageCatalog', 'getRuleEditor',
]);

export function installShim(): void {
  const token =
    document.querySelector('meta[name="coach-token"]')?.getAttribute('content') ?? '';

  const outbox: string[] = [];
  let ws: WebSocket | null = null;
  let attempt = 0;

  function connect(): void {
    ws = new WebSocket(`ws://${location.host}/rpc?t=${token}`);
    ws.addEventListener('open', () => {
      attempt = 0;
      while (outbox.length) ws!.send(outbox.shift()!);
    });
    ws.addEventListener('error', (e) => console.warn('[coach] ws error', e));
  }

  // Synchronous polyfill registration — before connect(), so app.js always loads
  // even when the token is missing (failure mode is RPC timeouts, not a blank page).
  globalThis.acquireVsCodeApi = () => ({
    postMessage: (msg: unknown) => {
      const frame = JSON.stringify(msg);
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(frame);
      else {
        if (outbox.length >= 100) outbox.shift(); // cap: drop oldest
        outbox.push(frame);
      }
    },
    getState: () => {
      try {
        return JSON.parse(localStorage.getItem('coach-state') || 'null');
      } catch {
        return null;
      }
    },
    setState: (s: unknown) => localStorage.setItem('coach-state', JSON.stringify(s)),
  });

  if (/^[0-9a-f]{64}$/.test(token)) connect();
  else console.warn('[coach] missing/invalid coach-token meta; RPC disabled');
}

// Self-execute only in the browser bundle. Under vitest the module runs on Node
// (process defined), so the import stays inert and tests drive installShim()
// directly. esbuild's browser target leaves `typeof process` intact and injects
// no `process` global, so this is true in the shipped bundle.
if (typeof process === 'undefined') installShim();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/standalone/__tests__/webview-shim.test.ts`
Expected: PASS — 7 tests passed (1 `BANNER_WORTHY` + 4 registration/token + 2 of
the outbound/state block… count: `defines`, `reads token`, `missing`, `non-hex`,
`buffers`, `drops oldest`, `getState/setState`, plus `BANNER_WORTHY` = **8 tests
passed**).

- [ ] **Step 5: Commit**

```bash
git add src/standalone/webview-shim.ts src/standalone/__tests__/webview-shim.test.ts
git commit -m "feat(standalone): add webview shim registration, token, outbound buffer"
```

---

## Task 2: Inbound frame forwarding + malformed-JSON guard

Adds the WebSocket `message` handler: JSON-parse each inbound frame and forward it
verbatim to `window.postMessage(frame, '*')`; on a parse error, `console.warn` and
drop the frame without throwing. Covers spec behaviors #4 and #8 and the test-plan
rows `forwards inbound frames to window.postMessage` and `ignores malformed JSON
frames`.

**Files:**
- Modify: `src/standalone/webview-shim.ts`
- Modify: `src/standalone/__tests__/webview-shim.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/standalone/__tests__/webview-shim.test.ts`:

```ts
describe('inbound forwarding', () => {
  it('forwards inbound frames to window.postMessage', () => {
    installWithToken();
    const ws = MockWebSocket.instances[0];
    const frame = { type: 'response', id: '1', data: { ok: 1 } };

    ws.message(JSON.stringify(frame));

    expect(window.postMessage).toHaveBeenCalledWith(frame, '*');
  });

  it('ignores malformed JSON frames (warn, no throw, no forward)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    installWithToken();
    const ws = MockWebSocket.instances[0];

    expect(() => ws.message('not json {')).not.toThrow();
    expect(warn).toHaveBeenCalled();
    expect(window.postMessage).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/standalone/__tests__/webview-shim.test.ts`
Expected: FAIL — `forwards inbound frames…` fails because `connect()` registers no
`message` listener yet, so firing `message` calls nothing and
`window.postMessage` is never invoked (`expected "spy" to be called with …`). The
8 Task-1 tests still pass.

- [ ] **Step 3: Write minimal implementation**

In `src/standalone/webview-shim.ts`, replace the `connect()` function with the
version below (adds the `message` listener between `open` and `error`):

```ts
  function connect(): void {
    ws = new WebSocket(`ws://${location.host}/rpc?t=${token}`);
    ws.addEventListener('open', () => {
      attempt = 0;
      while (outbox.length) ws!.send(outbox.shift()!);
    });
    ws.addEventListener('message', (ev) => {
      let frame: unknown;
      try {
        frame = JSON.parse(ev.data);
      } catch (e) {
        console.warn('[coach] bad frame', e);
        return;
      }
      window.postMessage(frame, '*'); // always forward; page handles data.error
    });
    ws.addEventListener('error', (e) => console.warn('[coach] ws error', e));
  }
```

`ev` is typed `MessageEvent` (WebSocket's event map), so `ev.data` resolves
without a cast.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/standalone/__tests__/webview-shim.test.ts`
Expected: PASS — 10 tests passed (8 + 2).

- [ ] **Step 5: Commit**

```bash
git add src/standalone/webview-shim.ts src/standalone/__tests__/webview-shim.test.ts
git commit -m "feat(standalone): forward inbound ws frames to window.postMessage"
```

---

## Task 3: Reconnect with exponential backoff + `coach:disconnected`

Adds the `close` handler: null the socket, increment `attempt`, dispatch
`coach:disconnected` on `window` once `attempt >= 5`, and schedule a reconnect at
`min(250 × 2^attempt, 30000)` ms. The `open` handler (Task 1) already resets
`attempt` to 0, so a successful reconnect clears the backoff. Covers spec
behaviors #6 and #7, acceptance #4 and #5, and the test-plan rows
`reconnect uses exponential backoff capped at 30 s`,
`dispatches coach:disconnected after 5 close events`, and
`resets backoff counter on successful open`.

**Files:**
- Modify: `src/standalone/webview-shim.ts`
- Modify: `src/standalone/__tests__/webview-shim.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/standalone/__tests__/webview-shim.test.ts`. These use fake timers to
drive the `setTimeout`-scheduled reconnects deterministically:

```ts
describe('reconnect', () => {
  beforeEach(() => vi.useFakeTimers());
  // afterEach's vi.useRealTimers() (top-level) restores real timers.

  it('reconnect uses exponential backoff capped at 30 s', () => {
    installWithToken();
    expect(MockWebSocket.instances).toHaveLength(1);

    // 1st close → attempt 1 → reconnect after 250 * 2^1 = 500 ms.
    MockWebSocket.instances.at(-1)!.triggerClose();
    vi.advanceTimersByTime(499);
    expect(MockWebSocket.instances).toHaveLength(1); // not yet
    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(2); // reconnected at 500 ms

    // Drive attempt up; advancing the full 30 s cap always fires the pending timer.
    for (let i = 0; i < 6; i++) {
      MockWebSocket.instances.at(-1)!.triggerClose();
      vi.advanceTimersByTime(30_000);
    }
    // attempt is now 7; the next close schedules min(250 * 2^8, 30000) = 30000 ms.
    const before = MockWebSocket.instances.length;
    MockWebSocket.instances.at(-1)!.triggerClose();
    vi.advanceTimersByTime(29_999);
    expect(MockWebSocket.instances).toHaveLength(before); // capped: not yet
    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(before + 1); // fires at exactly 30 s
  });

  it('dispatches coach:disconnected exactly once after 5 close events', () => {
    const onDisc = vi.fn();
    window.addEventListener('coach:disconnected', onDisc);
    installWithToken();

    for (let i = 0; i < 5; i++) {
      MockWebSocket.instances.at(-1)!.triggerClose();
      vi.advanceTimersByTime(30_000); // fire the reconnect → fresh socket to close next
    }

    expect(onDisc).toHaveBeenCalledTimes(1); // only attempt === 5 dispatches
    window.removeEventListener('coach:disconnected', onDisc);
  });

  it('resets backoff counter on successful open', () => {
    installWithToken();
    MockWebSocket.instances.at(-1)!.triggerClose(); // attempt 1 → schedule 500 ms
    vi.advanceTimersByTime(500); // reconnect → instance #2
    MockWebSocket.instances.at(-1)!.open(); // open resets attempt to 0
    MockWebSocket.instances.at(-1)!.triggerClose(); // attempt back to 1 → schedule 500 ms

    const before = MockWebSocket.instances.length;
    vi.advanceTimersByTime(499);
    expect(MockWebSocket.instances).toHaveLength(before); // not 1000 ms → reset worked
    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(before + 1); // reconnected at 500 ms
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/standalone/__tests__/webview-shim.test.ts`
Expected: FAIL — `connect()` registers no `close` listener, so `triggerClose()`
schedules nothing: no reconnect ever happens (instance count stays 1) and
`coach:disconnected` never fires. The 10 earlier tests still pass.

- [ ] **Step 3: Write minimal implementation**

In `src/standalone/webview-shim.ts`, replace `connect()` again to add the `close`
listener (between `message` and `error`):

```ts
  function connect(): void {
    ws = new WebSocket(`ws://${location.host}/rpc?t=${token}`);
    ws.addEventListener('open', () => {
      attempt = 0;
      while (outbox.length) ws!.send(outbox.shift()!);
    });
    ws.addEventListener('message', (ev) => {
      let frame: unknown;
      try {
        frame = JSON.parse(ev.data);
      } catch (e) {
        console.warn('[coach] bad frame', e);
        return;
      }
      window.postMessage(frame, '*'); // always forward; page handles data.error
    });
    ws.addEventListener('close', () => {
      ws = null;
      attempt += 1;
      if (attempt >= 5) window.dispatchEvent(new Event('coach:disconnected'));
      setTimeout(connect, Math.min(250 * 2 ** attempt, 30000));
    });
    ws.addEventListener('error', (e) => console.warn('[coach] ws error', e));
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/standalone/__tests__/webview-shim.test.ts`
Expected: PASS — 13 tests passed (10 + 3).

- [ ] **Step 5: Commit**

```bash
git add src/standalone/webview-shim.ts src/standalone/__tests__/webview-shim.test.ts
git commit -m "feat(standalone): reconnect ws with capped backoff and disconnected event"
```

---

## Task 4: Roadmap banner for `BANNER_WORTHY` disabled methods

Adds the idempotent sticky banner. `showRoadmapBanner()` injects (once) a fixed
`#coach-roadmap-banner` element with the mandated copy, an inline `style`
attribute, and a close button; repeat calls only refresh its `data-ts` timestamp.
The `message` handler inspects each frame **before** forwarding and shows the
banner only when `frame.data.code === 'standalone-v1-disabled'` **and**
`frame.data.method ∈ BANNER_WORTHY`. Covers spec behavior #9 and acceptance #6 and
the test-plan rows `banners a BANNER_WORTHY disabled method`,
`does NOT banner a silent-disabled method`,
`banner close button removes the element`, and
`repeated disabled responses do not stack banners`.

**Files:**
- Modify: `src/standalone/webview-shim.ts`
- Modify: `src/standalone/__tests__/webview-shim.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/standalone/__tests__/webview-shim.test.ts`:

```ts
describe('roadmap banner', () => {
  const BANNER_ID = '#coach-roadmap-banner';

  function disabledFrame(method: string) {
    return {
      type: 'response',
      id: '7',
      data: { error: `'${method}' is disabled in standalone v1`, code: 'standalone-v1-disabled', method },
    };
  }

  it('banners a BANNER_WORTHY disabled method (and still forwards the frame)', () => {
    installWithToken();
    const ws = MockWebSocket.instances[0];
    const frame = disabledFrame('createSkill');

    ws.message(JSON.stringify(frame));

    expect(document.querySelector(BANNER_ID)).not.toBeNull();
    expect(window.postMessage).toHaveBeenCalledWith(frame, '*'); // forwarded too
  });

  it('does NOT banner a silent-disabled method (but still forwards it)', () => {
    installWithToken();
    const ws = MockWebSocket.instances[0];
    const frame = disabledFrame('triageSkills');

    ws.message(JSON.stringify(frame));

    expect(document.querySelector(BANNER_ID)).toBeNull();
    expect(window.postMessage).toHaveBeenCalledWith(frame, '*');
  });

  it('banner close button removes the element', () => {
    installWithToken();
    MockWebSocket.instances[0].message(JSON.stringify(disabledFrame('createSkill')));

    const button = document.querySelector<HTMLButtonElement>(`${BANNER_ID} button`);
    expect(button).not.toBeNull();
    button!.click();

    expect(document.querySelector(BANNER_ID)).toBeNull();
  });

  it('repeated disabled responses do not stack banners', () => {
    installWithToken();
    const ws = MockWebSocket.instances[0];

    ws.message(JSON.stringify(disabledFrame('createSkill')));
    ws.message(JSON.stringify(disabledFrame('installSkill')));

    expect(document.querySelectorAll(BANNER_ID)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/standalone/__tests__/webview-shim.test.ts`
Expected: FAIL — the message handler does not inspect frames yet, so
`document.querySelector('#coach-roadmap-banner')` is `null` for the
`banners a BANNER_WORTHY…`, `banner close button…`, and `repeated…` tests. The
`does NOT banner…` test passes (banner stays absent) but the three positive ones
fail. The 13 earlier tests still pass.

- [ ] **Step 3: Write minimal implementation**

In `src/standalone/webview-shim.ts`, (a) add the `showRoadmapBanner()` helper
nested in `installShim` (place it just above `connect`), and (b) add the banner
check to the `message` handler.

Add `showRoadmapBanner` (insert immediately before `function connect()`):

```ts
  function showRoadmapBanner(): void {
    const ID = 'coach-roadmap-banner';
    let banner = document.getElementById(ID);
    if (!banner) {
      banner = document.createElement('div');
      banner.id = ID;
      // Inline style: CSP allows style-src 'unsafe-inline' (see 00-overview).
      banner.setAttribute(
        'style',
        'position:fixed;bottom:0;left:0;right:0;z-index:99999;display:flex;' +
          'justify-content:space-between;align-items:center;gap:12px;' +
          'padding:12px 16px;background:#1e1e1e;color:#fff;' +
          'font:13px/1.4 sans-serif;border-top:1px solid #444;',
      );
      const text = document.createElement('span');
      text.textContent =
        'This feature is coming to standalone in v2. Today it lives in the VS Code extension.';
      const close = document.createElement('button');
      close.textContent = '×'; // multiplication sign as the dismiss glyph
      close.setAttribute('aria-label', 'Dismiss');
      close.setAttribute(
        'style',
        'background:none;border:none;color:#fff;font-size:18px;cursor:pointer;',
      );
      const el = banner;
      close.addEventListener('click', () => el.remove());
      banner.append(text, close);
      document.body.appendChild(banner);
    }
    banner.dataset.ts = String(Date.now()); // idempotent: refresh timestamp, never stack
  }
```

Then replace the `message` listener body inside `connect()` so it inspects the
frame before forwarding (the rest of `connect()` is unchanged from Task 3):

```ts
    ws.addEventListener('message', (ev) => {
      let frame: unknown;
      try {
        frame = JSON.parse(ev.data);
      } catch (e) {
        console.warn('[coach] bad frame', e);
        return;
      }
      // Banner decision lives here — the shim is the only place that sees every frame.
      const f = frame as { data?: { code?: string; method?: string } };
      if (f.data?.code === 'standalone-v1-disabled' && BANNER_WORTHY.has(f.data.method ?? '')) {
        showRoadmapBanner();
      }
      window.postMessage(frame, '*'); // always forward; page handles data.error
    });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/standalone/__tests__/webview-shim.test.ts`
Expected: PASS — 17 tests passed (13 + 4).

- [ ] **Step 5: Commit**

```bash
git add src/standalone/webview-shim.ts src/standalone/__tests__/webview-shim.test.ts
git commit -m "feat(standalone): inject idempotent roadmap banner for disabled v1 methods"
```

---

## Task 5: Full-suite run, type-check, and additive-only verification

Confirms the new module passes the whole project runner, type-checks under strict,
and respects the fork's additive-only discipline (`00-overview.md` →
"Additive-only fork discipline"; global acceptance #11).

**Files:** none (verification only).

- [ ] **Step 1: Run the full vitest suite**

Run: `npm test`
Expected: PASS — the whole suite is green, including the 17 new
`src/standalone/__tests__/webview-shim.test.ts` cases. No pre-existing suite
regresses (this module is additive and imports nothing from the rest of the app).
If a pre-existing test now fails, stop and investigate.

- [ ] **Step 2: TypeScript strict check**

Run: `npx tsc --noEmit`
Expected: no errors. Confirms the `declare global { var acquireVsCodeApi }`
augmentation, the DOM globals (`document`/`window`/`WebSocket`/`localStorage`/
`Event`), and the `frame as { data?: … }` cast all hold under the repo's strict
config (which includes the DOM lib by default for `target: ES2022`).

- [ ] **Step 3: Verify additive-only fork discipline (src/)**

Run: `git diff upstream/main -- src/ | grep -E '^[-+]' | grep -vE '^[-+]{3}'`
Expected: every line is an addition (`+`) inside `src/standalone/`. The only new
`src/` files from this spec are `webview-shim.ts` and
`__tests__/webview-shim.test.ts`. No deletions and no edits outside
`src/standalone/`.
(If `upstream/main` is not fetched in this clone: `git fetch upstream`. The
`upstream` remote is already configured —
`https://github.com/microsoft/AI-Engineering-Coach.git`.)

- [ ] **Step 4: Confirm this spec touched no shared config files**

Run: `git diff upstream/main -- package.json esbuild.mjs vitest.config.mts`
Expected: **empty** for this spec's work. Unlike `02-dispatcher`, the shim adds no
dependency and needs no vitest-config change (its jsdom environment comes from the
per-file docblock). The esbuild browser entry and the served `/standalone-shim.js`
path belong to `07-build` and `01-server`, not here.

- [ ] **Step 5: Confirm no `vscode` import crept in**

Run: `grep -rn "vscode" src/standalone/webview-shim.ts src/standalone/__tests__/webview-shim.test.ts`
Expected: no matches. The shim is pure browser code; the standalone `vscode-stub`
alias does not apply to it.

- [ ] **Step 6: Final commit (only if Steps 1–5 required a fix)**

If Steps 1–5 surfaced nothing, there is nothing to commit. If a fix was needed:

```bash
git add src/standalone/
git commit -m "test(standalone): verify webview shim passes full suite and additive checks"
```

---

## Acceptance criteria mapping (self-review)

Every acceptance criterion in `docs-fork/specs/04-webview-shim.md` maps to a task/test:

| Spec acceptance criterion | Task | Test |
|---------------------------|------|------|
| 1. Valid meta → `acquireVsCodeApi` defined, returns `{postMessage,getState,setState}` | Task 1 | `defines acquireVsCodeApi synchronously with the VS Code shape` |
| 2. Missing/non-hex meta → still defines `acquireVsCodeApi`, no socket, warn | Task 1 | `missing token → no socket, warn, api still defined`; `non-hex token → no socket, warn, api still defined` |
| 3. `postMessage({hello:1})` before open, then open → mock received `'{"hello":1}'` | Task 1 | `buffers messages before open and drains on open (FIFO)` |
| 4. Five `close` events → exactly one `coach:disconnected` | Task 3 | `dispatches coach:disconnected exactly once after 5 close events` |
| 5. `close`/`open` cycle resets backoff (short interval to next reconnect) | Task 3 | `resets backoff counter on successful open` |
| 6. `data.method ∈ BANNER_WORTHY` → banner appended; not in set → no banner; both still forwarded | Task 4 | `banners a BANNER_WORTHY disabled method (and still forwards the frame)`; `does NOT banner a silent-disabled method (but still forwards it)` |

Spec **behaviors** (0–9) coverage: token read + validate (#0, Task 1);
synchronous polyfill registration (#1, Task 1); WebSocket connect at eval time
(#2, Task 1); outbound buffer + drain + cap (#3, Task 1); inbound forwarding
(#4, Task 2); `getState`/`setState` (#5, Task 1); reconnect with backoff +
`coach:disconnected` (#6, Task 3); backoff reset on open (#7, Task 3);
errors → `console.warn` only, no alerts/reload (#8 — Task 2's malformed-frame
warn, Task 1's `error`/missing-token warns; no `alert`/`location.reload` appears
anywhere in the source); roadmap banner for banner-worthy disabled methods
(#9, Task 4).

Spec **test-plan** coverage — all 15 named rows are present:
`reads token from coach-token meta` (Task 1, `reads token from coach-token meta and opens ws with ?t=`),
`missing token → no socket, warn, api still defined` (Task 1),
`defines acquireVsCodeApi synchronously` (Task 1),
`buffers messages before open and drains on open` (Task 1),
`drops oldest beyond buffer cap` (Task 1),
`forwards inbound frames to window.postMessage` (Task 2),
`getState/setState round-trip localStorage` (Task 1),
`reconnect uses exponential backoff capped at 30 s` (Task 3),
`dispatches coach:disconnected after 5 close events` (Task 3),
`resets backoff counter on successful open` (Task 3),
`ignores malformed JSON frames` (Task 2),
`banners a BANNER_WORTHY disabled method` (Task 4),
`does NOT banner a silent-disabled method` (Task 4),
`banner close button removes the element` (Task 4),
`repeated disabled responses do not stack banners` (Task 4).

Two **extra** tests beyond the spec's 15, each pinning a contract:
`BANNER_WORTHY contains the curated content-creation methods and excludes proactive ones`
(Task 1 — drift guard on the exported set, size 10) and the `non-hex token`
branch (Task 1 — completes acceptance #2's "missing **or** non-hex").

**Type-consistency check:** `installShim` and `BANNER_WORTHY` are the module's only
exports, spelled identically in source and tests. The string contracts —
`/rpc`, `?t=`, `coach-token` (meta name), `coach-state` (localStorage key),
`coach:disconnected` (event), `coach-roadmap-banner` (element id) — are written
identically everywhere they appear; later plans (`01-server`, `03-standalone-html`,
`07-build`) must reuse these exact strings. The banner copy string matches the
spec verbatim: *"This feature is coming to standalone in v2. Today it lives in the
VS Code extension."* `BANNER_WORTHY`'s 10 members match the `00-overview` /
`04-webview-shim` lists exactly.

**Placeholder scan:** no TBD/TODO/"handle edge cases"/"similar to" — every code
step shows complete, compilable code (the full `connect()` is re-shown at each
task that changes it, so a worker reading tasks out of order never sees a partial
function); every run step shows the exact command and expected pass/fail output.

**Deviations from the spec text, all intentional and noted inline:**
- `installShim()` self-exec is guarded by `if (typeof process === 'undefined')`
  (the spec's bare `installShim()` would self-run at vitest import time and break
  per-test determinism). Browser behavior is unchanged. The browser-only boot path
  is covered by `08-testing`'s Playwright layer, not a jsdom unit test.
- The test selects jsdom via the per-file `@vitest-environment jsdom` docblock
  (matching `src/webview/webview-smoke.test.ts`) rather than a global vitest-config
  change — keeping this spec's footprint to two new files and zero shared edits.
- A `declare global { var acquireVsCodeApi }` block is added (absent from the
  sketch) so `globalThis.acquireVsCodeApi = …` typechecks under strict.
