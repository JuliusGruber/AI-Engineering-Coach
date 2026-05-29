import { fork, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

// Resolved from this file's URL → repo-root/dist/standalone/cli.js.
export const CLI = path.resolve(
  fileURLToPath(new URL('../../../dist/standalone/cli.js', import.meta.url)),
);

export function makeTmpHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'coach-it-'));
}

export interface Booted {
  child: ChildProcess;
  url: string;
  token: string;
  port: number;
  reused: boolean;
  stderr: () => string;
}

// Matches both "coach running at <url>" and "coach already running at <url>".
const URL_RE = /coach (already )?running at (http:\/\/127\.0\.0\.1:(\d+)\/\?t=([0-9a-f]{64}))/;

// Fork the built CLI with HOME/USERPROFILE pointed at an isolated tmp home so
// os.homedir() (used by state + the parser) resolves there. Resolves once the URL
// line is seen on stderr; rejects on early exit or timeout (with captured stderr).
export function bootCli(home: string, args: string[] = [], timeoutMs = 20_000, extraEnv: Record<string, string> = {}): Promise<Booted> {
  const child = fork(CLI, ['--no-open', ...args], {
    env: { ...process.env, HOME: home, USERPROFILE: home, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let buf = '';
  let done = false;
  return new Promise<Booted>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      child.kill('SIGKILL');
      reject(new Error(`bootCli timed out (${timeoutMs}ms). stderr:\n${buf}`));
    }, timeoutMs);
    const tryResolve = (): boolean => {
      const m = buf.match(URL_RE);
      if (m && !done) {
        done = true;
        clearTimeout(timer);
        resolve({ child, url: m[2], token: m[4], port: Number(m[3]), reused: Boolean(m[1]), stderr: () => buf });
      }
      return Boolean(m);
    };
    child.stderr!.on('data', (b: Buffer) => { buf += b.toString(); tryResolve(); });
    child.on('exit', (code) => {
      if (done) return;
      if (!tryResolve()) {
        done = true;
        clearTimeout(timer);
        reject(new Error(`cli exited (code ${code}) before printing a URL. stderr:\n${buf}`));
      }
    });
  });
}

// SIGINT the child and await its exit; SIGKILL after 5 s as a backstop. Returns the code.
export async function stopCli(b: Booted): Promise<number | null> {
  if (b.child.exitCode !== null) return b.child.exitCode;
  const exited = new Promise<number | null>((resolve) => b.child.once('exit', (c) => resolve(c)));
  b.child.kill('SIGINT');
  return Promise.race([
    exited,
    new Promise<number | null>((resolve) =>
      setTimeout(() => { b.child.kill('SIGKILL'); resolve(null); }, 5_000),
    ),
  ]);
}

export function wsConnect(b: Booted): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${b.port}/rpc?t=${b.token}`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

export function wsRequest(
  ws: WebSocket,
  method: string,
  params?: unknown,
  id = 'it-1',
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const onMsg = (raw: Buffer): void => {
      const f = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (f.type === 'response' && f.id === id) { ws.off('message', onMsg); resolve(f); }
    };
    ws.on('message', onMsg);
    ws.once('error', reject);
    ws.send(JSON.stringify({ type: 'request', id, method, params }));
  });
}

export function wsWaitFor(ws: WebSocket, type: string, timeoutMs = 15_000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.off('message', onMsg); reject(new Error(`no ${type} frame in ${timeoutMs}ms`)); }, timeoutMs);
    const onMsg = (raw: Buffer): void => {
      const f = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (f.type === type) { clearTimeout(timer); ws.off('message', onMsg); resolve(f); }
    };
    ws.on('message', onMsg);
  });
}

// Resolve on the first event frame ({type:'event', method}) for the given method. Distinct
// from wsWaitFor (which keys on frame.type) — event frames carry no id, so this matches method.
export function wsWaitForEvent(ws: WebSocket, method: string, timeoutMs = 15_000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.off('message', onMsg); reject(new Error(`no ${method} event in ${timeoutMs}ms`)); }, timeoutMs);
    const onMsg = (raw: Buffer): void => {
      const f = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (f.type === 'event' && f.method === method) { clearTimeout(timer); ws.off('message', onMsg); resolve(f); }
    };
    ws.on('message', onMsg);
  });
}
