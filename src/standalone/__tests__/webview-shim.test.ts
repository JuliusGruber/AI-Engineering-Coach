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
    ws.message(JSON.stringify(disabledFrame('installSkill')));

    expect(document.querySelectorAll(BANNER_ID)).toHaveLength(1);
  });
});
