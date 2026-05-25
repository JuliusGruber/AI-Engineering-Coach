# 02 — Dispatcher (allowlist bridge)

Thin bridge between incoming RPC requests and the upstream
`getRpcHandler` registry, gated by the V1 method allowlist defined in
[00-overview](00-overview.md#authoritative-v1_allowed-method-set).

## Goal

Decouple the WebSocket transport in [01-server](01-server.md) from the
upstream RPC registry. The server speaks WebSockets; the dispatcher
speaks "method name + params + context, give me a result or an error
envelope."

## Files

| Path                                            | Purpose                       | LOC |
|-------------------------------------------------|-------------------------------|-----|
| `src/standalone/v1-allowed.ts`                  | Source-of-truth allowlist     | ~45 (data) |
| `src/standalone/standalone-native.ts`           | `STANDALONE_NATIVE` handlers  | ~50 |
| `src/standalone/dispatcher.ts`                  | dispatch() function           | ~45 |
| `src/standalone/__tests__/dispatcher.test.ts`   | Unit tests                    | ~90 |
| `src/standalone/__tests__/standalone-native.test.ts` | Native handler tests     | ~70 |

## Public API

```ts
// src/standalone/dispatcher.ts

import type { Analyzer } from '../core/analyzer';
import type { ParseResult } from '../core/types';

export interface DispatchContext {
  // Optional: the server serves before the parse finishes
  // (serve-then-parse). A registry method dispatched with `analyzer`
  // still undefined returns a `handler-error` ("data not ready").
  analyzer?: Analyzer;
  parseResult?: ParseResult;
}

// Internal discriminated union. The SERVER maps this to the webview wire
// shape — see [01-server](01-server.md): `{ ok:false, error }` becomes
// `{ type:'response', id, data: { error: message, code, method } }`
// (error nested in `data`, never a sibling field). This union never
// reaches the socket verbatim.
export type DispatchResult =
  | { ok: true; data: unknown }
  | { ok: false; error: { code: string; method?: string; message?: string } };

// Standalone-native methods bypass the upstream registry entirely.
export type NativeHandler = (params: unknown) => Promise<DispatchResult>;

export function dispatch(
  method: string,
  params: unknown,
  ctx: DispatchContext,
): Promise<DispatchResult>;
```

## Three-tier dispatch

The webview emits methods from three sources (the order mirrors the
dropped `panel.ts`: native special-cases first, registry last). `dispatch`
checks them in this order:

1. **Native table.** If `method` is in `STANDALONE_NATIVE` (see below),
   run its handler and return its result. These bypass the registry
   entirely and do not need `ctx.analyzer`.
2. **Allowlist gate.** If `method` is not in `V1_ALLOWED` (imported from
   `./v1-allowed`), return
   `{ ok: false, error: { code: 'standalone-v1-disabled', method } }`.
   No log line — this is an expected path (webview hits a disabled
   method, sometimes proactively from a visible page). The banner-vs-
   silent decision is the shim's, not the dispatcher's.
3. **Data-ready guard.** If `ctx.analyzer`/`ctx.parseResult` is undefined
   (request arrived before `setData`), return
   `{ ok: false, error: { code: 'handler-error', method, message: 'data not ready' } }`.
4. **Handler lookup.** Call `getRpcHandler(method)` from
   `../webview/panel-rpc`. If it returns `null`/`undefined`, return
   `{ ok: false, error: { code: 'unknown-method', method } }` and log to
   stderr (indicates the allowlist drifted from the upstream registry).
5. **Invocation.** Call `handler(ctx.analyzer, ctx.parseResult, params)`
   and await the result.
6. **Error handling.** Wrap invocation in try/catch. On throw, log the
   stack to stderr and return
   `{ ok: false, error: { code: 'handler-error', method, message: err.message } }`.
   Never let an exception escape into the WS connection.
7. **Mutation paths.** All 40 *allowlisted* methods are read-only. The
   *native* `saveModelBudgets` writes `state.json` (via [06-state](06-state.md),
   which owns atomic-write + recovery), so the only write-side error
   handling lives in that native handler, not the registry path.

## Standalone-native handlers (`STANDALONE_NATIVE`)

Three methods the webview calls are not in the `getRpcHandler` registry —
upstream they were special-cased by `panel.ts` (`:269`, `:279`). They are
reimplemented here and checked before the allowlist:

```ts
// src/standalone/standalone-native.ts
import open from 'open';
import { readUserState, writeUserState } from './state';

export const STANDALONE_NATIVE: Record<string, NativeHandler> = {
  // page-peers.ts:336 — open a web link in the user's browser.
  openExternal: async (params) => {
    const url = (params as { url?: unknown } | undefined)?.url;
    if (typeof url !== 'string') {
      return { ok: false, error: { code: 'bad-request', method: 'openExternal', message: 'missing url' } };
    }
    let parsed: URL;
    try { parsed = new URL(url); } catch {
      return { ok: false, error: { code: 'bad-request', method: 'openExternal', message: 'invalid url' } };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      // Block file: / vscode: / custom-scheme handlers — `open` shells out to the OS.
      return { ok: false, error: { code: 'bad-request', method: 'openExternal', message: 'only http(s) urls allowed' } };
    }
    await open(parsed.href, { url: true });   // {url:true} → never treated as a filesystem path
    return { ok: true, data: { ok: true } };
  },

  // page-burndown.ts — return the budgets object UNWRAPPED (matches panel.ts:339).
  loadModelBudgets: async () => ({ ok: true, data: readUserState().modelBudgets }),

  // page-burndown.ts:95 — persist budgets; return { ok: true } (matches panel.ts:334).
  saveModelBudgets: async (params) => {
    const budgets = (params as { budgets?: Record<string, number> } | undefined)?.budgets ?? {};
    try {
      const state = readUserState();
      writeUserState({ ...state, modelBudgets: budgets });
      return { ok: true, data: { ok: true } };
    } catch (err) {
      return { ok: false, error: { code: 'handler-error', method: 'saveModelBudgets', message: 'Failed to save budgets' } };
    }
  },
};
```

`STANDALONE_NATIVE` lives in its own file so the dispatcher stays short
and the native handlers are unit-testable in isolation.

## Transitive vscode import (alias required)

`import { getRpcHandler } from '../webview/panel-rpc'` is **not**
vscode-free at module level, despite `panel-rpc.ts` itself using only
lazy `require('vscode')`. Its import of `errorResult` from
`./panel-shared` (`panel-rpc.ts:39`) pulls in `panel-shared.ts`, which has
a **top-level** `import * as vscode from 'vscode'` (`panel-shared.ts:7`).
That import executes the moment the dispatcher module loads.

The fix lives in build/test config, not here: `vscode` is aliased to
`src/standalone/vscode-stub.ts` in both the esbuild standalone entry and
the vitest config (see [00-overview](00-overview.md#additive-only-fork-discipline),
[07-build](07-build.md), [08-testing](08-testing.md)). With the alias in
place, the dispatcher's unit tests can use the **real** `panel-rpc`
instead of `vi.mock`, which is a stronger test. Do **not** "fix" this by
avoiding the `errorResult` import — importing `getRpcHandler` alone is
enough to pull in `panel-shared`.

## Decisions

| Open question                                         | Decision                                          | Why |
|-------------------------------------------------------|---------------------------------------------------|-----|
| Should the dispatcher log every successful call?      | No                                                | Volume too high; use `--log-file` for debugging |
| What if a handler returns `undefined`?                | Treat as `{ ok: true, data: null }`               | Some `getX` handlers may legitimately return nothing |
| Where does `V1_ALLOWED` live?                         | Own file (`v1-allowed.ts`)                        | Imported by both dispatcher and tests; keeps `dispatcher.ts` short |
| Native methods: own table or fold into `dispatch`?    | Front-of-line `STANDALONE_NATIVE` table           | Mirrors `panel.ts` ordering (native before registry); keeps each path independently testable |
| `openExternal` URL validation                         | `http:`/`https:` only via `new URL()`             | `open` shells out to the OS handler; blocks `file:`/custom-scheme abuse |
| Who maps the error union to the wire shape?           | The server ([01-server](01-server.md)), not the dispatcher | Dispatcher returns a clean internal union; the data-nested `{ data: { error, code } }` shape is a transport concern |
| Does dispatcher expose progress / push events?        | No                                                | Push frames originate in the CLI's parse driver and fan out via `handle.broadcast` / `handle.setData` in 01-server — not from handlers |
| `panel-rpc` transitive `vscode` import                | Aliased to `vscode-stub.ts` (build + test config) | Lets tests use the real `panel-rpc`; see [Transitive vscode import](#transitive-vscode-import) |

## Dependencies

- `src/webview/panel-rpc` (upstream) — for `getRpcHandler` (transitively
  loads `panel-shared` → `vscode`; resolved by the alias stub)
- `src/core/analyzer` (upstream) — for type only
- `src/core/types` (upstream) — for `ParseResult` type
- `./v1-allowed` (own)
- `./standalone-native` (own) — `STANDALONE_NATIVE`
- `./state` (own, [06-state](06-state.md)) — used by the budget native handlers
- npm: `open` (^10) — used by the `openExternal` native handler

**Caveat for the implementing agent:** `getRpcHandler` is currently
exported from `src/webview/panel-rpc.ts:1284`. If that export name has
changed in the upstream branch you check out, halt and ask before
modifying upstream. The contract here is that `panel-rpc.ts` is
imported as a library; we do not edit it.

## Code sketch

```ts
// src/standalone/dispatcher.ts
import { getRpcHandler } from '../webview/panel-rpc';  // pulls panel-shared → vscode (aliased to stub)
import { V1_ALLOWED } from './v1-allowed';
import { STANDALONE_NATIVE } from './standalone-native';
import type { Analyzer } from '../core/analyzer';
import type { ParseResult } from '../core/types';

export interface DispatchContext {
  analyzer?: Analyzer;
  parseResult?: ParseResult;
}

export type DispatchResult =
  | { ok: true; data: unknown }
  | { ok: false; error: { code: string; method?: string; message?: string } };

export async function dispatch(
  method: string,
  params: unknown,
  ctx: DispatchContext,
): Promise<DispatchResult> {
  // Tier 1: standalone-native methods (openExternal, model budgets).
  const native = STANDALONE_NATIVE[method];
  if (native) {
    try { return await native(params); }
    catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[coach] native handler-error in ${method}:`, err);
      return { ok: false, error: { code: 'handler-error', method, message } };
    }
  }

  // Tier 2: allowlist gate.
  if (!V1_ALLOWED.has(method)) {
    return { ok: false, error: { code: 'standalone-v1-disabled', method } };
  }

  // Tier 3a: data-ready guard (serve-then-parse).
  if (!ctx.analyzer || !ctx.parseResult) {
    return { ok: false, error: { code: 'handler-error', method, message: 'data not ready' } };
  }

  // Tier 3b: upstream registry.
  const handler = getRpcHandler(method);
  if (!handler) {
    console.error(`[coach] unknown method: ${method}`);
    return { ok: false, error: { code: 'unknown-method', method } };
  }
  try {
    const data = await handler(ctx.analyzer, ctx.parseResult, params);
    return { ok: true, data: data ?? null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[coach] handler-error in ${method}:`, err);
    return { ok: false, error: { code: 'handler-error', method, message } };
  }
}
```

## Acceptance criteria

1. Calling `dispatch('getSessions', {}, ctx)` with a real analyzer
   returns `{ ok: true, data: [...] }` matching the existing extension
   shape.
2. Calling `dispatch('saveRule', {}, ctx)` returns
   `{ ok: false, error: { code: 'standalone-v1-disabled', method: 'saveRule' } }`
   without invoking any handler.
3. Calling `dispatch('totallyMadeUp', {}, ctx)` (not in any tier) returns
   `standalone-v1-disabled` — *not* `unknown-method`. `unknown-method`
   only arises when a method **is** in `V1_ALLOWED` but `getRpcHandler`
   returns nothing (tested by stubbing the allowlist to include a method
   absent from the registry); that path logs to stderr.
4. A registry handler that throws → response is
   `{ ok: false, error: { code: 'handler-error', ... } }` and the
   process does not crash.
5. `V1_ALLOWED.size === 40`.
6. `dispatch('loadModelBudgets', {}, ctx)` returns
   `{ ok: true, data: {...} }` (the budgets object, default `{}`) **without**
   needing `ctx.analyzer` — proves native methods work before parse.
7. `dispatch('saveModelBudgets', { budgets }, ctx)` writes `state.json`
   and returns `{ ok: true, data: { ok: true } }`.
8. `dispatch('openExternal', { url: 'file:///etc/passwd' }, ctx)` returns
   a `bad-request` error and does **not** invoke `open`;
   `{ url: 'https://example.com' }` invokes `open` once.
9. `dispatch('getStats', {}, { })` with undefined analyzer returns
   `handler-error` ("data not ready"), not a crash.

## Test plan

`src/standalone/__tests__/dispatcher.test.ts`. With the `vscode` alias in
the vitest config, tests may import the **real** `panel-rpc`; use
`vi.mock('../../webview/panel-rpc', ...)` only where a fake handler is
needed (forcing a throw, or the `unknown-method` path).

| Test name                                          | Intent                                       |
|----------------------------------------------------|----------------------------------------------|
| `native method runs before allowlist`              | `loadModelBudgets` resolves with no analyzer |
| `allows whitelisted method through`                | Happy path (real or mocked handler)          |
| `blocks non-whitelisted method`                    | Asserts `standalone-v1-disabled` envelope    |
| `data-not-ready guard for registry method`         | Undefined analyzer → `handler-error`         |
| `unknown method returns unknown-method envelope`   | Stub `V1_ALLOWED` w/ method absent from registry; logs to stderr |
| `handler throw becomes handler-error envelope`     | Process does not crash                       |
| `handler returning undefined becomes data: null`   | Normalization                                |
| `V1_ALLOWED contains exactly the documented 40`    | Drift guard — pins the set                   |
| `V1_ALLOWED is frozen / readonly`                  | Defensive (cast back at compile time)        |

`src/standalone/__tests__/standalone-native.test.ts`:

| Test name                                          | Intent                                       |
|----------------------------------------------------|----------------------------------------------|
| `openExternal rejects non-http(s) url`             | `file:`/`vscode:` → `bad-request`, `open` not called |
| `openExternal rejects unparseable url`             | `new URL` throw → `bad-request`              |
| `openExternal opens http(s) url once`              | Spy on `open`                                |
| `loadModelBudgets returns {} on first run`         | Unwrapped default                            |
| `saveModelBudgets round-trips through state.json`  | Reads back via `readUserState`               |
| `saveModelBudgets returns errorResult on write fail`| Mock `writeUserState` to throw              |
