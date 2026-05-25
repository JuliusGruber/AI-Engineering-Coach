# 01 — Server (Express + WebSocket host)

Local web server that serves the bundled webview, brokers RPC over a
single WebSocket, and enforces the single-instance and security rules
from [00-overview](00-overview.md).

## Goal

One process that:

- Binds to `127.0.0.1`, picks a free port near 7331.
- Authenticates every request against a persisted token.
- Serves `/`, `/dist/webview/*`, `/health`, `/img`, and `/rpc` (WS).
- Reuses an existing instance if one is alive on the target port.
- Spawns the existing parse worker pool unchanged; routes results
  through the [02-dispatcher](02-dispatcher.md).

## Files

| Path                                          | Purpose                            | LOC |
|-----------------------------------------------|------------------------------------|-----|
| `src/standalone/server.ts`                    | Server setup + lifecycle           | ~140 |
| `src/standalone/auth.ts`                      | Auth middleware factory            | ~25  |
| `src/standalone/image-route.ts`               | `/img` allowlisted file serving    | ~40  |
| `src/standalone/__tests__/server.test.ts`     | Integration tests                  | ~150 |
| `src/standalone/__tests__/image-route.test.ts`| Path traversal tests               | ~60  |

Split rationale: the auth and image-route helpers have non-trivial
test surfaces of their own; isolating them keeps `server.ts` focused
on lifecycle and routing.

## Public API

```ts
// src/standalone/server.ts

import type { Analyzer } from '../core/analyzer';
import type { ParseResult } from '../core/types';

export interface ServerOptions {
  port?: number;          // default 7331
  token?: string;         // default: from server-state.json or fresh
  logFile?: string;       // default: undefined (stderr only)
  analyzer: Analyzer;
  parseResult: ParseResult;
}

export interface ServerHandle {
  url: string;            // http://127.0.0.1:<port>/?t=<token>
  port: number;
  token: string;
  close(): Promise<void>; // graceful: drain WS, close HTTP, clearServerState()
}

export async function createServer(opts: ServerOptions): Promise<ServerHandle>;

// Single-instance probe; returns the existing URL if our server is already running.
export async function probeExistingInstance(port: number): Promise<string | null>;
```

## Behavior

### Boot sequence

1. **Probe.** Read `~/.ai-engineer-coach/server-state.json` via
   [06-state](06-state.md). If present, call
   `probeExistingInstance(state.port)`:
   - HTTP GET `http://127.0.0.1:<port>/health` (no token; 200 to anyone
     is intentional — the response only confirms identity, contains no
     secrets, and is needed for single-instance detection by other
     `coach` invocations).
   - If response JSON matches `{ ok: true, app: 'ai-engineer-coach' }`
     **and** `state.pid` is alive (`process.kill(pid, 0)` does not
     throw), return the existing URL with the persisted token.
   - Otherwise call `clearServerState()` and continue.
2. **Pick port.** Try `opts.port ?? 7331`. On `EADDRINUSE`, try
   `+1, +2, ..., +9` (so worst case 7331..7340). After 7340 → throw
   with a hint suggesting `--port`.
3. **Generate or reuse token.** If `opts.token` provided, use it. Else
   if `server-state.json` had a valid token (64-char hex), reuse it.
   Else generate fresh via `crypto.randomBytes(32).toString('hex')`.
4. **Persist server state.** Write `server-state.json` with
   `{ version: 1, port, token, pid: process.pid, startedAt: new Date().toISOString() }`
   via [06-state](06-state.md).
5. **Bind.** Start Express on `127.0.0.1`, attach the `ws.Server` on
   the same HTTP server with path `/rpc`.
6. **Signal handlers.** Install `SIGINT` and `SIGTERM` to call
   `close()` (idempotent).

### Routes

| Method | Path                  | Auth   | Behavior                                                                                |
|--------|-----------------------|--------|-----------------------------------------------------------------------------------------|
| GET    | `/health`             | None   | `{ ok: true, app: 'ai-engineer-coach', version: <pkg.version>, pid: process.pid }`      |
| GET    | `/`                   | Token  | HTML wrapper from [03-standalone-html](03-standalone-html.md). Sets `Set-Cookie: coach_token=<token>; Path=/; HttpOnly; SameSite=Strict`. |
| GET    | `/dist/webview/*`     | Token  | Static file from `<projectRoot>/dist/webview/` (Express `express.static`). 404 if absent. |
| GET    | `/img`                | Token  | See `image-route.ts`; query `?path=<urlencoded>`, allowlist-checked.                    |
| WS     | `/rpc`                | Token  | RPC bridge (see "WebSocket protocol").                                                  |

### Auth middleware

Implemented in `src/standalone/auth.ts` as
`createAuthMiddleware(token: string)`. Rejects with 401 unless:

- Query `?t=<token>` exact match (used by `/` on first load), **or**
- Cookie `coach_token=<token>` exact match (set by `/` response), **or**
- Header `Authorization: Bearer <token>` (used by no caller in v1; reserved for v2 external scripts).

Constant-time comparison: `crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))`
where both buffers are the same length (always 64 chars per
[00-overview](00-overview.md#security-model)). Different lengths → 401
without comparison.

### Image route

Implemented in `src/standalone/image-route.ts` as
`createImageRoute(): RequestHandler`. Required because RPC handlers
`getImageGallery` and `getSessionImages` return paths into session
logs, not base64 blobs.

1. Read `req.query.path` as string. Reject (400) if missing or empty.
2. `path.resolve(decodeURIComponent(raw))` → absolute path.
3. Verify absolute path starts with one of the allowed-root prefixes
   (resolved at startup via `os.homedir()`):
   - `~/.claude`
   - `~/.codex`
   - `~/.opencode`
   - `~/.vscode`
   - `~/.xcode`
   - `~/.copilot-analytics-cache`
4. Reject (403) if not. Reject (404) if `fs.statSync` throws ENOENT.
5. Reject (415) if extension not in `{ .png, .jpg, .jpeg, .gif, .webp, .svg }`.
6. Stream via `res.sendFile(absolutePath)` with
   `Content-Disposition: inline`.

### WebSocket protocol

On `ws.Server` `connection` event:

1. Authenticate against the upgrade request URL's `t` query parameter.
   Reject (close code 4001) if missing or mismatched.
2. Bind message handler:
   - Parse `data` as JSON. On parse failure → send
     `{ type: 'response', id: null, error: { code: 'bad-request', message: 'invalid json' } }`.
   - Validate envelope: `{ type: 'request', id: string, method: string }`.
     If not, send `bad-request` with the offending id (or null).
   - Call [02-dispatcher](02-dispatcher.md) `dispatch(method, params, { analyzer, parseResult })`.
   - Build `{ type: 'response', id, data?, error? }` per the dispatcher
     result and send.
3. Subscribe to upstream push events (existing `progress` and
   `dataReady` emitters from the core) and forward
   `{ type: 'progress'|'dataReady', ... }` frames to all open sockets.
   Clean up subscription on socket close.

   **Fallback if push pattern is non-obvious at impl time:** the
   read-only allowlist does not *require* push events to function — it
   only loses live-refresh UX during initial parse. If the implementing
   agent can't find a clean subscription hook in `panel-rpc.ts` within
   ~30 minutes, defer push forwarding to v1.1, document the gap in the
   PR, and rely on the existing extension behavior where the webview
   polls on user-triggered nav. Acceptance criteria 1–4 still pass.

### Graceful shutdown

`close()` performs (in order, with 5 s overall timeout):

1. Stop accepting new HTTP connections (`httpServer.close()`).
2. Send WS close frames (`code 1001`) to all clients and wait for them
   to ack or 500 ms timeout.
3. Call `clearServerState()` from [06-state](06-state.md).
4. Resolve the promise.

If the timeout fires, force-destroy remaining sockets and resolve
anyway.

## Decisions

| Open question                                            | Decision                                            | Why |
|----------------------------------------------------------|-----------------------------------------------------|-----|
| `/health` requires auth                                  | No                                                  | Needed by other instances to detect us; reveals no secrets |
| Port retry range                                         | 7331..7340 (10 ports)                               | Bounded; if all taken something else is wrong, fail loudly |
| Token transport on first load                            | URL query → cookie                                  | URL needed for browser-opening; cookie keeps it out of subsequent logs |
| `express.static` vs custom file server                   | `express.static`                                    | Handles range requests, ETags, MIME types correctly out of the box |
| Static root path                                         | `<projectRoot>/dist/webview/`                       | Set via `path.resolve(__dirname, '../../dist/webview')` at runtime |
| `getRuleEditor` reachability via WS                      | Blocked by allowlist (see [02-dispatcher](02-dispatcher.md)) | Avoids `require('vscode')` runtime errors in logs |
| WS heartbeat / ping                                      | Built-in `ws` ping every 30 s                       | Detects half-open sockets without app-level frames |

## Dependencies

- npm: `express` (^4 or ^5 — pin at impl time), `ws` (^8)
- Node built-ins: `http`, `crypto`, `path`, `fs`
- Fork: [02-dispatcher](02-dispatcher.md), [03-standalone-html](03-standalone-html.md),
  [04-webview-shim](04-webview-shim.md), [06-state](06-state.md)
- Upstream: `src/core/analyzer`, `src/core/types`, the parse worker
  pool (spawned by the caller in [05-cli](05-cli.md), passed in via
  `opts.analyzer` and `opts.parseResult`)

## Code sketch — single-instance handshake

```ts
export async function probeExistingInstance(port: number): Promise<string | null> {
  const state = readServerState();
  if (!state || state.port !== port) return null;
  try {
    process.kill(state.pid, 0); // throws ESRCH if pid is gone
  } catch {
    clearServerState();
    return null;
  }
  try {
    const res = await fetchWithTimeout(`http://127.0.0.1:${port}/health`, 500);
    const body = await res.json();
    if (body?.ok === true && body?.app === 'ai-engineer-coach') {
      return `http://127.0.0.1:${port}/?t=${state.token}`;
    }
  } catch {
    // fall through
  }
  clearServerState();
  return null;
}
```

`fetchWithTimeout` uses `AbortController` with a 500 ms timer.

## Code sketch — image route allowlist

```ts
const ALLOWED_PREFIXES = [
  '.claude', '.codex', '.opencode', '.vscode', '.xcode',
  '.copilot-analytics-cache',
].map(d => path.join(os.homedir(), d));

const ALLOWED_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

export function createImageRoute(): RequestHandler {
  return (req, res) => {
    const raw = typeof req.query.path === 'string' ? req.query.path : null;
    if (!raw) return res.status(400).end('missing path');
    const abs = path.resolve(decodeURIComponent(raw));
    if (!ALLOWED_PREFIXES.some(p => abs === p || abs.startsWith(p + path.sep))) {
      return res.status(403).end('outside allowlist');
    }
    if (!ALLOWED_EXTS.has(path.extname(abs).toLowerCase())) {
      return res.status(415).end('unsupported type');
    }
    res.sendFile(abs, { dotfiles: 'allow', headers: { 'Content-Disposition': 'inline' } });
  };
}
```

Note `dotfiles: 'allow'` — log directories begin with `.` (e.g.,
`~/.claude`); Express's default `'ignore'` would 404 them.

## Acceptance criteria

1. `createServer({ analyzer, parseResult })` starts and resolves with a
   handle whose `url` returns 200 for GET `/` when called with the
   token, and 401 without.
2. `/health` returns the documented JSON, including `pid` and `version`.
3. Second `createServer(...)` call in a separate process while the first
   is alive: the second's `probeExistingInstance` returns the existing
   URL (verified by integration test that spawns two child processes).
4. WebSocket request `{ type: 'request', id: 'x', method: 'getStats' }`
   with valid token receives `{ type: 'response', id: 'x', data: {...} }`.
5. WebSocket request with disallowed method receives
   `{ ..., error: { code: 'standalone-v1-disabled', ... } }`.
6. `/img?path=<encoded path inside ~/.claude>` returns the file with
   200 + image content-type.
7. `/img?path=/etc/passwd` returns 403 with no file contents.
8. `/img?path=<encoded path with traversal: ~/.claude/../../etc/passwd>`
   normalizes via `path.resolve` and returns 403.
9. `handle.close()` removes `server-state.json` and the port becomes
   bindable again within 1 s.

## Test plan

`src/standalone/__tests__/server.test.ts`:

| Test name                                          | Intent                                          |
|----------------------------------------------------|-------------------------------------------------|
| `serves health without auth`                       | Single-instance probe contract                  |
| `requires token on GET /`                          | 401 without, 200 with                           |
| `sets coach_token cookie on first GET /`           | Token transport handoff                         |
| `static asset 200 with token`                      | `/dist/webview/app.js`                          |
| `unknown route 404`                                | Catch-all behavior                              |
| `WS connection rejected without token`             | Close code 4001                                 |
| `WS dispatches allowed method round-trip`          | Happy path                                      |
| `WS bad JSON returns bad-request envelope`         | Robustness                                      |
| `port collision retries 7331..7340 then fails`     | Use vitest `vi.spyOn(net.Server.prototype, 'listen')` mock |
| `probeExistingInstance returns null for dead pid`  | Stale state cleanup                             |
| `close() removes server-state.json`                | Lifecycle                                       |

`src/standalone/__tests__/image-route.test.ts`:

| Test name                                          | Intent                                          |
|----------------------------------------------------|-------------------------------------------------|
| `serves image inside allowed root`                 | Happy path with a fixture                       |
| `rejects path outside allowed roots`               | 403                                             |
| `rejects path with traversal`                      | `path.resolve` normalization                    |
| `rejects unsupported extension`                    | 415                                             |
| `rejects missing path query`                       | 400                                             |
| `serves dotfile directory content`                 | `dotfiles: 'allow'` regression                  |
