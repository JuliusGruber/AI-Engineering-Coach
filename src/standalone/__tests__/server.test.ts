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

import { createServer, resolveShimPath, resolveWebviewRoot, type ServerHandle } from '../server';

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
