import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { bootCli, makeTmpHome, stopCli, wsConnect, wsWaitFor, type Booted, CLI } from './helpers';

const booted: Array<{ b: Booted; home: string }> = [];
async function boot(port: number, args: string[] = []): Promise<Booted> {
  const home = makeTmpHome();
  const b = await bootCli(home, ['--port', String(port), ...args]);
  booted.push({ b, home });
  return b;
}

afterEach(async () => {
  for (const { b, home } of booted.splice(0)) {
    await stopCli(b);
    fs.rmSync(home, { recursive: true, force: true });
  }
});

describe('cli bundle', () => {
  it('require()s in a bare node process without vscode (07-build AC 2a)', () => {
    // require.main !== module here, so the footer does NOT run runCli — this isolates
    // "the bundle LOADS", proving the esbuild vscode alias neutralized the transitive
    // top-level `import * as vscode`. cwd=tmpdir so no stray node_modules/vscode resolves.
    const out = execFileSync(
      process.execPath,
      ['-e', `require(${JSON.stringify(CLI)}); process.stdout.write('loaded');`],
      { encoding: 'utf8', cwd: os.tmpdir() },
    );
    expect(out).toContain('loaded');
  });
});

describe('cli boot lifecycle', () => {
  it('boots and serves /health with the documented payload', async () => {
    const b = await boot(7350);
    const res = await fetch(`http://127.0.0.1:${b.port}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; app: string; version: string; pid: number };
    expect(body.ok).toBe(true);
    expect(body.app).toBe('ai-engineer-coach');
    expect(typeof body.version).toBe('string');
    expect(body.version.length).toBeGreaterThan(0);
    expect(typeof body.pid).toBe('number');
  });

  it('serves the loading shell (GET / → 200 HTML) as soon as the URL is printed', async () => {
    // Serve-then-parse: createServer binds and the URL prints BEFORE bootstrapParse,
    // so GET / returns the HTML shell immediately (dataReady gates client rendering only).
    const b = await boot(7351);
    const res = await fetch(b.url); // b.url carries ?t=<token>
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<!DOCTYPE html>');
  });

  it('broadcasts dataReady over WS after the parse completes', async () => {
    const b = await boot(7352); // empty home → empty ParseResult → setData still fires
    const ws = await wsConnect(b);
    const frame = await wsWaitFor(ws, 'dataReady');
    expect(frame).toMatchObject({ type: 'dataReady' });
    ws.close();
  });

  it('prints the url with a 64-hex token to stderr', async () => {
    const b = await boot(7353);
    expect(b.reused).toBe(false);
    expect(b.token).toMatch(/^[0-9a-f]{64}$/);
    expect(b.stderr()).toMatch(/coach running at http:\/\/127\.0\.0\.1:7353\/\?t=[0-9a-f]{64}/);
  });

  it('honors --port override', async () => {
    const b = await boot(7354);
    expect(b.port).toBe(7354);
    expect((await fetch(`http://127.0.0.1:7354/health`)).status).toBe(200);
  });

  it('with --no-open still boots and serves (browser suppressed)', async () => {
    // "open not invoked" is unobservable cross-process; the 05-cli unit test asserts that
    // with a mocked open. Here we confirm --no-open does not break boot (deviation #7).
    const b = await boot(7357, ['--no-open']);
    expect((await fetch(`http://127.0.0.1:${b.port}/health`)).status).toBe(200);
    expect(b.stderr()).not.toContain('browser open failed');
  });
});
