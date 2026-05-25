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
| `src/standalone/dispatcher.ts`                  | dispatch() function           | ~30 |
| `src/standalone/__tests__/dispatcher.test.ts`   | Unit tests                    | ~80 |

## Public API

```ts
// src/standalone/dispatcher.ts

import type { Analyzer } from '../core/analyzer';
import type { ParseResult } from '../core/types';

export interface DispatchContext {
  analyzer: Analyzer;
  parseResult: ParseResult;
}

export type DispatchResult =
  | { ok: true; data: unknown }
  | { ok: false; error: { code: string; method?: string; message?: string } };

export function dispatch(
  method: string,
  params: unknown,
  ctx: DispatchContext,
): Promise<DispatchResult>;
```

## Behavior

1. **Allowlist gate.** If `method` is not in `V1_ALLOWED` (imported
   from `./v1-allowed`), return
   `{ ok: false, error: { code: 'standalone-v1-disabled', method } }`.
   No log line (this is an expected path — webview hits a disabled deep
   link).
2. **Handler lookup.** Call `getRpcHandler(method)` from
   `../webview/panel-rpc`. If it returns `null`, return
   `{ ok: false, error: { code: 'unknown-method', method } }` and log
   to stderr (this would indicate the allowlist has drifted from the
   upstream registry).
3. **Invocation.** Call the handler as
   `handler(ctx.analyzer, ctx.parseResult, params)`. Await the result.
4. **Error handling.** Wrap the invocation in try/catch. On throw, log
   the stack to stderr and return
   `{ ok: false, error: { code: 'handler-error', method, message: err.message } }`.
   Never let an exception escape into the WS connection.
5. **No mutation paths.** All 40 allowlisted methods are read-only.
   The dispatcher does not need write-side error handling, transaction
   semantics, or rollback.

## Decisions

| Open question                                         | Decision                                          | Why |
|-------------------------------------------------------|---------------------------------------------------|-----|
| Should the dispatcher log every successful call?      | No                                                | Volume too high; use `--log-file` for debugging |
| What if a handler returns `undefined`?                | Treat as `{ ok: true, data: null }`               | Some `getX` handlers may legitimately return nothing |
| Where does `V1_ALLOWED` live?                         | Own file (`v1-allowed.ts`)                        | Imported by both dispatcher and tests; keeps `dispatcher.ts` short |
| Does dispatcher expose progress / push events?        | No (out of scope)                                 | Push events flow directly from handlers via a separate channel set up in 01-server |

## Dependencies

- `src/webview/panel-rpc` (upstream) — for `getRpcHandler`
- `src/core/analyzer` (upstream) — for type only
- `src/core/types` (upstream) — for `ParseResult` type
- `./v1-allowed` (own)

**Caveat for the implementing agent:** `getRpcHandler` is currently
exported from `src/webview/panel-rpc.ts:1284`. If that export name has
changed in the upstream branch you check out, halt and ask before
modifying upstream. The contract here is that `panel-rpc.ts` is
imported as a library; we do not edit it.

## Code sketch

```ts
// src/standalone/dispatcher.ts
import { getRpcHandler } from '../webview/panel-rpc';
import { V1_ALLOWED } from './v1-allowed';
import type { Analyzer } from '../core/analyzer';
import type { ParseResult } from '../core/types';

export interface DispatchContext {
  analyzer: Analyzer;
  parseResult: ParseResult;
}

export type DispatchResult =
  | { ok: true; data: unknown }
  | { ok: false; error: { code: string; method?: string; message?: string } };

export async function dispatch(
  method: string,
  params: unknown,
  ctx: DispatchContext,
): Promise<DispatchResult> {
  if (!V1_ALLOWED.has(method)) {
    return { ok: false, error: { code: 'standalone-v1-disabled', method } };
  }
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
3. Calling `dispatch('totallyMadeUp', {}, ctx)` returns
   `{ ok: false, error: { code: 'unknown-method', method: 'totallyMadeUp' } }`
   and logs to stderr.
4. A handler that throws → response is
   `{ ok: false, error: { code: 'handler-error', ... } }` and the
   process does not crash.
5. `V1_ALLOWED.size === 40`.

## Test plan

All under `src/standalone/__tests__/dispatcher.test.ts`. Use vitest's
`vi.mock('../../webview/panel-rpc', ...)` to install fake handlers.

| Test name                                          | Intent                                       |
|----------------------------------------------------|----------------------------------------------|
| `allows whitelisted method through`                | Happy path                                   |
| `blocks non-whitelisted method`                    | Asserts `standalone-v1-disabled` envelope    |
| `unknown method returns unknown-method envelope`   | And logs to stderr (capture)                 |
| `handler throw becomes handler-error envelope`     | Process does not crash                       |
| `handler returning undefined becomes data: null`   | Normalization                                |
| `V1_ALLOWED contains exactly the documented 40`    | Drift guard — pins the set                   |
| `V1_ALLOWED is frozen / readonly`                  | Defensive (cast back at compile time)        |
