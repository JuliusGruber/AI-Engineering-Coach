/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BANNER_WORTHY, RESOLVE_EMPTY_WHEN_DISABLED, installShim } from '../webview-shim';

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
  window.location.hash = '';
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
  it('contains only createSkill after buckets D + B went live', () => {
    expect(BANNER_WORTHY.has('createSkill')).toBe(true);       // opens VS Code chat; still degraded
    expect(BANNER_WORTHY.has('installSkill')).toBe(false);     // bucket B: now bridged & live
    expect(BANNER_WORTHY.has('installCatalogItem')).toBe(false); // bucket B: now bridged & live
    expect(BANNER_WORTHY.has('getRuleEditor')).toBe(false);    // bucket B: now allowlisted & live
    expect(BANNER_WORTHY.has('triageCatalog')).toBe(false);    // bucket D
    expect(BANNER_WORTHY.has('getStats')).toBe(false);         // allowed, not disabled
    expect(BANNER_WORTHY.size).toBe(1);
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
    ws.message(JSON.stringify(disabledFrame('createSkill')));

    expect(document.querySelectorAll(BANNER_ID)).toHaveLength(1);
  });

  it('RESOLVE_EMPTY_WHEN_DISABLED is empty — getRuleEditor is allowlisted now (mechanism inert)', () => {
    expect(RESOLVE_EMPTY_WHEN_DISABLED.size).toBe(0);
    expect(RESOLVE_EMPTY_WHEN_DISABLED.has('getRuleEditor')).toBe(false);
  });

  it('forwards a non-RESOLVE_EMPTY banner method unchanged (it keeps rejecting)', () => {
    installWithToken();
    const ws = MockWebSocket.instances[0];
    const frame = disabledFrame('createSkill'); // banner-worthy but a user-action call

    ws.message(JSON.stringify(frame));

    expect(RESOLVE_EMPTY_WHEN_DISABLED.has('createSkill')).toBe(false);
    expect(window.postMessage).toHaveBeenCalledWith(frame, '*'); // original error frame
  });
});

describe('hash navigation bridge', () => {
  // Capture the data-page of any synthesized nav click (jsdom has no app.ts handler).
  function captureNav(): { page: () => string | undefined; stop: () => void } {
    let page: string | undefined;
    const onClick = (e: Event): void => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-page]');
      if (el) page = el.dataset.page;
    };
    document.addEventListener('click', onClick);
    return { page: () => page, stop: () => document.removeEventListener('click', onClick) };
  }

  it('hashchange synthesizes a [data-page] click for the hash id', () => {
    installWithToken();
    const nav = captureNav();
    window.location.hash = '#timeline';
    window.dispatchEvent(new Event('hashchange')); // drive deterministically
    expect(nav.page()).toBe('timeline');
    // the synthesized element is removed after the click (no DOM leak). We use <span>
    // (not <a>) so the click has no default navigation that would clear location.hash —
    // see navFromHash in webview-shim.ts.
    expect(document.querySelector('body > [data-page]')).toBeNull();
    nav.stop();
  });

  it('applies the URL hash after a dataReady frame, deferred to a macrotask (immediate when no RPCs are in flight)', () => {
    vi.useFakeTimers();
    window.location.hash = '#skills'; // set BEFORE install so no stray hashchange fires
    installWithToken();
    const nav = captureNav();
    const ws = MockWebSocket.instances[0];

    ws.message(JSON.stringify({ type: 'dataReady', currentWorkspace: '' }));
    expect(nav.page()).toBeUndefined(); // deferred — navigation waits for RPC quiescence
    vi.advanceTimersByTime(1); // no RPCs pending → quiescence check fires → navigate
    expect(nav.page()).toBe('skills');
    nav.stop();
  });

  it('does not navigate on dataReady when there is no hash', () => {
    vi.useFakeTimers();
    window.location.hash = '';
    installWithToken();
    const nav = captureNav();
    MockWebSocket.instances[0].message(JSON.stringify({ type: 'dataReady', currentWorkspace: '' }));
    vi.advanceTimersByTime(1);
    expect(nav.page()).toBeUndefined();
    nav.stop();
  });

  it('defers the deep-link nav until the default render\'s RPCs quiesce, then navigates exactly once (Task R2 render-race fix)', () => {
    // Regression for the warm-suite double-render clobber. Honouring a deep-link hash means a
    // SECOND page render (navFromHash) on top of app.ts's onDataReady → navigateTo('dashboard')
    // default render. Two page renders into the same #content overlap destructively: the
    // default render's late RPCs resolve during the deep-link page's await and rewrite #content,
    // null-derefing the deep-link page's post-await DOM (renderOutput #outputRange →
    // withErrorBoundary) and corrupting the shared Chart.js registry (shared.ts charts[] /
    // c.canvas.id). The shim is the sole RPC channel, so it holds the deep-link nav until the
    // default render's RPCs settle — then the deep-link render is the only in-flight render.
    vi.useFakeTimers();
    window.location.hash = '#output';
    installWithToken();
    // Drain the stray hashchange queued by assigning location.hash (a jsdom artifact; a real
    // page load carries the hash without firing hashchange). Capture nav only afterwards so the
    // quiescence deferral is what we measure, not the stray.
    vi.advanceTimersByTime(1);
    const nav = captureNav();
    const ws = MockWebSocket.instances[0];
    const api = (globalThis as { acquireVsCodeApi: () => { postMessage(m: unknown): void } })
      .acquireVsCodeApi();

    ws.message(JSON.stringify({ type: 'dataReady', currentWorkspace: '' }));
    // Simulate the default render's RPC burst (app.ts onDataReady issues these for real).
    api.postMessage({ type: 'request', id: 'r1', method: 'getStats' });
    api.postMessage({ type: 'request', id: 'r2', method: 'getDailyActivity' });

    vi.advanceTimersByTime(1);
    expect(nav.page()).toBeUndefined(); // RPCs in flight → must NOT navigate (would clobber)

    ws.message(JSON.stringify({ type: 'response', id: 'r1', data: {} }));
    vi.advanceTimersByTime(1);
    expect(nav.page()).toBeUndefined(); // one request still pending → still deferred

    ws.message(JSON.stringify({ type: 'response', id: 'r2', data: {} }));
    vi.advanceTimersByTime(1);
    expect(nav.page()).toBe('output'); // quiesced → deep-link applied, exactly once
    nav.stop();
  });
});

describe('warm-server dataReady race: defer delivery until app.js has executed', () => {
  // Capture the data-page of any synthesized nav click (jsdom has no app.ts handler).
  function captureNav(): { page: () => string | undefined; stop: () => void } {
    let page: string | undefined;
    const onClick = (e: Event): void => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-page]');
      if (el) page = el.dataset.page;
    };
    document.addEventListener('click', onClick);
    return { page: () => page, stop: () => document.removeEventListener('click', onClick) };
  }

  // Override document.readyState for one test, restoring the original descriptor after.
  function withReadyState(get: () => DocumentReadyState, fn: () => void): void {
    const own = Object.getOwnPropertyDescriptor(document, 'readyState');
    Object.defineProperty(document, 'readyState', { configurable: true, get });
    try {
      fn();
    } finally {
      if (own) Object.defineProperty(document, 'readyState', own);
      else delete (document as unknown as { readyState?: unknown }).readyState;
    }
  }

  it('buffers dataReady while the document is still loading, then delivers it on DOMContentLoaded', () => {
    vi.useFakeTimers();
    // Warm server (server.ts:182) pushes dataReady on connect. If it arrives before app.js
    // (the next classic <script>) has executed, app.ts has not yet installed its window
    // 'message' listener (shared.ts:57), so an immediate post would be dropped and the page
    // would never render — the exact smoke-suite race. Simulate that with readyState=loading.
    let state: DocumentReadyState = 'loading';
    withReadyState(() => state, () => {
      window.location.hash = '#skills';
      installWithToken();
      const nav = captureNav();
      const ws = MockWebSocket.instances[0];
      const frame = { type: 'dataReady', currentWorkspace: '' };

      ws.message(JSON.stringify(frame));
      // Must NOT have forwarded yet (app.ts isn't listening) and must NOT have navigated.
      // Assert BEFORE advancing timers — a timer advance here would fire the stray
      // hashchange queued by `location.hash = '#skills'` and navigate prematurely.
      expect(window.postMessage).not.toHaveBeenCalledWith(frame, '*');
      expect(nav.page()).toBeUndefined();

      // Parsing completes → app.js has executed → app.ts is listening. Deliver now.
      state = 'interactive';
      document.dispatchEvent(new Event('DOMContentLoaded'));
      expect(window.postMessage).toHaveBeenCalledWith(frame, '*');
      vi.advanceTimersByTime(1); // fire the deferred navFromHash
      expect(nav.page()).toBe('skills');
      nav.stop();
    });
  });

  it('delivers dataReady immediately when the document is already past loading (cold, no race)', () => {
    vi.useFakeTimers();
    // jsdom default readyState is 'complete' → app.ts already listening → forward at once.
    window.location.hash = '#skills';
    installWithToken();
    const nav = captureNav();
    const ws = MockWebSocket.instances[0];
    const frame = { type: 'dataReady', currentWorkspace: '' };

    ws.message(JSON.stringify(frame));
    expect(window.postMessage).toHaveBeenCalledWith(frame, '*');
    vi.advanceTimersByTime(1);
    expect(nav.page()).toBe('skills');
    nav.stop();
  });
});
