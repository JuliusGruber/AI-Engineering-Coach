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
