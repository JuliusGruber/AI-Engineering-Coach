import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mockOs = vi.hoisted(() => ({
  homedir: vi.fn(),
}));

vi.mock('os', async () => {
  const actual = await vi.importActual('os');
  return {
    ...actual,
    homedir: mockOs.homedir,
  };
});

vi.mock('../dispatcher', () => ({ dispatch: vi.fn() }));

import * as net from 'net';
import { createServer, probeExistingInstance, resolveShimPath, resolveStandaloneWebviewRoot, resolveWebviewRoot, type ServerHandle } from '../server';
import { readServerState, writeServerState } from '../state';
import { WebSocket as WsClient } from 'ws';
import { dispatch } from '../dispatcher';
import type { Analyzer } from '../../core/analyzer';
import type { ParseResult } from '../../core/cache';

const mockedDispatch = vi.mocked(dispatch);

const fakeAnalyzer = {} as unknown as Analyzer;
const fakeParseResult = {} as unknown as ParseResult;

class Client {
  ws: WsClient;
  frames: Array<Record<string, unknown>> = [];
  private waiters: Array<{ pred: (f: Record<string, unknown>) => boolean; resolve: (f: Record<string, unknown>) => void }> = [];

  constructor(url: string) {
    this.ws = new WsClient(url);
    this.ws.on('message', (raw) => {
      const frame = JSON.parse(raw.toString()) as Record<string, unknown>;
      this.frames.push(frame);
      this.waiters = this.waiters.filter((w) => {
        if (w.pred(frame)) {
          w.resolve(frame);
          return false;
        }
        return true;
      });
    });
  }
  opened(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.once('open', () => resolve());
      this.ws.once('error', reject);
    });
  }
  closedCode(): Promise<number> {
    return new Promise((resolve) => this.ws.once('close', (code) => resolve(code)));
  }
  send(obj: unknown): void {
    this.ws.send(JSON.stringify(obj));
  }
  sendRaw(text: string): void {
    this.ws.send(text);
  }
  waitFor(pred: (f: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> {
    const hit = this.frames.find(pred);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve) => this.waiters.push({ pred, resolve }));
  }
  close(): void {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

function wsUrl(h: ServerHandle, token?: string): string {
  const base = `ws://127.0.0.1:${h.port}/rpc`;
  return token === undefined ? base : `${base}?t=${token}`;
}

const ASSET_NAME = '__coach_test_asset__.js';
const assetPath = path.join(resolveWebviewRoot(), ASSET_NAME);
const shimPath = resolveShimPath();
let createdAsset = false;
let createdShim = false;

beforeAll(() => {
  fs.mkdirSync(resolveWebviewRoot(), { recursive: true });
  if (!fs.existsSync(assetPath)) {
    fs.writeFileSync(assetPath, 'export const COACH_TEST_ASSET = 1;\n');
    createdAsset = true;
  }
  fs.mkdirSync(path.dirname(shimPath), { recursive: true });
  if (!fs.existsSync(shimPath)) {
    fs.writeFileSync(shimPath, '/* coach test shim */\n');
    createdShim = true;
  }
});

afterAll(() => {
  if (createdAsset) fs.rmSync(assetPath, { force: true });
  if (createdShim) fs.rmSync(shimPath, { force: true });
});

let tmpHome: string;
const handles: ServerHandle[] = [];

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-srv-'));
  mockOs.homedir.mockReturnValue(tmpHome);
  mockedDispatch.mockReset(); // clear call history + queued once-results between tests
});

afterEach(async () => {
  for (const h of handles.splice(0)) await h.close();
  vi.restoreAllMocks();
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

// Each instance gets a unique port: Node's global fetch (undici) pools keep-alive
// sockets by host:port, so reusing the default port across torn-down servers would
// hand a later test a dead pooled socket. Distinct ports keep every test isolated.
let nextPort = 17331;
async function start(): Promise<ServerHandle> {
  const h = await createServer({ port: nextPort++ });
  handles.push(h);
  return h;
}

function origin(h: ServerHandle): string {
  return `http://127.0.0.1:${h.port}`;
}

describe('resolveStandaloneWebviewRoot', () => {
  it('points at dist/standalone/webview under the project root', () => {
    const root = resolveStandaloneWebviewRoot();
    expect(root.endsWith(path.join('dist', 'standalone', 'webview'))).toBe(true);
    // It is a sibling of the shared webview root, one level deeper under dist/standalone.
    expect(root).toContain(path.join('dist', 'standalone'));
    expect(resolveWebviewRoot().endsWith(path.join('dist', 'webview'))).toBe(true);
  });
});

describe('HTTP routes', () => {
  it('serves /health without auth', async () => {
    const h = await start();
    const res = await fetch(`${origin(h)}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; app: string; version: string; pid: number };
    expect(body.ok).toBe(true);
    expect(body.app).toBe('ai-engineer-coach');
    expect(typeof body.version).toBe('string');
    expect(body.version.length).toBeGreaterThan(0);
    expect(body.pid).toBe(process.pid);
  });

  it('requires the token on GET / (401 without, 200 with)', async () => {
    const h = await start();
    expect((await fetch(`${origin(h)}/`)).status).toBe(401);
    const ok = await fetch(h.url); // h.url already carries ?t=<token>
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain('<!DOCTYPE html>');
  });

  it('sets the coach_token cookie and CSP header on first GET /', async () => {
    const h = await start();
    const res = await fetch(h.url);
    expect(res.headers.get('set-cookie')).toContain('coach_token=');
    expect(res.headers.get('content-security-policy')).toContain("script-src 'self'");
  });

  it('serves a static asset with the token', async () => {
    const h = await start();
    const res = await fetch(`${origin(h)}/dist/webview/${ASSET_NAME}?t=${h.token}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
  });

  it('serves /standalone-shim.js with the token, 401 without', async () => {
    const h = await start();
    expect((await fetch(`${origin(h)}/standalone-shim.js`)).status).toBe(401);
    const res = await fetch(`${origin(h)}/standalone-shim.js?t=${h.token}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
  });

  it('returns 404 for an unknown route', async () => {
    const h = await start();
    expect((await fetch(`${origin(h)}/nope?t=${h.token}`)).status).toBe(404);
  });
});

describe('WebSocket protocol', () => {
  it('rejects a connection without a token (close 4001)', async () => {
    const h = await start();
    const client = new Client(wsUrl(h)); // no ?t=
    expect(await client.closedCode()).toBe(4001);
  });

  it('dispatches an allowed method round-trip', async () => {
    mockedDispatch.mockResolvedValueOnce({ ok: true, data: { value: 42 } });
    const h = await start();
    const client = new Client(wsUrl(h, h.token));
    await client.opened();

    client.send({ type: 'request', id: 'x', method: 'getStats', params: { a: 1 } });
    const res = await client.waitFor((f) => f.type === 'response' && f.id === 'x');

    expect(res).toEqual({ type: 'response', id: 'x', data: { value: 42 } });
    expect(mockedDispatch).toHaveBeenCalledWith('getStats', { a: 1 }, expect.any(Object));
    client.close();
  });

  it('nests a disabled-method error inside data, with no sibling error field', async () => {
    mockedDispatch.mockResolvedValueOnce({
      ok: false,
      error: { code: 'standalone-v1-disabled', method: 'reviewLocalRules' },
    });
    const h = await start();
    const client = new Client(wsUrl(h, h.token));
    await client.opened();

    client.send({ type: 'request', id: 'y', method: 'reviewLocalRules' });
    const res = await client.waitFor((f) => f.type === 'response' && f.id === 'y');

    const data = res.data as { error?: unknown; code?: unknown; method?: unknown };
    expect(typeof data.error).toBe('string');
    expect(data.error).toBeTruthy();
    expect(data.code).toBe('standalone-v1-disabled');
    expect(data.method).toBe('reviewLocalRules');
    expect('error' in res).toBe(false); // never a sibling field
    client.close();
  });

  it('answers bad JSON with a bad-request error inside data (id null)', async () => {
    const h = await start();
    const client = new Client(wsUrl(h, h.token));
    await client.opened();

    client.sendRaw('not json {');
    const res = await client.waitFor((f) => f.type === 'response');

    expect(res).toEqual({ type: 'response', id: null, data: { error: 'invalid json', code: 'bad-request' } });
    expect(mockedDispatch).not.toHaveBeenCalled();
    client.close();
  });

  it('answers a malformed envelope with a bad-request error', async () => {
    const h = await start();
    const client = new Client(wsUrl(h, h.token));
    await client.opened();

    client.send({ type: 'notrequest', id: 'z' });
    const res = await client.waitFor((f) => f.type === 'response');

    const data = res.data as { code?: unknown };
    expect(res.id).toBe('z');
    expect(data.code).toBe('bad-request');
    client.close();
  });
});

describe('dataReady and broadcast', () => {
  it('sends dataReady on connect when data is already present', async () => {
    const h = await start();
    h.setData(fakeAnalyzer, fakeParseResult); // no sockets yet — just flips present

    const client = new Client(wsUrl(h, h.token));
    await client.opened();
    const frame = await client.waitFor((f) => f.type === 'dataReady');

    expect(frame).toEqual({ type: 'dataReady', currentWorkspace: '' });
    client.close();
  });

  it('broadcasts dataReady to already-open sockets when setData runs', async () => {
    const h = await start();
    const client = new Client(wsUrl(h, h.token));
    await client.opened();
    // Not present yet → no dataReady on connect.

    h.setData(fakeAnalyzer, fakeParseResult);
    const frame = await client.waitFor((f) => f.type === 'dataReady');

    expect(frame).toEqual({ type: 'dataReady', currentWorkspace: '' });
    client.close();
  });

  it('forwards a broadcast progress frame to every open socket', async () => {
    const h = await start();
    const a = new Client(wsUrl(h, h.token));
    const b = new Client(wsUrl(h, h.token));
    await Promise.all([a.opened(), b.opened()]);

    h.broadcast({ type: 'progress', pct: 42 });

    expect(await a.waitFor((f) => f.type === 'progress')).toEqual({ type: 'progress', pct: 42 });
    expect(await b.waitFor((f) => f.type === 'progress')).toEqual({ type: 'progress', pct: 42 });
    a.close();
    b.close();
  });
});

describe('single-instance probe and lifecycle', () => {
  it('probeExistingInstance returns the URL for a live instance', async () => {
    const h = await start(); // writes server-state.json (real pid) and serves /health
    const url = await probeExistingInstance(h.port);
    expect(url).toBe(h.url);
  });

  it('probeExistingInstance returns null and clears state for a dead pid', async () => {
    writeServerState({
      version: 1,
      port: 7399,
      token: 'a'.repeat(64),
      pid: 999_999, // not a live process → process.kill(pid, 0) throws
      startedAt: new Date().toISOString(),
    });
    expect(await probeExistingInstance(7399)).toBeNull();
    expect(readServerState()).toBeNull(); // stale state cleaned up
  });

  it('close() removes server-state.json and frees the port', async () => {
    const h = await createServer({});
    expect(readServerState()).not.toBeNull();
    const port = h.port;

    await h.close();
    expect(readServerState()).toBeNull();

    // Port is bindable again within 1 s.
    await new Promise<void>((resolve, reject) => {
      const probe = net.createServer();
      probe.once('error', reject);
      probe.listen(port, '127.0.0.1', () => probe.close(() => resolve()));
    });
  });

  it('throws with a --port hint when 7331..7340 are all taken', async () => {
    const listenSpy = vi
      .spyOn(net.Server.prototype, 'listen')
      .mockImplementation(function (this: net.Server) {
        process.nextTick(() =>
          this.emit('error', Object.assign(new Error('addr in use'), { code: 'EADDRINUSE' })),
        );
        return this;
      });
    try {
      await expect(createServer({})).rejects.toThrow(/--port/);
    } finally {
      listenSpy.mockRestore();
    }
  });
});
