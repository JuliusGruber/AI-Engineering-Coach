// src/standalone/server.ts
// Local web host: serves the wrapped webview, brokers RPC over one WebSocket,
// enforces the single-instance and token rules. Serve-then-parse — boots before
// the Analyzer exists; setData(...) installs data and broadcasts dataReady.
// See docs-fork/specs/01-server.md.
import express from 'express';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { dispatch, type DispatchContext, type DispatchResult } from './dispatcher';
import { renderStandaloneHtml } from './standalone-html';
import { clearServerState, readServerState, writeServerState } from './state';
import { createAuthMiddleware } from './auth';
import { createImageRoute } from './image-route';
import type { Analyzer } from '../core/analyzer';
import type { ParseResult } from '../core/cache';

const HOST = '127.0.0.1';
const DEFAULT_PORT = 7331;
const PORT_RETRY = 10; // 7331..7340
const CSP =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "script-src 'self'; img-src 'self' data:; font-src 'self'";

export interface ServerOptions {
  port?: number;
  token?: string;
  logFile?: string;
  analyzer?: Analyzer;
  parseResult?: ParseResult;
}

export interface ServerHandle {
  url: string;
  port: number;
  token: string;
  setData(analyzer: Analyzer, parseResult: ParseResult): void;
  broadcast(frame: Record<string, unknown>): void;
  close(): Promise<void>;
}

// Resolved from import.meta.url so it works under vitest (src/standalone) and the
// esbuild CJS bundle (dist/standalone) alike — both are two levels below a dir
// holding package.json and dist/. esbuild rewrites import.meta.url for cjs output.
export function resolveProjectRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}
export function resolveWebviewRoot(): string {
  return path.join(resolveProjectRoot(), 'dist', 'webview');
}
export function resolveShimPath(): string {
  return path.join(resolveProjectRoot(), 'dist', 'standalone', 'standalone-shim.js');
}

function readVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(resolveProjectRoot(), 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Single-instance probe. Returns the existing URL if a live coach owns `port`,
// else cleans up stale state and returns null. The CLI (05-cli) calls this to
// decide whether to reuse rather than start a second server.
export async function probeExistingInstance(port: number): Promise<string | null> {
  const state = readServerState();
  if (!state || state.port !== port) return null;
  try {
    process.kill(state.pid, 0); // throws ESRCH/EPERM if the pid is gone
  } catch {
    clearServerState();
    return null;
  }
  try {
    const res = await fetchWithTimeout(`http://${HOST}:${port}/health`, 500);
    const body = (await res.json()) as { ok?: boolean; app?: string };
    if (body?.ok === true && body?.app === 'ai-engineer-coach') {
      return `http://${HOST}:${port}/?t=${state.token}`;
    }
  } catch {
    // fall through to cleanup
  }
  clearServerState();
  return null;
}

// Bind on the first free port in [startPort, startPort+PORT_RETRY); the same
// http.Server is re-listened after an EADDRINUSE (it never bound, so it is reusable).
async function listenWithRetry(server: http.Server, startPort: number): Promise<number> {
  for (let p = startPort; p < startPort + PORT_RETRY; p++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (err: NodeJS.ErrnoException) => {
          server.removeListener('listening', onListening);
          reject(err);
        };
        const onListening = () => {
          server.removeListener('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(p, HOST);
      });
      return p;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err;
    }
  }
  throw new Error(
    `coach: no free port in ${startPort}..${startPort + PORT_RETRY - 1}; pass --port to choose another`,
  );
}

interface RpcResponseFrame {
  type: 'response';
  id: string | null;
  data: unknown;
}

// Map the dispatcher's clean union to the webview wire shape. Errors ride INSIDE
// data (00-overview RPC contract); data.error must be a truthy string even for a
// disabled method (which carries no message) or the webview resolves undefined.
function toResponse(id: string | null, result: DispatchResult): RpcResponseFrame {
  if (result.ok) return { type: 'response', id, data: result.data };
  const { code, method, message } = result.error;
  return { type: 'response', id, data: { error: message ?? `request failed (${code})`, code, method } };
}

interface RpcDeps {
  token: string;
  clients: Set<WebSocket>;
  current: () => DispatchContext;
  isPresent: () => boolean;
}

function attachRpcServer(server: http.Server, deps: RpcDeps): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/rpc' });
  const alive = new WeakMap<WebSocket, boolean>();

  wss.on('connection', (socket, req) => {
    const url = new URL(req.url ?? '/rpc', `http://${HOST}`);
    const t = url.searchParams.get('t') ?? '';
    if (t.length !== deps.token.length || !timingSafeEqual(Buffer.from(t), Buffer.from(deps.token))) {
      socket.close(4001, 'unauthorized');
      return;
    }

    deps.clients.add(socket);
    alive.set(socket, true);
    socket.on('pong', () => alive.set(socket, true));
    socket.on('close', () => deps.clients.delete(socket));

    // The unmodified webview gates ALL rendering on dataReady (app.ts:444). A socket
    // that connects after data is present (warm cache, reconnect, second tab) must
    // receive it unprompted. Re-sending on reconnect is harmless (onDataReady is idempotent).
    if (deps.isPresent()) {
      socket.send(JSON.stringify({ type: 'dataReady', currentWorkspace: '' }));
    }

    socket.on('message', (raw) => {
      void (async () => {
        let msg: unknown;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          socket.send(JSON.stringify({ type: 'response', id: null, data: { error: 'invalid json', code: 'bad-request' } }));
          return;
        }
        const env = msg as { type?: unknown; id?: unknown; method?: unknown; params?: unknown };
        if (env?.type !== 'request' || typeof env.id !== 'string' || typeof env.method !== 'string') {
          const id = typeof env?.id === 'string' ? env.id : null;
          socket.send(JSON.stringify({ type: 'response', id, data: { error: 'bad request envelope', code: 'bad-request' } }));
          return;
        }
        const result = await dispatch(env.method, env.params, deps.current());
        socket.send(JSON.stringify(toResponse(env.id, result)));
      })();
    });
  });

  const heartbeat = setInterval(() => {
    for (const socket of deps.clients) {
      if (alive.get(socket) === false) {
        socket.terminate();
        continue;
      }
      alive.set(socket, false);
      try {
        socket.ping();
      } catch {
        /* socket already gone */
      }
    }
  }, 30_000);
  wss.on('close', () => clearInterval(heartbeat));

  return wss;
}

export async function createServer(opts: ServerOptions): Promise<ServerHandle> {
  const version = readVersion();

  // Boot probe: clean up stale state and capture a reusable token. Reuse decisions
  // (skip starting entirely) live in the CLI via probeExistingInstance — createServer
  // always binds its own socket.
  const prior = readServerState();
  let reusableToken: string | undefined;
  if (prior) {
    await probeExistingInstance(prior.port);
    if (/^[0-9a-f]{64}$/.test(prior.token)) reusableToken = prior.token;
  }
  const token = opts.token ?? reusableToken ?? randomBytes(32).toString('hex');

  // Mutable host state — each dispatch reads the CURRENT value (not a boot snapshot).
  let analyzer = opts.analyzer;
  let parseResult = opts.parseResult;
  let present = Boolean(analyzer && parseResult);
  const clients = new Set<WebSocket>();

  const app = express();
  app.get('/health', (_req, res) => {
    res.json({ ok: true, app: 'ai-engineer-coach', version, pid: process.pid });
  });

  const auth = createAuthMiddleware(token);
  app.get('/', auth, (_req, res) => {
    res.setHeader('Set-Cookie', `coach_token=${token}; Path=/; HttpOnly; SameSite=Strict`);
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderStandaloneHtml({ token, appVersion: version }));
  });
  app.get('/standalone-shim.js', auth, (_req, res) => {
    res.setHeader('Content-Type', 'text/javascript');
    res.sendFile(resolveShimPath());
  });
  app.use('/dist/webview', auth, express.static(resolveWebviewRoot()));
  app.get('/img', auth, createImageRoute());

  const httpServer = http.createServer(app);
  const wss = attachRpcServer(httpServer, {
    token,
    clients,
    current: () => ({ analyzer, parseResult }),
    isPresent: () => present,
  });

  const port = await listenWithRetry(httpServer, opts.port ?? DEFAULT_PORT);
  writeServerState({
    version: 1,
    port,
    token,
    pid: process.pid,
    startedAt: new Date().toISOString(),
  });

  function broadcast(frame: Record<string, unknown>): void {
    const data = JSON.stringify(frame);
    for (const socket of clients) {
      if (socket.readyState === WebSocket.OPEN) socket.send(data);
    }
  }
  function setData(nextAnalyzer: Analyzer, nextParseResult: ParseResult): void {
    analyzer = nextAnalyzer;
    parseResult = nextParseResult;
    present = true;
    broadcast({ type: 'dataReady', currentWorkspace: '' });
  }

  let closed = false;
  const onSignal = (): void => {
    void close();
  };
  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    for (const socket of clients) {
      try {
        socket.close(1001);
      } catch {
        /* ignore */
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 50)); // brief graceful drain
    for (const socket of clients) {
      try {
        socket.terminate();
      } catch {
        /* ignore */
      }
    }
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    httpServer.closeAllConnections(); // drop lingering keep-alive sockets so the port frees immediately
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    clearServerState();
  }
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  return { url: `http://${HOST}:${port}/?t=${token}`, port, token, setData, broadcast, close };
}
