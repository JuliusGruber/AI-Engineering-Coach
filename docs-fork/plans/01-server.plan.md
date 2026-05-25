# Server (01-server) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the standalone host — `src/standalone/server.ts` (Express + a single `ws` WebSocket at `/rpc`) plus `auth.ts` and `image-route.ts` — that binds `127.0.0.1` near port 7331, token-gates every route, serves the wrapped webview from [03-standalone-html](../specs/03-standalone-html.md) and the shim from [04-webview-shim](../specs/04-webview-shim.md), brokers RPC through [02-dispatcher](../specs/02-dispatcher.md), and persists single-instance state via [06-state](../specs/06-state.md) — all serve-then-parse, so it boots before the `Analyzer` exists and broadcasts `dataReady` when `setData(...)` lands.

**Architecture:** Three leaf files. `auth.ts` exports `createAuthMiddleware(token)` — a constant-time token check across query/cookie/bearer. `image-route.ts` exports `createImageRoute()` — an allowlist-prefixed file server for `/img`. `server.ts` owns lifecycle: `createServer(opts)` resolves the project root from `import.meta.url`, reads `package.json` version, cleans up stale `server-state.json` via the exported `probeExistingInstance`, binds with port-retry (7331..7340), wires the Express routes and a `ws.Server` (factored into `attachRpcServer`), persists state, and returns a `ServerHandle` (`url`/`port`/`token`/`setData`/`broadcast`/`close`). The host holds the `analyzer`/`parseResult` as **mutable** closure state so each dispatch reads the current value; the WS layer maps the dispatcher's clean `DispatchResult` union to the webview's data-nested wire shape (`{ type:'response', id, data:{...} }`), synthesizing `data.error` from `error.message ?? a code-derived string` so a disabled method (which carries no `message`) still rejects in the unmodified webview.

**Tech Stack:** TypeScript (strict, ES2022 modules, `moduleResolution: bundler`), vitest (`vitest run`, node environment), Node 20 global `fetch`/`AbortController`, the `express` (^4) and `ws` (^8) runtime deps this spec introduces (plus their `@types/*`), and `crypto`/`http`/`fs`/`path`/`node:url` built-ins. Reuses `dispatch` (02), `renderStandaloneHtml` (03), and the `state` module (06). The `vscode` → stub vitest alias from 02/03 is already present (`renderStandaloneHtml` → `panel-html` pulls a transitive `import * as vscode`); this plan adds **no** new vscode scaffolding.

---

## Spec references

- Spec under implementation: `docs-fork/specs/01-server.md`
- Shared contract: `docs-fork/specs/00-overview.md` — relevant pieces:
  - **RPC contract** — errors ride **inside** `data` (`{ data:{ error, code, method } }`), never a sibling field. The server maps the dispatcher's `{ ok:false, error:{ code, method?, message? } }` to that shape; `data.error` must be a truthy string (the webview `shared.ts:62` rejects on `data.error`).
  - **Security model** — `127.0.0.1` bind, 64-hex token on every HTTP/WS request, URL `?t=` → cookie handoff, CSP header + `<meta>`, `/img` allowlist, path-traversal resolve-then-prefix-check.
  - **Cache/state co-existence** — `server-state.json` is the only standalone-owned file; written via 06-state, cleared on `close()`.
  - **Additive-only fork discipline** — every `+` line lives under `src/standalone/`. The only shared edit here is additive `package.json` deps (`express`, `ws`, `@types/express`, `@types/ws`). `bin`/`files`/`scripts`/`esbuild.mjs` belong to [07-build](../specs/07-build.md), not this spec; verified in the final task.

### Dependency note — this is the 5th plan in the queue

`01-server` depends on **four** already-planned specs. Honor these settled interfaces verbatim:

- **06-state** (`06-state.plan.md`): `import { readServerState, writeServerState, clearServerState } from './state'`. `ServerState = { version: 1; port; token; pid; startedAt }`. `readServerState()` returns `ServerState | null` and never throws.
- **02-dispatcher** (`02-dispatcher.plan.md`): `import { dispatch, type DispatchContext, type DispatchResult } from './dispatcher'`. `dispatch(method, params, ctx): Promise<DispatchResult>` where `DispatchContext = { analyzer?: Analyzer; parseResult?: ParseResult }` and `DispatchResult = { ok:true; data:unknown } | { ok:false; error:{ code:string; method?:string; message?:string } }`.
- **03-standalone-html** (`03-standalone-html.plan.md`): `import { renderStandaloneHtml } from './standalone-html'`. `renderStandaloneHtml({ token, appVersion }): string`. It emits `<meta name="coach-token">`, `/standalone-shim.js`, `/dist/webview/app.js`, `/dist/webview/styles.css`.
- **04-webview-shim** (`04-webview-shim.plan.md`): the shim opens `ws://${location.host}/rpc?t=<64hex>`, reads its token from `<meta name="coach-token">`, served at `/standalone-shim.js`. The server's WS route is `/rpc` with a `?t=` query param.

Upstream types: `import type { Analyzer } from '../core/analyzer'` (verified `export class Analyzer` at `analyzer.ts:32`) and `import type { ParseResult } from '../core/cache'` (verified `export interface ParseResult` at `cache.ts:21`). Upstream dispatch target is reached only **through** `dispatch` — the server never calls `getRpcHandler` directly.

Contracts this plan locks in for [05-cli](../specs/05-cli.md): `createServer(opts): Promise<ServerHandle>` and `probeExistingInstance(port): Promise<string|null>` are the seams the CLI uses (probe for single-instance reuse, then `createServer`, then `handle.setData(...)` after the parse). Keep these names and the `ServerHandle` shape exactly.

### Deliberate deviations from the spec text (all noted inline, none change observable contracts)

1. **`createServer` does not return a foreign handle.** The spec's boot step 1 ("probe … return the existing URL") describes `probeExistingInstance`'s return value, not `createServer`'s. Reusing a live instance is the **CLI's** job (05-cli) via the exported `probeExistingInstance`. `createServer` calls `probeExistingInstance(prior.port)` at boot **only** to clean up stale `server-state.json` (dead pid / health mismatch) and to capture a reusable token, then it **always binds** its own socket. This satisfies acceptance #1 (always serves) and keeps the reuse seam independently testable (acceptance #3).
2. **Persist-after-bind.** The spec lists "persist state" (step 4) before "bind" (step 5), but the port can change during retry. This plan binds first (via `listenWithRetry`), then writes `server-state.json` with the **actually-bound** port. A bind failure therefore writes no state (nothing to clean up). Observable contract (state matches the live port) is strictly better.
3. **Shorter close grace.** The spec allows up to 500 ms (per-socket) / 5 s (overall). This plan uses a 50 ms grace then `terminate()` — within the spec's bounds and keeps the suite fast (acceptance #13: rebindable within 1 s).
4. **`probeExistingInstance` live-case tested in-process.** Acceptance #3 names "two child processes". The dead-pid path is tested with a synthetic stale state; the live path is tested by probing a server started in the **same** process (its real pid is alive and `/health` matches) — same code path, deterministic, no flaky child spawning. The two-process scenario is covered by [08-testing](../specs/08-testing.md)'s integration layer.
5. **WS round-trip mocks `dispatch`.** The server's responsibility is envelope mapping + lifecycle, not handler execution (the dispatcher's own suite covers real `panel-rpc`). Server tests `vi.mock('../dispatcher')` so `{ ok:true }`/`{ ok:false }` results are deterministic, isolating the server's wire-shape mapping.
6. **Static/shim tests use the resolved real paths.** Routes serve from `<root>/dist/webview` and `<root>/dist/standalone/standalone-shim.js`. Rather than depend on a build, tests create a uniquely-named fixture under those resolved paths (via the exported `resolveWebviewRoot`/`resolveShimPath`) and remove only what they created.
7. **Two test-support exports added** (`resolveWebviewRoot`, `resolveShimPath`) so tests place fixtures exactly where the server looks (single source of truth). Additive named exports; not in the spec's Public API list but consistent with it.
8. **Heartbeat is implemented but not unit-tested.** The 30 s `ws` ping is a spec *decision*, not an acceptance criterion or test-plan row; timer-driven liveness over real sockets is fragile to unit-test. It is exercised by the smoke layer (08). This is the only non-TDD'd code, called out in the self-review.

## File Structure

| Path | Responsibility | Created/edited by |
|------|----------------|-------------------|
| `package.json` | Add `express`/`ws` to `dependencies`, `@types/express`/`@types/ws` to `devDependencies` (additive; new keys only). | Task 1 |
| `src/standalone/auth.ts` | `createAuthMiddleware(token)`: constant-time token gate (query/cookie/bearer). | Task 2 |
| `src/standalone/__tests__/auth.test.ts` | Unit tests with mock `req`/`res`/`next`. | Task 2 |
| `src/standalone/image-route.ts` | `createImageRoute()`: allowlist-prefixed `/img` file server. | Task 3 |
| `src/standalone/__tests__/image-route.test.ts` | Path-traversal / allowlist / ext / dotfile tests via a tiny Express app. | Task 3 |
| `src/standalone/server.ts` | Helpers (`resolveProjectRoot`/`resolveWebviewRoot`/`resolveShimPath`/`readVersion`/`fetchWithTimeout`/`listenWithRetry`/`toResponse`/`attachRpcServer`), `probeExistingInstance`, `createServer`, `ServerHandle`/`ServerOptions`. | Task 4 (grown in 5, 6) |
| `src/standalone/__tests__/server.test.ts` | Integration tests over real `fetch` + `ws` clients. | Task 4 (grown in 5, 6, 7) |

`src/standalone/` already exists from earlier plans. All test paths match the existing vitest `include: ['src/**/*.test.ts']`, so **no `include` change is needed**.

## Conventions to copy (already in the repo)

- vitest imports come from `'vitest'`: `import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';`
- Single test file run: `npx vitest run <path>`; full suite: `npm test` (= `vitest run`, `package.json:scripts.test`).
- Strict TS, named exports only, kebab-case filenames under `src/standalone/`, comments only where the *why* is non-obvious.
- Temp dirs: `fs.mkdtempSync(path.join(os.tmpdir(), 'prefix-'))` + `fs.rmSync(dir, { recursive: true, force: true })` in teardown (as in `src/core/cache.test.ts`).
- Home-dir override in tests: `vi.spyOn(os, 'homedir').mockReturnValue(tmpHome)` — `state.ts` calls `os.homedir()` at call time, so the spy redirects `server-state.json` writes into the temp home (never the developer's real `~`).

### Preconditions

If `node_modules/` is empty, run `npm install` once. The `vscode` vitest alias (from `02-dispatcher`) and the `open` dep must already be present (topological order guarantees it). The baseline upstream suite must be green (`npm test`) before changes; a pre-existing red suite is an escalation, not introduced here.

---

## Task 1: Prerequisites — add `express` and `ws` (additive `package.json`)

The server needs two runtime deps not yet installed and their type packages. These are the sanctioned additive `package.json` edits for this spec (new keys only; `open` was added by `02-dispatcher`).

**Files:**
- Modify: `package.json` (+ `package-lock.json`)

- [ ] **Step 1: Install the runtime deps**

Run: `npm install express@^4.21.2 ws@^8.18.0`
Expected: `dependencies` gains `"express": "^4.21.2"` and `"ws": "^8.18.0"`; lockfile updates; exit 0.

- [ ] **Step 2: Install the type packages**

Run: `npm install -D @types/express@^4.17.21 @types/ws@^8.5.13`
Expected: `devDependencies` gains both `@types/*` entries; exit 0.

- [ ] **Step 3: Verify the baseline suite still passes**

Run: `npm test`
Expected: PASS — the whole suite is green (adding deps changes no source). If red, stop and investigate before continuing.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "build(standalone): add express and ws runtime deps for the server"
```

---

## Task 2: `auth.ts` — constant-time token middleware

Implements the auth gate (spec "Auth middleware"; acceptance #1's 401/200 behavior). Tested in isolation with plain mock objects — no server needed.

**Files:**
- Create: `src/standalone/auth.ts`
- Test: `src/standalone/__tests__/auth.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/standalone/__tests__/auth.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { createAuthMiddleware } from '../auth';

const TOKEN = 'a'.repeat(64);

function mockReq(init: { query?: Record<string, unknown>; headers?: Record<string, string> }): Request {
  return { query: init.query ?? {}, headers: init.headers ?? {} } as unknown as Request;
}

function mockRes(): { res: Response; status: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> } {
  const end = vi.fn();
  const status = vi.fn().mockReturnValue({ end });
  const res = { status } as unknown as Response;
  return { res, status, end };
}

describe('createAuthMiddleware', () => {
  it('calls next() for a matching ?t= query token', () => {
    const next = vi.fn();
    const { res } = mockRes();
    createAuthMiddleware(TOKEN)(mockReq({ query: { t: TOKEN } }), res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('calls next() for a matching coach_token cookie', () => {
    const next = vi.fn();
    const { res } = mockRes();
    createAuthMiddleware(TOKEN)(mockReq({ headers: { cookie: `coach_token=${TOKEN}; other=1` } }), res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('calls next() for a matching Authorization: Bearer token', () => {
    const next = vi.fn();
    const { res } = mockRes();
    createAuthMiddleware(TOKEN)(mockReq({ headers: { authorization: `Bearer ${TOKEN}` } }), res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('401s when no credential is present', () => {
    const next = vi.fn();
    const { res, status } = mockRes();
    createAuthMiddleware(TOKEN)(mockReq({}), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });

  it('401s on a wrong-length token without throwing', () => {
    const next = vi.fn();
    const { res, status } = mockRes();
    createAuthMiddleware(TOKEN)(mockReq({ query: { t: 'short' } }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });

  it('401s on a same-length but mismatched token', () => {
    const next = vi.fn();
    const { res, status } = mockRes();
    createAuthMiddleware(TOKEN)(mockReq({ query: { t: 'b'.repeat(64) } }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/standalone/__tests__/auth.test.ts`
Expected: FAIL — `Failed to resolve import "../auth"` (the source file does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/standalone/auth.ts`:

```ts
// src/standalone/auth.ts
// Token gate for every standalone HTTP route. The 64-hex token arrives as a
// ?t= query (first GET /), a coach_token cookie (set by GET /), or a Bearer
// header (reserved for v2). See docs-fork/specs/01-server.md.
import type { RequestHandler } from 'express';
import { timingSafeEqual } from 'crypto';

function safeEqual(a: string, b: string): boolean {
  // Different lengths can't be compared by timingSafeEqual (it throws); reject early.
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function cookieToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === 'coach_token') {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

export function createAuthMiddleware(token: string): RequestHandler {
  return (req, res, next) => {
    const query = typeof req.query.t === 'string' ? req.query.t : null;
    const cookie = cookieToken(req.headers.cookie);
    const authHeader = req.headers.authorization;
    const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;
    const candidate = query ?? cookie ?? bearer;
    if (candidate !== null && safeEqual(candidate, token)) {
      next();
      return;
    }
    res.status(401).end('unauthorized');
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/standalone/__tests__/auth.test.ts`
Expected: PASS — 6 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/standalone/auth.ts src/standalone/__tests__/auth.test.ts
git commit -m "feat(standalone): add constant-time token auth middleware"
```

---

## Task 3: `image-route.ts` — allowlisted `/img` file server

Implements the image route (spec "Image route" + code sketch; acceptance #10–12). Tested over a tiny Express app with `os.homedir()` spied to a temp dir holding fixtures.

**Files:**
- Create: `src/standalone/image-route.ts`
- Test: `src/standalone/__tests__/image-route.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/standalone/__tests__/image-route.test.ts`:

```ts
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createImageRoute } from '../image-route';

let tmpHome: string;
let server: http.Server;
let base: string;

function listen(app: express.Express): Promise<{ server: http.Server; base: string }> {
  return new Promise((resolve) => {
    const s = http.createServer(app);
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server: s, base: `http://127.0.0.1:${port}` });
    });
  });
}

beforeEach(async () => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-img-'));
  vi.spyOn(os, 'homedir').mockReturnValue(tmpHome);
  // Fixture inside an allowed root (~/.claude). The PNG signature keeps sniffers happy.
  fs.mkdirSync(path.join(tmpHome, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(tmpHome, '.claude', 'shot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(tmpHome, '.claude', 'notes.txt'), 'nope');
  fs.writeFileSync(path.join(tmpHome, 'outside.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const app = express();
  app.get('/img', createImageRoute());
  ({ server, base } = await listen(app));
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.restoreAllMocks();
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function imgUrl(p: string): string {
  return `${base}/img?path=${encodeURIComponent(p)}`;
}

describe('createImageRoute', () => {
  it('serves an image inside an allowed root', async () => {
    const res = await fetch(imgUrl(path.join(tmpHome, '.claude', 'shot.png')));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/png');
  });

  it('serves content from a dotfile directory (dotfiles: allow)', async () => {
    // Regression for Express's default dotfiles:'ignore' which would 404 ~/.claude.
    const res = await fetch(imgUrl(path.join(tmpHome, '.claude', 'shot.png')));
    expect(res.status).toBe(200);
  });

  it('rejects a path outside the allowed roots (403)', async () => {
    const res = await fetch(imgUrl(path.join(tmpHome, 'outside.png')));
    expect(res.status).toBe(403);
  });

  it('rejects a traversal path that escapes an allowed root (403)', async () => {
    const res = await fetch(imgUrl(path.join(tmpHome, '.claude', '..', '..', 'etc', 'passwd')));
    expect(res.status).toBe(403);
  });

  it('rejects an unsupported extension (415)', async () => {
    const res = await fetch(imgUrl(path.join(tmpHome, '.claude', 'notes.txt')));
    expect(res.status).toBe(415);
  });

  it('rejects a missing path query (400)', async () => {
    const res = await fetch(`${base}/img`);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/standalone/__tests__/image-route.test.ts`
Expected: FAIL — `Failed to resolve import "../image-route"` (the source file does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/standalone/image-route.ts`. `ALLOWED_PREFIXES` resolves at call time from `os.homedir()` (the factory closes over the value at construction; the test constructs the route **after** spying, so the spy is honored):

```ts
// src/standalone/image-route.ts
// GET /img?path=<urlencoded> — RPC handlers (getImageGallery / getSessionImages)
// return filesystem paths into session logs, not blobs. This serves them, but
// only from the six known log roots, after resolving away traversal.
// See docs-fork/specs/01-server.md.
import type { RequestHandler } from 'express';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ALLOWED_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

export function createImageRoute(): RequestHandler {
  const allowedPrefixes = [
    '.claude', '.codex', '.opencode', '.vscode', '.xcode', '.copilot-analytics-cache',
  ].map((d) => path.join(os.homedir(), d));

  return (req, res) => {
    const raw = typeof req.query.path === 'string' ? req.query.path : null;
    if (!raw) {
      res.status(400).end('missing path');
      return;
    }
    const abs = path.resolve(decodeURIComponent(raw));
    if (!allowedPrefixes.some((p) => abs === p || abs.startsWith(p + path.sep))) {
      res.status(403).end('outside allowlist');
      return;
    }
    if (!ALLOWED_EXTS.has(path.extname(abs).toLowerCase())) {
      res.status(415).end('unsupported type');
      return;
    }
    try {
      fs.statSync(abs);
    } catch {
      res.status(404).end('not found');
      return;
    }
    // dotfiles:'allow' — log roots begin with '.'; Express's default 'ignore' would 404 them.
    res.sendFile(abs, { dotfiles: 'allow', headers: { 'Content-Disposition': 'inline' } });
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/standalone/__tests__/image-route.test.ts`
Expected: PASS — 6 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/standalone/image-route.ts src/standalone/__tests__/image-route.test.ts
git commit -m "feat(standalone): add allowlisted /img file-serving route"
```

---

## Task 4: `server.ts` — lifecycle, helpers, and HTTP routes

Creates the full server module: root/version helpers, `fetchWithTimeout`, `probeExistingInstance`, `listenWithRetry`, `createServer` (boot probe → bind-with-retry → persist → routes → signal handlers → handle), and a **minimal** `attachRpcServer` (tracks clients + heartbeat; auth/message/`dataReady` land in Tasks 5–6). Covers the HTTP rows of the test plan (`serves health without auth`, `requires token on GET /`, `sets coach_token cookie on first GET /`, `static asset 200 with token`, `serves /standalone-shim.js with token`, `unknown route 404`) and acceptance #1, #2, #9.

`createServer` is written **once** here and stays byte-stable through Task 7; only `attachRpcServer` grows. `probeExistingInstance`, `listenWithRetry`, and `close()` are also written here (they are structurally required for the server to function) and get **dedicated** tests in Task 7.

**Files:**
- Create: `src/standalone/server.ts`
- Test: `src/standalone/__tests__/server.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/standalone/__tests__/server.test.ts`. The `vi.mock('../dispatcher')` keeps the real dispatcher (and its `panel-rpc`→`vscode` pull) out of these HTTP tests; `renderStandaloneHtml` still loads for real (it resolves `vscode` via the alias from `02-dispatcher`). The fixture block writes a uniquely-named asset and the shim under the server's resolved roots and removes only what it created:

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
  vi.spyOn(os, 'homedir').mockReturnValue(tmpHome);
});

afterEach(async () => {
  for (const h of handles.splice(0)) await h.close();
  vi.restoreAllMocks();
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

async function start(): Promise<ServerHandle> {
  const h = await createServer({});
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/standalone/__tests__/server.test.ts`
Expected: FAIL — `Failed to resolve import "../server"` (the source file does not exist yet). If you instead see `Cannot find module 'vscode'`, the `02-dispatcher` vitest alias is missing — restore it before continuing.

- [ ] **Step 3: Write minimal implementation**

Create `src/standalone/server.ts`. This is the complete module except that `attachRpcServer` is the minimal client-tracking/heartbeat version (auth, message handling, and connect-time `dataReady` are added in Tasks 5–6); `toResponse` and envelope handling arrive with the message handler in Task 5.

```ts
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

interface RpcDeps {
  token: string;
  clients: Set<WebSocket>;
  current: () => DispatchContext;
  isPresent: () => boolean;
}

// Minimal for now: track clients + ping for liveness. Auth, the message loop, and
// connect-time dataReady are added in Tasks 5 and 6.
function attachRpcServer(server: http.Server, deps: RpcDeps): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/rpc' });
  const alive = new WeakMap<WebSocket, boolean>();

  wss.on('connection', (socket) => {
    deps.clients.add(socket);
    alive.set(socket, true);
    socket.on('pong', () => alive.set(socket, true));
    socket.on('close', () => deps.clients.delete(socket));
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
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    clearServerState();
  }
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  return { url: `http://${HOST}:${port}/?t=${token}`, port, token, setData, broadcast, close };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/standalone/__tests__/server.test.ts`
Expected: PASS — 6 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/standalone/server.ts src/standalone/__tests__/server.test.ts
git commit -m "feat(standalone): add server lifecycle, port-retry, and HTTP routes"
```

---

## Task 5: WebSocket protocol — auth, dispatch round-trip, error nesting, bad JSON

Grows `attachRpcServer` to authenticate the upgrade (`?t=`, close `4001` on mismatch), parse + validate each frame, route through `dispatch`, and map the result to the webview wire shape via a new `toResponse` helper. Covers test-plan rows `WS connection rejected without token`, `WS dispatches allowed method round-trip`, `WS error nests in data.error with code`, `WS bad JSON returns bad-request in data.error`, and acceptance #6, #7.

**Files:**
- Modify: `src/standalone/server.ts`
- Modify: `src/standalone/__tests__/server.test.ts`

- [ ] **Step 1: Write the failing tests**

Add a `ws` client import and a small `Client` harness (buffers inbound frames so there is no race between connect and the server's first push), then append the WS describe block. Add to the top of `src/standalone/__tests__/server.test.ts`, just below the existing `createServer` import:

```ts
import { WebSocket as WsClient } from 'ws';
import { dispatch } from '../dispatcher';

const mockedDispatch = vi.mocked(dispatch);

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
```

Then append:

```ts
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
      error: { code: 'standalone-v1-disabled', method: 'saveRule' },
    });
    const h = await start();
    const client = new Client(wsUrl(h, h.token));
    await client.opened();

    client.send({ type: 'request', id: 'y', method: 'saveRule' });
    const res = await client.waitFor((f) => f.type === 'response' && f.id === 'y');

    const data = res.data as { error?: unknown; code?: unknown; method?: unknown };
    expect(typeof data.error).toBe('string');
    expect(data.error).toBeTruthy();
    expect(data.code).toBe('standalone-v1-disabled');
    expect(data.method).toBe('saveRule');
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/standalone/__tests__/server.test.ts`
Expected: FAIL — the minimal `attachRpcServer` neither rejects unauthenticated sockets nor handles messages, so `rejects a connection without a token` hangs/fails (the socket stays open, no `4001`) and the four message tests never receive a response. The 6 HTTP tests still pass.

- [ ] **Step 3: Write minimal implementation**

In `src/standalone/server.ts`, add the `RpcResponseFrame` type and `toResponse` helper just above `interface RpcDeps`:

```ts
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
```

Then replace the whole `attachRpcServer` function with the version below — it adds upgrade auth (close `4001`) and the message loop (JSON guard → envelope validation → `dispatch` → `toResponse`). The heartbeat is unchanged:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/standalone/__tests__/server.test.ts`
Expected: PASS — 11 tests passed (6 HTTP + 5 WS).

- [ ] **Step 5: Commit**

```bash
git add src/standalone/server.ts src/standalone/__tests__/server.test.ts
git commit -m "feat(standalone): add ws auth, rpc dispatch, and data-nested error mapping"
```

---

## Task 6: `dataReady` on connect + `setData`/`broadcast` fan-out

Adds the one remaining line to `attachRpcServer` (send `dataReady` immediately to a socket that connects after data is present) and exercises the already-written `setData`/`broadcast`. Covers test-plan rows `WS sends dataReady on connect when data present`, `setData broadcasts dataReady to open sockets`, `broadcast forwards progress frame to all sockets`, and acceptance #4, #5, #8.

The fake `Analyzer`/`ParseResult` are empty casts — `dispatch` is mocked, so the host only ever reads the `present` flag, never the objects themselves.

**Files:**
- Modify: `src/standalone/server.ts`
- Modify: `src/standalone/__tests__/server.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/standalone/__tests__/server.test.ts`:

```ts
import type { Analyzer } from '../../core/analyzer';
import type { ParseResult } from '../../core/cache';

const fakeAnalyzer = {} as unknown as Analyzer;
const fakeParseResult = {} as unknown as ParseResult;

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/standalone/__tests__/server.test.ts`
Expected: FAIL — `broadcasts dataReady to already-open sockets` and `forwards a broadcast progress frame` already pass (`setData`/`broadcast` exist from Task 4), but `sends dataReady on connect when data is already present` fails: the connection handler never sends a connect-time frame, so `waitFor((f) => f.type === 'dataReady')` hangs to timeout. The 11 earlier tests still pass.

- [ ] **Step 3: Write minimal implementation**

In `src/standalone/server.ts`, inside `attachRpcServer`'s `connection` handler, add the connect-time `dataReady` send immediately after the `socket.on('close', ...)` line and before `socket.on('message', ...)`:

```ts
    socket.on('close', () => deps.clients.delete(socket));

    // The unmodified webview gates ALL rendering on dataReady (app.ts:444). A socket
    // that connects after data is present (warm cache, reconnect, second tab) must
    // receive it unprompted. Re-sending on reconnect is harmless (onDataReady is idempotent).
    if (deps.isPresent()) {
      socket.send(JSON.stringify({ type: 'dataReady', currentWorkspace: '' }));
    }

    socket.on('message', (raw) => {
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/standalone/__tests__/server.test.ts`
Expected: PASS — 14 tests passed (11 + 3).

- [ ] **Step 5: Commit**

```bash
git add src/standalone/server.ts src/standalone/__tests__/server.test.ts
git commit -m "feat(standalone): send dataReady on connect and fan out broadcast frames"
```

---

## Task 7: Single-instance probe, lifecycle, and port-collision

Adds dedicated tests for behaviors the Task-4 code already supports: `probeExistingInstance` (live → URL, dead pid → null + cleanup), `close()` clears state and frees the port, and the port-retry loop fails loudly when 7331..7340 are all taken. Covers test-plan rows `port collision retries 7331..7340 then fails`, `probeExistingInstance returns null for dead pid`, `close() removes server-state.json`, and acceptance #3, #13. **No source change** — these are regression pins (like 03-standalone-html's Task 5).

**Files:**
- Modify: `src/standalone/__tests__/server.test.ts`

- [ ] **Step 1: Write the tests**

Append to `src/standalone/__tests__/server.test.ts`. The collision test spies `net.Server.prototype.listen` so every bind attempt emits `EADDRINUSE` without touching real ports:

```ts
import * as net from 'net';
import { probeExistingInstance } from '../server';
import { readServerState, writeServerState } from '../state';

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
```

> The live-probe test runs in-process: the started server's real pid is alive and its `/health` matches, so `probeExistingInstance` returns the URL — the same code path two `coach` processes would hit (deviation #4). The dead-pid case (`pid: 999999`) and the collision case are fully synthetic and deterministic.

- [ ] **Step 2: Run the tests to verify they pass**

Run: `npx vitest run src/standalone/__tests__/server.test.ts`
Expected: PASS — 18 tests passed (14 + 4). The collision test's manual `createServer({})` is **not** registered in `handles`, and it rejects before `writeServerState`, so there is nothing to clean up. If `close() removes server-state.json` flakes on the rebind, the 50 ms drain plus `httpServer.close` callback have not completed — confirm `close()` awaits both `wss.close` and `httpServer.close` callbacks.

- [ ] **Step 3: Commit**

```bash
git add src/standalone/__tests__/server.test.ts
git commit -m "test(standalone): pin probe, close lifecycle, and port-collision behavior"
```

---

## Task 8: Full-suite run, type-check, and additive-only verification

Confirms the three new modules pass the whole project runner, type-check under strict, and respect the fork's additive-only discipline (`00-overview.md` → "Additive-only fork discipline"; global acceptance #11).

**Files:** none (verification only).

- [ ] **Step 1: Run the full vitest suite**

Run: `npm test`
Expected: PASS — the whole suite is green, including the new `auth.test.ts` (6), `image-route.test.ts` (6), and `server.test.ts` (18). No pre-existing suite (incl. `panel-rpc.test.ts`, `panel-html.test.ts` if present) regresses under the `vscode` alias. If a pre-existing test now fails, stop and investigate — these modules are additive.

- [ ] **Step 2: TypeScript strict check**

Run: `npx tsc --noEmit`
Expected: no errors. Confirms the express `RequestHandler` typing, the `ws` `WebSocket`/`WebSocketServer` imports, the `fileURLToPath(import.meta.url)` root resolution, and the `DispatchResult` narrowing in `toResponse` all hold under strict.

- [ ] **Step 3: Verify additive-only fork discipline (src/)**

Run: `git diff upstream/main -- src/ | grep -E '^[-+]' | grep -vE '^[-+]{3}'`
Expected: every line is an addition (`+`) inside `src/standalone/`. The only new `src/` files from this spec are `server.ts`, `auth.ts`, `image-route.ts`, and the three `__tests__/*.test.ts`. No deletions and no edits outside `src/standalone/`.
(If `upstream/main` is not fetched: `git fetch upstream`. The `upstream` remote is `https://github.com/microsoft/AI-Engineering-Coach.git`.)

- [ ] **Step 4: Verify the only shared-file edit is the additive deps**

Run: `git diff upstream/main -- package.json esbuild.mjs vitest.config.mts`
Expected: `package.json` shows **additions only** — `express`/`ws` under `dependencies`, `@types/express`/`@types/ws` under `devDependencies` (the `open` dep and the `vitest.config.mts` alias were added by `02-dispatcher`; if those show, they belong to that spec, not this one). `esbuild.mjs` is **untouched** by this spec — the `bin`, `files`, `serve`/`dev:standalone` scripts, and the esbuild CLI/shim entries belong to `07-build`. No `-` lines removing or changing an existing value.

- [ ] **Step 5: Confirm no direct `vscode` import crept into the new source**

Run: `grep -rn "vscode" src/standalone/server.ts src/standalone/auth.ts src/standalone/image-route.ts`
Expected: no matches. The only `vscode` pull is transitive, through `renderStandaloneHtml` → `panel-html` (aliased to the stub in tests, externalized in the 07-build bundle); the server's own source never imports it.

- [ ] **Step 6: Final commit (only if Steps 1–5 required a fix)**

If Steps 1–5 surfaced nothing, there is nothing to commit. If a fix was needed:

```bash
git add src/standalone/ package.json package-lock.json
git commit -m "test(standalone): verify server passes full suite and additive checks"
```

---

## Acceptance criteria mapping (self-review)

Every acceptance criterion in `docs-fork/specs/01-server.md` maps to a task/test:

| Spec acceptance criterion | Task | Test |
|---------------------------|------|------|
| 1. `createServer({})` serves GET / (200 with token, 401 without) before parse | Tasks 2 & 4 | `requires the token on GET / (401 without, 200 with)` |
| 2. `/health` returns documented JSON incl. `pid` and `version` | Task 4 | `serves /health without auth` |
| 3. Second instance: `probeExistingInstance` returns existing URL | Task 7 | `probeExistingInstance returns the URL for a live instance` (in-process; deviation #4) |
| 4. Socket connecting after `setData` immediately receives `dataReady` | Task 6 | `sends dataReady on connect when data is already present` |
| 5. `setData` broadcasts `dataReady` to open sockets | Task 6 | `broadcasts dataReady to already-open sockets when setData runs` |
| 6. After `setData`, allowed-method request → `{ type:'response', id, data }` | Task 5 | `dispatches an allowed method round-trip` |
| 7. Disallowed method → error nested in `data`, code `standalone-v1-disabled`, no sibling | Task 5 | `nests a disabled-method error inside data, with no sibling error field` |
| 8. `broadcast({type:'progress',...})` reaches every open socket unchanged | Task 6 | `forwards a broadcast progress frame to every open socket` |
| 9. `/standalone-shim.js` → 200 + JS type with token, 401 without | Task 4 | `serves /standalone-shim.js with the token, 401 without` |
| 10. `/img?path=<inside ~/.claude>` → 200 + image type | Task 3 | `serves an image inside an allowed root` |
| 11. `/img?path=/etc/passwd` → 403, no contents | Task 3 | `rejects a path outside the allowed roots (403)` |
| 12. `/img?path=<traversal>` → `path.resolve` normalize → 403 | Task 3 | `rejects a traversal path that escapes an allowed root (403)` |
| 13. `close()` removes `server-state.json`; port rebindable within 1 s | Task 7 | `close() removes server-state.json and frees the port` |

**`server.test.ts` test-plan rows — all 16 present:** `serves health without auth` (T4), `requires token on GET /` (T4), `sets coach_token cookie on first GET /` (T4, folded with the CSP-header assertion), `static asset 200 with token` (T4), `serves /standalone-shim.js with token` (T4), `unknown route 404` (T4), `WS connection rejected without token` (T5), `WS sends dataReady on connect when data present` (T6), `setData broadcasts dataReady to open sockets` (T6), `broadcast forwards progress frame to all sockets` (T6), `WS dispatches allowed method round-trip` (T5), `WS error nests in data.error with code` (T5), `WS bad JSON returns bad-request in data.error` (T5), `port collision retries 7331..7340 then fails` (T7), `probeExistingInstance returns null for dead pid` (T7), `close() removes server-state.json` (T7). Two extras pin contracts: `answers a malformed envelope with a bad-request error` (T5) and `probeExistingInstance returns the URL for a live instance` (T7).

**`image-route.test.ts` test-plan rows — all 6 present:** `serves image inside allowed root` (T3), `rejects path outside allowed roots` (T3), `rejects path with traversal` (T3), `rejects unsupported extension` (T3), `rejects missing path query` (T3), `serves dotfile directory content` (T3).

**Type-consistency check:** `createServer`, `probeExistingInstance`, `ServerOptions`, `ServerHandle` are defined once in `server.ts` and spelled identically in source and tests. `ServerHandle`'s members (`url`, `port`, `token`, `setData`, `broadcast`, `close`) match the spec's Public API exactly. The consumed interfaces match the upstream plans verbatim: `readServerState`/`writeServerState`/`clearServerState` + `ServerState` fields (`version`/`port`/`token`/`pid`/`startedAt`) from 06; `dispatch`/`DispatchContext`/`DispatchResult` from 02 (the `{ ok, ... }` union, mapped — never sent raw); `renderStandaloneHtml({ token, appVersion })` from 03; `/rpc?t=`/`coach-token`/`/standalone-shim.js` strings from 04. `createAuthMiddleware` and `createImageRoute` are spelled identically across `server.ts` and their own modules/tests. The wire frame `{ type:'response', id, data }` and the disabled error `{ data:{ error, code:'standalone-v1-disabled', method } }` match the 00-overview RPC contract.

**Placeholder scan:** no TBD/TODO/"handle edge cases"/"similar to" — every code step shows complete, compilable code (`attachRpcServer` is re-shown in full at every task that changes it, so a worker reading tasks out of order never sees a partial function); every run step shows the exact command and expected pass/fail output. The one deliberately untested piece is the 30 s heartbeat (deviation #8) — real code, not a placeholder, with no acceptance criterion; exercised by 08-testing's smoke layer.

**Deviations from the spec text** are enumerated in "Deliberate deviations" at the top (foreign-handle reuse moved to the CLI via `probeExistingInstance`; persist-after-bind; shorter close grace; in-process live-probe test; `dispatch`-mocked WS tests; resolved-path static/shim fixtures; two test-support exports; untested heartbeat). None changes an observable contract that a later spec depends on.
