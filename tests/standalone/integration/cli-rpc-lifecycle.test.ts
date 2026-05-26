import { fork } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bootCli, makeTmpHome, stopCli, wsConnect, wsRequest, type Booted, CLI } from './helpers';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

function track(b: Booted, home: string): Booted {
  cleanups.push(async () => { await stopCli(b); fs.rmSync(home, { recursive: true, force: true }); });
  return b;
}

describe('cli rpc + lifecycle', () => {
  it('returns a data-nested error for a disabled method (no sibling error field)', async () => {
    const home = makeTmpHome();
    const b = track(await bootCli(home, ['--port', '7358']), home);
    const ws = await wsConnect(b);
    // saveRule ∉ V1_ALLOWED → tier-2 disabled, independent of data-ready (dispatcher).
    const res = await wsRequest(ws, 'saveRule', { name: 'x' }, 'd1');
    ws.close();
    expect(res).toMatchObject({
      type: 'response',
      id: 'd1',
      data: { code: 'standalone-v1-disabled', method: 'saveRule' },
    });
    expect(typeof (res.data as { error: unknown }).error).toBe('string');
    expect((res.data as { error: string }).error.length).toBeGreaterThan(0);
    expect('error' in res).toBe(false); // never a sibling field
  });

  it.runIf(process.platform === 'linux')(
    'runs native openExternal over WS before dataReady (fake xdg-open on PATH)',
    async () => {
      // open@10 resolves xdg-open via PATH on Linux; a fake one returns 0 without a browser.
      const home = makeTmpHome();
      const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-bin-'));
      fs.writeFileSync(path.join(binDir, 'xdg-open'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      const child = fork(CLI, ['--no-open', '--port', '7359'], {
        env: { ...process.env, HOME: home, USERPROFILE: home, PATH: `${binDir}${path.delimiter}${process.env.PATH}` },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });
      const b: Booted = await new Promise((resolve, reject) => {
        let buf = '';
        const t = setTimeout(() => reject(new Error(`no url; stderr:\n${buf}`)), 20_000);
        child.stderr!.on('data', (x: Buffer) => {
          buf += x.toString();
          const m = buf.match(/running at (http:\/\/127\.0\.0\.1:(\d+)\/\?t=([0-9a-f]{64}))/);
          if (m) { clearTimeout(t); resolve({ child, url: m[1], token: m[3], port: Number(m[2]), reused: false, stderr: () => buf }); }
        });
      });
      cleanups.push(async () => {
        await stopCli(b);
        fs.rmSync(home, { recursive: true, force: true });
        fs.rmSync(binDir, { recursive: true, force: true });
      });
      const ws = await wsConnect(b);
      const res = await wsRequest(ws, 'openExternal', { url: 'https://example.com' }, 'n1');
      ws.close();
      expect(res).toMatchObject({ type: 'response', id: 'n1', data: { ok: true } });
    },
  );

  it('reuses a live instance: the second invocation exits 0 without a second server', async () => {
    const home = makeTmpHome();
    const a = track(await bootCli(home, ['--port', '7355']), home);
    expect(a.reused).toBe(false);
    // Second boot, SAME home + port → sees server-state.json, reuses, prints + exits 0.
    const b = await bootCli(home, ['--port', '7355']);
    expect(b.reused).toBe(true);
    expect(b.stderr()).toContain('coach already running at');
    const code = await new Promise<number | null>((resolve) =>
      b.child.exitCode !== null ? resolve(b.child.exitCode) : b.child.once('exit', resolve),
    );
    expect(code).toBe(0);
  });

  it.skipIf(process.platform === 'win32')(
    'responds to SIGINT with exit 130 and clears server-state.json',
    async () => {
      const home = makeTmpHome();
      cleanups.push(() => fs.rmSync(home, { recursive: true, force: true }));
      const b = await bootCli(home, ['--port', '7356']);
      const stateFile = path.join(home, '.ai-engineer-coach', 'server-state.json');
      expect(fs.existsSync(stateFile)).toBe(true);
      const exited = new Promise<number | null>((resolve) => b.child.once('exit', resolve));
      b.child.kill('SIGINT');
      expect(await exited).toBe(130);
      expect(fs.existsSync(stateFile)).toBe(false); // close() → clearServerState()
    },
  );

  it('fails with a --port hint when 7331..7340 are all taken', async () => {
    // Occupy the whole retry range so listenWithRetry exhausts it (deviation #6).
    const probes: net.Server[] = [];
    cleanups.push(async () => {
      await Promise.all(probes.map((s) => new Promise<void>((r) => s.close(() => r()))));
    });
    for (let p = 7331; p <= 7340; p++) {
      await new Promise<void>((resolve, reject) => {
        const s = net.createServer();
        s.once('error', reject);
        s.listen(p, '127.0.0.1', () => { probes.push(s); resolve(); });
      });
    }
    const home = makeTmpHome();
    cleanups.push(() => fs.rmSync(home, { recursive: true, force: true }));
    // No --port → defaults to 7331 and retries 7331..7340, all taken → exit 1.
    const child = fork(CLI, ['--no-open'], {
      env: { ...process.env, HOME: home, USERPROFILE: home },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let buf = '';
    child.stderr!.on('data', (b: Buffer) => { buf += b.toString(); });
    const code = await new Promise<number | null>((resolve) => child.once('exit', resolve));
    expect(code).toBe(1); // bin/coach maps the rejected runCli to exit 1
    expect(buf).toMatch(/--port/);
  });
});
