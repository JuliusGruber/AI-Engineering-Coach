import { fork } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bootCli, makeTmpHome, stopCli, wsConnect, wsRequest, wsWaitFor, wsWaitForEvent, type Booted, CLI } from './helpers';
import { createFakeLlmServer } from '../fixtures/fake-llm-server.mjs';
import type { AddressInfo } from 'node:net';

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

  it('exposes getDataExplorer + evaluateExpression (bucket-A allowlist), returning data not the disabled gate', async () => {
    const home = makeTmpHome();
    const b = track(await bootCli(home, ['--port', '7360']), home);
    const ws = await wsConnect(b);
    await wsWaitFor(ws, 'dataReady'); // serve-then-parse: analyzer present after this frame

    // getDataExplorerFields is already allowlisted; use it to get a valid field name.
    const fieldsRes = await wsRequest(ws, 'getDataExplorerFields', {}, 'f1');
    const fieldName = (fieldsRes.data as { fields: Array<{ name: string }> }).fields[0].name;

    const de = await wsRequest(ws, 'getDataExplorer', { field: fieldName }, 'de1');
    const ev = await wsRequest(ws, 'evaluateExpression', { expr: 'messageLength > 0', scope: 'requests' }, 'ev1');
    ws.close();

    // Before this change both returned { code: 'standalone-v1-disabled' } (tier-2 gate).
    expect((de.data as { code?: string }).code).not.toBe('standalone-v1-disabled');
    expect((ev.data as { code?: string }).code).not.toBe('standalone-v1-disabled');
    // ...and they reached the real pure-core handler (ok shape: no error field).
    expect((de.data as { error?: string }).error).toBeUndefined();
    expect((ev.data as { error?: string }).error).toBeUndefined();
    expect((ev.data as { total?: number }).total).toBeTypeOf('number'); // evaluateExpression result
  });

  it('standalone bundle enables token reporting (getBurndown is not the disabled sentinel)', async () => {
    const home = makeTmpHome();
    const b = track(await bootCli(home, ['--port', '7361']), home);
    const ws = await wsConnect(b);
    await wsWaitFor(ws, 'dataReady');
    const bd = await wsRequest(ws, 'getBurndown', {}, 'bd1');
    const tc = await wsRequest(ws, 'getTokenCoverage', {}, 'tc1');
    ws.close();
    // FF override active in the built CLI bundle -> the false-branch sentinel is gone.
    expect((bd.data as { error?: string }).error).not.toBe('Token reporting is temporarily disabled');
    expect((tc.data as { error?: string }).error).not.toBe('Token reporting is temporarily disabled');
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

  it('compileNlRule degrades to a heuristic template offline (no key -> usedLlm:false, never errors)', async () => {
    const home = makeTmpHome();
    const b = track(await bootCli(home, ['--port', '7362'], 20_000, { ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' }), home); // no LLM env
    const ws = await wsConnect(b);
    await wsWaitFor(ws, 'dataReady');
    const res = await wsRequest(ws, 'compileNlRule', { prompt: 'flag short prompts' }, 'nl1');
    ws.close();

    const data = res.data as { usedLlm?: boolean; valid?: boolean; notes?: string[]; error?: string; markdown?: string };
    expect(data.error).toBeUndefined(); // parity: compileNlRule never surfaces an error offline
    expect(data.usedLlm).toBe(false);
    expect(data.markdown).toContain('# Filter'); // a scaffolded rule is still returned
    // No provider → vscode-stub selectChatModels returns [] silently (no throw → no note).
    expect(Array.isArray(data.notes)).toBe(true);
  });

  it('compileNlRule uses the LLM when a provider is configured (usedLlm:true, valid:true)', async () => {
    const fake = createFakeLlmServer();
    await new Promise<void>((r) => fake.listen(0, '127.0.0.1', () => r()));
    const port = (fake.address() as AddressInfo).port;
    try {
      const home = makeTmpHome();
      const b = track(
        await bootCli(home, ['--port', '7363'], 20_000, { ANTHROPIC_API_KEY: 'test-key', COACH_LLM_BASE_URL: `http://127.0.0.1:${port}` }),
        home,
      );
      const ws = await wsConnect(b);
      await wsWaitFor(ws, 'dataReady');
      const res = await wsRequest(ws, 'compileNlRule', { prompt: 'flag short prompts' }, 'nl2');
      ws.close();

      const data = res.data as { usedLlm?: boolean; valid?: boolean };
      expect(data.usedLlm).toBe(true); // requires rule-compiler -> stub lm -> fake provider, and parseRule success
      expect(data.valid).toBe(true);
    } finally {
      await new Promise<void>((r) => fake.close(() => r()));
    }
  });

  it('generateLearningQuiz returns questions via the service bridge + fake provider', async () => {
    const fake = createFakeLlmServer();
    await new Promise<void>((r) => fake.listen(0, '127.0.0.1', () => r()));
    const port = (fake.address() as AddressInfo).port;
    try {
      const home = makeTmpHome();
      const b = track(
        await bootCli(home, ['--port', '7364'], 20_000, { ANTHROPIC_API_KEY: 'test-key', COACH_LLM_BASE_URL: `http://127.0.0.1:${port}` }),
        home,
      );
      const ws = await wsConnect(b);
      await wsWaitFor(ws, 'dataReady');
      const quiz = await wsRequest(ws, 'generateLearningQuiz', { difficulty: 'easy', languages: ['ts'] }, 'q1');
      const cat = await wsRequest(ws, 'triageCatalog', { items: [{ id: 'demo-skill', title: 'Demo Skill', kind: 'skill', description: 'd', category: 'c' }] }, 'c1');
      ws.close();

      expect((quiz.data as { error?: string }).error).toBeUndefined();
      expect((quiz.data as { questions?: unknown[] }).questions?.length).toBeGreaterThan(0);
      expect((cat.data as { error?: string }).error).toBeUndefined();
      expect((cat.data as { items?: unknown[] }).items?.length).toBeGreaterThan(0);
    } finally {
      fake.close();
    }
  });

  it('reviewContextFiles forwards a reviewProgress event to the requesting socket', async () => {
    const fake = createFakeLlmServer();
    await new Promise<void>((r) => fake.listen(0, '127.0.0.1', () => r()));
    const port = (fake.address() as AddressInfo).port;
    try {
      const home = makeTmpHome();
      const b = track(
        await bootCli(home, ['--port', '7365'], 20_000, { ANTHROPIC_API_KEY: 'test-key', COACH_LLM_BASE_URL: `http://127.0.0.1:${port}` }),
        home,
      );
      const ws = await wsConnect(b);
      await wsWaitFor(ws, 'dataReady');
      const eventSeen = wsWaitForEvent(ws, 'reviewProgress');
      await wsRequest(ws, 'reviewContextFiles', { workspaceIds: ['does-not-exist'] }, 'r1');
      const evt = await eventSeen;
      ws.close();

      expect(evt.type).toBe('event');
      expect(evt.method).toBe('reviewProgress');
      expect((evt.data as { phase?: string }).phase).toBe('start');
    } finally {
      fake.close();
    }
  });

  it('generateLearningQuiz returns a standalone (non-Copilot) error with no LLM key (grilling decision 2)', async () => {
    const home = makeTmpHome();
    const b = track(await bootCli(home, ['--port', '7366']), home);
    const ws = await wsConnect(b);
    await wsWaitFor(ws, 'dataReady');
    const res = await wsRequest(ws, 'generateLearningQuiz', { difficulty: 'easy', languages: ['ts'] }, 'nokey1');
    ws.close();
    const data = res.data as { error?: string };
    expect(data.error).toContain('ANTHROPIC_API_KEY');
    expect(data.error).not.toMatch(/Copilot/i);
  });

  it('explainOccurrence routes through the registry and never leaks the upstream Copilot string (grilling decision 6)', async () => {
    const home = makeTmpHome();
    const b = track(await bootCli(home, ['--port', '7367']), home);
    const ws = await wsConnect(b);
    await wsWaitFor(ws, 'dataReady');
    const res = await wsRequest(ws, 'explainOccurrence', { ruleId: 'demo', sessionId: 'demo' }, 'exp1');
    ws.close();
    const data = res.data as { error?: string };
    expect(data.error ?? '').not.toMatch(/Copilot/i);
    expect(data.error ?? '').not.toMatch(/No language model available/i);
  });
});
