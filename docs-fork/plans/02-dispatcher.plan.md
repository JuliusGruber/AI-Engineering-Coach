# Dispatcher (02-dispatcher) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the standalone dispatcher — a thin three-tier bridge (`src/standalone/dispatcher.ts`) that routes an incoming RPC `method + params + context` to the upstream `getRpcHandler` registry, gated by a frozen 40-method V1 allowlist (`v1-allowed.ts`), with one front-of-line native handler (`standalone-native.ts`, `openExternal`), returning a clean internal `DispatchResult` union the server later maps to the wire shape.

**Architecture:** Three small leaf files plus a front-loaded test harness. `v1-allowed.ts` is a frozen `ReadonlySet` of exactly 40 read-only method names. `standalone-native.ts` exports `STANDALONE_NATIVE`, a `Record<string, NativeHandler>` whose sole v1 member `openExternal` validates `http:`/`https:` via `new URL()` then shells out with the `open` package. `dispatcher.ts` owns the `DispatchContext`/`DispatchResult`/`NativeHandler` types and the `dispatch()` function, which checks tiers in order: (1) native table, (2) allowlist gate, (3a) data-ready guard, (3b) registry lookup + invocation, all wrapped so no exception escapes. Because `dispatcher.ts` imports `getRpcHandler` from the reused upstream `src/webview/panel-rpc`, which transitively pulls a top-level `import * as vscode` (`panel-shared.ts:7`), the tests need a `vscode` → stub alias to resolve; this plan front-loads that alias, the stub file, and the `open` dependency (all sanctioned additive edits, shared with 07-build/08-testing).

**Tech Stack:** TypeScript (strict, ES2022 modules, `moduleResolution: bundler`), vitest (`vitest run`), the `open` npm package (^10, the one new runtime dep this spec introduces). Reuses upstream `src/webview/panel-rpc` as a library (never edited).

---

## Spec references

- Spec under implementation: `docs-fork/specs/02-dispatcher.md`
- Shared contract: `docs-fork/specs/00-overview.md` — relevant pieces:
  - **Authoritative `V1_ALLOWED` set** (40 methods) — copied verbatim into
    `v1-allowed.ts` in Task 2; the "exactly 40" test pins it.
  - **Standalone-native methods** — only `openExternal` in v1; the model-budget
    pair is deferred to v2 with the flag-gated burndown page.
  - **RPC error-shape contract** — the dispatcher returns a *clean internal union*
    (`{ ok, ... }`); the **server** (01-server) maps `{ ok:false, error }` to the
    data-nested wire shape `{ data: { error, code, method } }`. This plan does
    **not** produce the wire shape — keep the union clean.
  - **Additive-only fork discipline** — new code lives under `src/standalone/`;
    the three sanctioned shared edits (`package.json` dep, `esbuild.mjs`, vitest
    config) are additive. This plan touches `package.json` (adds `open`) and the
    vitest config (adds the `vscode` alias) — both explicitly allowed; verified in
    the final task.
  - **Why the `vscode` alias is required (not optional)** — `panel-rpc` →
    `panel-shared.ts:7` top-level `import * as vscode`.

### Dependency note — this is the 2nd plan in the queue

The dispatcher (per `00-overview.md`'s dependency table) depends only on **upstream**
modules plus its own new files; it no longer depends on `06-state` (the
model-budget handlers that used state are deferred to v2). The one
already-planned spec, `06-state.plan.md`, shares **no interfaces** with the
dispatcher, so nothing from it needs to be honored here. The contracts this plan
locks in — `dispatch`, `DispatchContext`, `DispatchResult`, `NativeHandler`,
`V1_ALLOWED`, `STANDALONE_NATIVE` — are consumed later by `01-server`; keep these
names exactly as written.

### Two corrections to the spec text (verified against the actual repo)

The spec is authoritative on intent; two incidental factual claims are slightly
off in the current checkout. Follow the plan, not the spec text, on these:

1. **`core/rule-compiler.ts` does NOT import `vscode` at module level.** It uses a
   *lazy* `require('vscode')` inside a function guarded by try/catch
   (`rule-compiler.ts:73-77`). So there is exactly **one** top-level transitive
   `vscode` chain that matters at module load: `getRpcHandler` →
   `panel-shared.ts:7`'s `import * as vscode`. The single global stub alias still
   covers everything; the rationale ("alias required") is unchanged, only the
   count of top-level chains is one, not two.
2. **The handler signature takes `params: Record<string, unknown>`, not
   `unknown`** (`panel-rpc.ts:90-96`: `TypedRpcHandlers`). `dispatch` receives
   `params: unknown`, so the registry invocation needs a cast
   (`params as Record<string, unknown>`). The spec's code sketch passes `params`
   directly, which does **not** compile under `strict`. The plan adds the cast.

## File Structure

| Path | Responsibility | Created/edited by |
|------|----------------|-------------------|
| `package.json` | Add `open@^10.1.0` to `dependencies` (additive; one of the three sanctioned deps). | Task 1 |
| `src/standalone/vscode-stub.ts` | Stub the `vscode` namespace the alias resolves to. Exact content from `07-build.md` so 07-build finds it identical. | Task 1 |
| `vitest.config.mts` | Add top-level `resolve.alias` mapping `vscode` → the stub (sanctioned additive test-config edit; mirrors the 08-testing requirement). | Task 1 |
| `src/standalone/v1-allowed.ts` | `V1_ALLOWED`: frozen `ReadonlySet<string>` of exactly 40 method names. | Task 2 |
| `src/standalone/dispatcher.ts` | `DispatchContext`/`DispatchResult`/`NativeHandler` types + `dispatch()`. Tiers 2/3 in Task 3; native tier prepended in Task 5. | Task 3 (grown in Task 5) |
| `src/standalone/standalone-native.ts` | `STANDALONE_NATIVE` table (`openExternal`). | Task 4 |
| `src/standalone/__tests__/dispatcher.test.ts` | Unit tests for `dispatch`. | Task 3 (grown in Task 5) |
| `src/standalone/__tests__/standalone-native.test.ts` | Unit tests for `openExternal`. | Task 4 |

`src/standalone/` already exists from `06-state` (if that plan ran first) or is
created implicitly by the first new file path here. The test paths match the
existing vitest `include: ['src/**/*.test.ts']`, so no include change is needed.

### Task order and why (dependency-correct, no forward references)

```
Task 1  prerequisites: open dep + vscode-stub.ts + vitest alias   (unblocks every test below)
Task 2  v1-allowed.ts            (no deps)
Task 3  dispatcher.ts: types + tiers 2/3 + non-native tests       (imports v1-allowed, panel-rpc)
Task 4  standalone-native.ts     (type-imports DispatchResult/NativeHandler from dispatcher.ts → exists after Task 3)
Task 5  dispatcher.ts: prepend native tier + native test          (value-imports STANDALONE_NATIVE from standalone-native → exists after Task 4)
Task 6  full suite + tsc + additive-only verification
```

`dispatcher.ts` and `standalone-native.ts` are mutually referential
(dispatcher value-imports `STANDALONE_NATIVE`; standalone-native type-imports
`NativeHandler`/`DispatchResult`). The cycle is broken by sequencing: the
**types** land in `dispatcher.ts` first (Task 3), the native table consumes them
(Task 4), then the dispatcher's **value** import of the table is added last
(Task 5). The type import in `standalone-native.ts` is `import type` (erased at
runtime), so there is no runtime require cycle.

## Conventions to copy (already in the repo)

- vitest imports come from `'vitest'`:
  `import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';`
- Single test file run: `npx vitest run <path>`; full suite: `npm test`.
- Strict TS, named exports only, kebab-case filenames under `src/standalone/`,
  comments only where the *why* is non-obvious (the specs carry the rationale).
- `package.json` already declares `vscode: ^1.118.0` under **`engines`** (the VS
  Code version floor) and `@types/vscode` under `devDependencies`; there is **no
  runtime `vscode` package**. That is exactly why the alias is needed for tests.

### Preconditions

If `node_modules/` is empty in your checkout, run `npm install` once before
starting (the project's existing devDeps, incl. vitest, must be present).
Task 1 then adds `open`. The plan assumes the baseline upstream suite is green
(`npm test` passes) before any changes; if it is red on a clean checkout, that is
a pre-existing issue to escalate — it is not introduced by this plan.

---

## Task 1: Test prerequisites — `open` dep, `vscode` stub, vitest alias

The dispatcher's tests load the **real** `panel-rpc` (a stronger test than mocking
the whole module) and the real `open` package. Neither resolves today: there is no
runtime `vscode` and `open` is not installed. This task front-loads the three
sanctioned additive pieces. They are shared with `07-build` (which also lists
`open` and creates the identical `vscode-stub.ts`) and `08-testing` (which also
adds the vitest alias); creating them here is idempotent — those later specs will
find them already present and matching.

**Files:**
- Modify: `package.json` (add `open` to `dependencies`)
- Create: `src/standalone/vscode-stub.ts`
- Modify: `vitest.config.mts`

- [ ] **Step 1: Install the `open` runtime dependency**

Run: `npm install open@^10.1.0`
Expected: `package.json` `dependencies` gains `"open": "^10.1.0"` (caret range
matching `07-build.md`); `package-lock.json` updates; install exits 0.

- [ ] **Step 2: Create the `vscode` stub**

Create `src/standalone/vscode-stub.ts` with the exact content `07-build.md`
specifies (so 07-build's "create vscode-stub.ts" step is a no-op later):

```ts
// src/standalone/vscode-stub.ts
// Resolves the transitive `import * as vscode` pulled in by reused webview
// files — panel-shared.ts:7 (via getRpcHandler) — AND satisfies the one live
// call on the standalone path: getDashboardHtml -> vscode.Uri.joinPath
// (panel-html.ts:11), used later by 03-standalone-html.
export const Uri = {
  joinPath: (_base: unknown, ...parts: string[]) => ({
    path: parts.join('/'),
    fsPath: parts.join('/'),
  }),
};
export default { Uri };
```

- [ ] **Step 3: Add the `vscode` alias to the vitest config**

Edit `vitest.config.mts`. Add the `node:url` import at the top and a top-level
`resolve.alias` block (sibling of `test`, not inside it):

```ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/webview/**',
        'src/extension.ts',
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 60,
        statements: 70,
      },
      reporter: ['text', 'text-summary'],
    },
  },
  resolve: {
    // Reused upstream webview modules pull a top-level `import * as vscode`
    // (panel-shared.ts:7). Map it to the standalone stub so tests importing the
    // real panel-rpc resolve. Mirrors the esbuild alias in 07-build.
    alias: {
      vscode: fileURLToPath(new URL('./src/standalone/vscode-stub.ts', import.meta.url)),
    },
  },
});
```

- [ ] **Step 4: Verify the alias does not break the existing real-`panel-rpc` tests**

Run: `npx vitest run src/webview/panel-rpc.test.ts src/webview/panel-shared.test.ts`
Expected: PASS. These existing tests import the real `panel-rpc`/`panel-shared`
(which import `vscode`); with the alias resolving `vscode` to the stub, they must
stay green. If they were already passing without the alias (Vite may elide an
unused namespace import), they still pass now — the alias is a superset. If they
fail with a `vscode` resolution error, the alias path in Step 3 is wrong (check
that `./src/standalone/vscode-stub.ts` resolves relative to the repo root).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/standalone/vscode-stub.ts vitest.config.mts
git commit -m "build(standalone): add open dep, vscode stub, and vitest vscode alias"
```

---

## Task 2: `v1-allowed.ts` — the frozen 40-method allowlist

Source-of-truth allowlist imported by the dispatcher and pinned by a drift guard
(spec acceptance #5; tests `V1_ALLOWED contains exactly the documented 40` and
`V1_ALLOWED is frozen / readonly`).

**Files:**
- Create: `src/standalone/v1-allowed.ts`
- Test: `src/standalone/__tests__/v1-allowed.test.ts`

> The spec folds these two assertions into `dispatcher.test.ts`. This plan puts
> them in their own file so the allowlist is independently testable and the
> dispatcher test file stays focused — consistent with the spec's own rationale
> for giving `V1_ALLOWED` its own source file. The test names are unchanged.

- [ ] **Step 1: Write the failing tests**

Create `src/standalone/__tests__/v1-allowed.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { V1_ALLOWED } from '../v1-allowed';

describe('V1_ALLOWED', () => {
  it('contains exactly the documented 40', () => {
    expect(V1_ALLOWED.size).toBe(40);
  });

  it('is frozen / readonly', () => {
    // Cast back to a mutable shape at compile time to attempt a write; the
    // runtime Set must reject mutation (frozen) so the size is unchanged.
    expect(() => {
      (V1_ALLOWED as Set<string>).add('saveRule');
    }).toThrow();
    expect(V1_ALLOWED.size).toBe(40);
  });

  it('includes representative read-only methods and excludes write methods', () => {
    expect(V1_ALLOWED.has('getSessions')).toBe(true);
    expect(V1_ALLOWED.has('getStats')).toBe(true);
    expect(V1_ALLOWED.has('getRegistryCatalog')).toBe(true);
    expect(V1_ALLOWED.has('saveRule')).toBe(false);
    expect(V1_ALLOWED.has('getRuleEditor')).toBe(false); // deliberately excluded
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/standalone/__tests__/v1-allowed.test.ts`
Expected: FAIL — `Failed to resolve import "../v1-allowed"` (file does not exist).

- [ ] **Step 3: Write minimal implementation**

Create `src/standalone/v1-allowed.ts`. The 40 names are copied verbatim from
`00-overview.md` (the authoritative set). `Object.freeze` makes mutation throw in
strict mode so the "frozen" test passes:

```ts
// src/standalone/v1-allowed.ts
// The authoritative v1 method allowlist (see docs-fork/specs/00-overview.md).
// All 40 are read-only upstream getRpcHandler methods. getRuleEditor is
// deliberately excluded (its handler calls require('vscode')).
export const V1_ALLOWED: ReadonlySet<string> = Object.freeze(
  new Set<string>([
    'getWorkspaces', 'getHarnesses', 'getHarnessBreakdown',
    'getDailyActivity', 'getWorkspaceBreakdown', 'getHourlyDistribution',
    'getHeatmap', 'getCodeProduction', 'getConsumption', 'getBurndown',
    'getAiCredits', 'getAiCreditBurndown', 'getTokenCoverage',
    'getDayTimeline', 'getSessions', 'getSessionDetail',
    'getWorkLifeBalance', 'getAntiPatterns', 'getHarnessComparison',
    'getParserCoverage', 'getParserPreview', 'getWorkflowOptimization',
    'getStats', 'getConfigHealth', 'getInsights', 'getFlowState',
    'getContextManagement', 'getWorkspaceContextSessions',
    'getContextRangeAvailability', 'getCalendarActivity',
    'getProjectOverview', 'getImageGallery', 'getSessionImages',
    'getRuleCoverage', 'getFieldSchema', 'getMetricPrimitives',
    'getFunctionCatalog', 'getMetricList', 'getDataExplorerFields',
    'getRegistryCatalog',
  ]),
);
```

> Note: `Object.freeze(new Set(...))` freezes the Set object so `.add()` throws in
> strict mode (test files run as ES modules → strict). The entries themselves stay
> usable via `.has()`/`.size`. If your Node version silently no-ops the frozen
> `.add()` instead of throwing, the second assertion's `.toThrow()` would fail —
> in that case the size assertion right after still guarantees no mutation took
> effect; keep the `.toThrow()` as the primary intent (Node 20 strict throws).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/standalone/__tests__/v1-allowed.test.ts`
Expected: PASS — 3 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/standalone/v1-allowed.ts src/standalone/__tests__/v1-allowed.test.ts
git commit -m "feat(standalone): add frozen V1_ALLOWED 40-method allowlist"
```

---

## Task 3: `dispatcher.ts` — types + allowlist/data-ready/registry tiers

Creates the dispatcher with its public types and tiers 2 (allowlist gate),
3a (data-ready guard), and 3b (registry lookup + invocation + error handling).
The native tier (tier 1) is added in Task 5 once `standalone-native.ts` exists.
Covers spec acceptance #1, #2, #3, #4, #7 and dispatcher test-plan rows for the
non-native paths.

**Files:**
- Create: `src/standalone/dispatcher.ts`
- Test: `src/standalone/__tests__/dispatcher.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/standalone/__tests__/dispatcher.test.ts`. The file-level `vi.mock`
uses `importOriginal` so the **real** `panel-rpc` still loads (exercising the
`vscode` alias from Task 1) while `getRpcHandler` becomes a `vi.fn` we can steer
per-test. `fakeHandler` casts a plain async function to the registry's
`RpcHandler` type so we never have to build a real `Analyzer`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as panelRpc from '../../webview/panel-rpc';
import type { RpcHandler } from '../../webview/panel-rpc';
import { dispatch, type DispatchContext } from '../dispatcher';
import type { Analyzer } from '../../core/analyzer';
import type { ParseResult } from '../../core/cache';

// Load the REAL panel-rpc (resolving the transitive `vscode` via the stub alias),
// but wrap getRpcHandler so each test can inject a fake handler / undefined.
vi.mock('../../webview/panel-rpc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../webview/panel-rpc')>();
  return { ...actual, getRpcHandler: vi.fn(actual.getRpcHandler) };
});

const mockedGetRpcHandler = vi.mocked(panelRpc.getRpcHandler);

// A context with data "ready". Handlers are mocked, so empty objects are fine.
const readyCtx: DispatchContext = {
  analyzer: {} as unknown as Analyzer,
  parseResult: {} as unknown as ParseResult,
};

// Cast a plain async fn to the registry handler type for injection.
const fakeHandler = (fn: (...args: unknown[]) => unknown): RpcHandler =>
  fn as unknown as RpcHandler;

afterEach(() => {
  vi.restoreAllMocks();        // restores console spies
  mockedGetRpcHandler.mockReset();
});

describe('dispatch — allowlist gate', () => {
  it('blocks non-whitelisted method (no log line)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await dispatch('saveRule', {}, readyCtx);
    expect(res).toEqual({
      ok: false,
      error: { code: 'standalone-v1-disabled', method: 'saveRule' },
    });
    expect(errSpy).not.toHaveBeenCalled();
    expect(mockedGetRpcHandler).not.toHaveBeenCalled();
  });

  it('unknown input (in no tier) returns standalone-v1-disabled, not unknown-method', async () => {
    const res = await dispatch('totallyMadeUp', {}, readyCtx);
    expect(res).toEqual({
      ok: false,
      error: { code: 'standalone-v1-disabled', method: 'totallyMadeUp' },
    });
  });
});

describe('dispatch — data-ready guard', () => {
  it('returns handler-error "data not ready" when analyzer is undefined', async () => {
    const res = await dispatch('getStats', {}, {});
    expect(res).toEqual({
      ok: false,
      error: { code: 'handler-error', method: 'getStats', message: 'data not ready' },
    });
    expect(mockedGetRpcHandler).not.toHaveBeenCalled();
  });
});

describe('dispatch — registry tier', () => {
  it('allows a whitelisted method through (mocked handler)', async () => {
    mockedGetRpcHandler.mockReturnValueOnce(fakeHandler(async () => ({ value: 42 })));
    const res = await dispatch('getStats', {}, readyCtx);
    expect(res).toEqual({ ok: true, data: { value: 42 } });
    expect(mockedGetRpcHandler).toHaveBeenCalledWith('getStats');
  });

  it('normalizes a handler returning undefined to data: null', async () => {
    mockedGetRpcHandler.mockReturnValueOnce(fakeHandler(async () => undefined));
    const res = await dispatch('getStats', {}, readyCtx);
    expect(res).toEqual({ ok: true, data: null });
  });

  it('wraps a thrown handler error as a handler-error envelope (no crash)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedGetRpcHandler.mockReturnValueOnce(
      fakeHandler(async () => {
        throw new Error('boom');
      }),
    );
    const res = await dispatch('getStats', {}, readyCtx);
    expect(res).toEqual({
      ok: false,
      error: { code: 'handler-error', method: 'getStats', message: 'boom' },
    });
    expect(errSpy).toHaveBeenCalled();
  });

  it('returns unknown-method when an allowlisted method has no registry handler', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedGetRpcHandler.mockReturnValueOnce(undefined); // allowlisted but absent from registry
    const res = await dispatch('getStats', {}, readyCtx);
    expect(res).toEqual({
      ok: false,
      error: { code: 'unknown-method', method: 'getStats' },
    });
    expect(errSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/standalone/__tests__/dispatcher.test.ts`
Expected: FAIL — `Failed to resolve import "../dispatcher"` (file does not exist).
(If instead you see a `Cannot find module 'vscode'` error, Task 1's alias is not
in effect — fix that before continuing.)

- [ ] **Step 3: Write minimal implementation**

Create `src/standalone/dispatcher.ts` with the types and tiers 2/3 (no native tier
yet — it is prepended in Task 5). Note the `params as Record<string, unknown>`
cast on the registry call (the handler signature requires it under `strict`):

```ts
// src/standalone/dispatcher.ts
import { getRpcHandler } from '../webview/panel-rpc'; // pulls panel-shared -> vscode (aliased to stub)
import { V1_ALLOWED } from './v1-allowed';
import type { Analyzer } from '../core/analyzer';
import type { ParseResult } from '../core/cache';

export interface DispatchContext {
  // Optional: the server serves before the parse finishes (serve-then-parse).
  // A registry method dispatched while these are still undefined returns a
  // handler-error ("data not ready").
  analyzer?: Analyzer;
  parseResult?: ParseResult;
}

// Internal discriminated union. The SERVER (01-server) maps `{ ok:false, error }`
// to the webview wire shape `{ type:'response', id, data: { error, code, method } }`.
// This union never reaches the socket verbatim.
export type DispatchResult =
  | { ok: true; data: unknown }
  | { ok: false; error: { code: string; method?: string; message?: string } };

// Standalone-native methods bypass the upstream registry entirely.
export type NativeHandler = (params: unknown) => Promise<DispatchResult>;

export async function dispatch(
  method: string,
  params: unknown,
  ctx: DispatchContext,
): Promise<DispatchResult> {
  // Tier 1 (native table) is prepended in Task 5.

  // Tier 2: allowlist gate. Expected path (webview may hit a disabled method
  // proactively); no log line.
  if (!V1_ALLOWED.has(method)) {
    return { ok: false, error: { code: 'standalone-v1-disabled', method } };
  }

  // Tier 3a: data-ready guard (serve-then-parse).
  if (!ctx.analyzer || !ctx.parseResult) {
    return { ok: false, error: { code: 'handler-error', method, message: 'data not ready' } };
  }

  // Tier 3b: upstream registry lookup + invocation.
  const handler = getRpcHandler(method);
  if (!handler) {
    console.error(`[coach] unknown method: ${method}`);
    return { ok: false, error: { code: 'unknown-method', method } };
  }
  try {
    const data = await handler(ctx.analyzer, ctx.parseResult, params as Record<string, unknown>);
    return { ok: true, data: data ?? null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[coach] handler-error in ${method}:`, err);
    return { ok: false, error: { code: 'handler-error', method, message } };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/standalone/__tests__/dispatcher.test.ts`
Expected: PASS — 6 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/standalone/dispatcher.ts src/standalone/__tests__/dispatcher.test.ts
git commit -m "feat(standalone): add dispatcher allowlist/data-ready/registry tiers"
```

---

## Task 4: `standalone-native.ts` — the `openExternal` native handler

Adds the front-of-line native table with its sole v1 member, `openExternal`,
which validates `http:`/`https:` via `new URL()` then shells out with `open`
(spec acceptance #6; tests `openExternal rejects non-http(s) url`,
`openExternal rejects unparseable url`, `openExternal opens http(s) url once`).

**Files:**
- Create: `src/standalone/standalone-native.ts`
- Test: `src/standalone/__tests__/standalone-native.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/standalone/__tests__/standalone-native.test.ts`. Mock `open` so the
test never launches a real browser:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import open from 'open';
import { STANDALONE_NATIVE } from '../standalone-native';

vi.mock('open', () => ({ default: vi.fn() }));
const mockedOpen = vi.mocked(open);

afterEach(() => {
  vi.clearAllMocks();
});

describe('STANDALONE_NATIVE.openExternal', () => {
  it('rejects a non-http(s) url and does not call open', async () => {
    const res = await STANDALONE_NATIVE.openExternal({ url: 'file:///etc/passwd' });
    expect(res).toEqual({
      ok: false,
      error: { code: 'bad-request', method: 'openExternal', message: 'only http(s) urls allowed' },
    });
    expect(mockedOpen).not.toHaveBeenCalled();
  });

  it('rejects an unparseable url and does not call open', async () => {
    const res = await STANDALONE_NATIVE.openExternal({ url: 'not a url' });
    expect(res).toEqual({
      ok: false,
      error: { code: 'bad-request', method: 'openExternal', message: 'invalid url' },
    });
    expect(mockedOpen).not.toHaveBeenCalled();
  });

  it('rejects a missing url and does not call open', async () => {
    const res = await STANDALONE_NATIVE.openExternal({});
    expect(res).toEqual({
      ok: false,
      error: { code: 'bad-request', method: 'openExternal', message: 'missing url' },
    });
    expect(mockedOpen).not.toHaveBeenCalled();
  });

  it('opens an http(s) url exactly once with {url:true}', async () => {
    const res = await STANDALONE_NATIVE.openExternal({ url: 'https://example.com' });
    expect(res).toEqual({ ok: true, data: { ok: true } });
    expect(mockedOpen).toHaveBeenCalledTimes(1);
    expect(mockedOpen).toHaveBeenCalledWith('https://example.com/', { url: true });
  });
});
```

`new URL('https://example.com').href` normalizes to `'https://example.com/'`
(trailing slash) — that is the value asserted above.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/standalone/__tests__/standalone-native.test.ts`
Expected: FAIL — `Failed to resolve import "../standalone-native"` (file does not
exist).

- [ ] **Step 3: Write minimal implementation**

Create `src/standalone/standalone-native.ts`. It type-imports `DispatchResult`/
`NativeHandler` from `./dispatcher` (created in Task 3); `import type` is erased at
runtime, so there is no require cycle with the dispatcher:

```ts
// src/standalone/standalone-native.ts
import open from 'open';
import type { DispatchResult, NativeHandler } from './dispatcher';

export const STANDALONE_NATIVE: Record<string, NativeHandler> = {
  // page-peers.ts:336 — open a web link in the user's browser.
  openExternal: async (params): Promise<DispatchResult> => {
    const url = (params as { url?: unknown } | undefined)?.url;
    if (typeof url !== 'string') {
      return { ok: false, error: { code: 'bad-request', method: 'openExternal', message: 'missing url' } };
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, error: { code: 'bad-request', method: 'openExternal', message: 'invalid url' } };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      // Block file: / vscode: / custom-scheme handlers — `open` shells out to the OS.
      return { ok: false, error: { code: 'bad-request', method: 'openExternal', message: 'only http(s) urls allowed' } };
    }
    await open(parsed.href, { url: true }); // {url:true} → never treated as a filesystem path
    return { ok: true, data: { ok: true } };
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/standalone/__tests__/standalone-native.test.ts`
Expected: PASS — 4 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/standalone/standalone-native.ts src/standalone/__tests__/standalone-native.test.ts
git commit -m "feat(standalone): add openExternal native handler"
```

---

## Task 5: Wire the native tier into `dispatch` (front of line)

Prepends tier 1 (native table) to `dispatch`, so native methods resolve **before**
the allowlist gate and **without** needing `ctx.analyzer` (spec acceptance #6;
test `native method runs before allowlist`).

**Files:**
- Modify: `src/standalone/dispatcher.ts`
- Modify: `src/standalone/__tests__/dispatcher.test.ts`

- [ ] **Step 1: Write the failing test**

Add an `open` mock at the top of `src/standalone/__tests__/dispatcher.test.ts`
(so the native handler does not launch a browser), and a new `describe` block.

Add these two lines just below the existing imports:

```ts
import open from 'open';
vi.mock('open', () => ({ default: vi.fn() }));
const mockedOpen = vi.mocked(open);
```

Then append this block:

```ts
describe('dispatch — native tier', () => {
  it('runs a native method before the allowlist, with no analyzer', async () => {
    // openExternal is NOT in V1_ALLOWED; it must resolve via STANDALONE_NATIVE
    // ahead of the gate, and must not require ctx.analyzer/parseResult.
    const res = await dispatch('openExternal', { url: 'https://example.com' }, {});
    expect(res).toEqual({ ok: true, data: { ok: true } });
    expect(mockedOpen).toHaveBeenCalledTimes(1);
    expect(mockedGetRpcHandler).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/standalone/__tests__/dispatcher.test.ts`
Expected: FAIL on the new test — with no native tier yet, `openExternal` is not in
`V1_ALLOWED`, so `dispatch` returns
`{ ok: false, error: { code: 'standalone-v1-disabled', method: 'openExternal' } }`
instead of `{ ok: true, data: { ok: true } }`. The 6 earlier tests still pass.

- [ ] **Step 3: Write minimal implementation**

In `src/standalone/dispatcher.ts`, add the `STANDALONE_NATIVE` import and prepend
the native tier at the very top of `dispatch` (before the allowlist gate).

Add to the imports:

```ts
import { STANDALONE_NATIVE } from './standalone-native';
```

Insert at the start of the `dispatch` body, replacing the
`// Tier 1 (native table) is prepended in Task 5.` comment:

```ts
  // Tier 1: standalone-native methods (openExternal). These bypass the registry
  // and do not need ctx.analyzer.
  const native = STANDALONE_NATIVE[method];
  if (native) {
    try {
      return await native(params);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[coach] native handler-error in ${method}:`, err);
      return { ok: false, error: { code: 'handler-error', method, message } };
    }
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/standalone/__tests__/dispatcher.test.ts`
Expected: PASS — 7 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/standalone/dispatcher.ts src/standalone/__tests__/dispatcher.test.ts
git commit -m "feat(standalone): dispatch native methods before the allowlist gate"
```

---

## Task 6: Full-suite run, type-check, and additive-only verification

Confirms the new modules pass the whole project runner, type-check under strict,
and respect the fork's additive-only discipline (`00-overview.md` →
"Additive-only fork discipline"; global acceptance #11).

**Files:** none (verification only).

- [ ] **Step 1: Run the full vitest suite**

Run: `npm test`
Expected: PASS — the whole suite is green, including the new
`v1-allowed.test.ts` (3), `dispatcher.test.ts` (7), and
`standalone-native.test.ts` (4). No pre-existing suite (incl.
`panel-rpc.test.ts`, `panel-shared.test.ts`, `rule-compiler.test.ts`) regresses
under the new `vscode` alias. If a pre-existing test now fails, stop and
investigate — the alias is meant to be a superset of prior behavior.

- [ ] **Step 2: TypeScript strict check**

Run: `npx tsc --noEmit`
Expected: no errors. Confirms the `params as Record<string, unknown>` cast, the
`import type` cycle break, and the frozen-Set typing all hold under strict.

- [ ] **Step 3: Verify additive-only fork discipline (src/)**

Run: `git diff upstream/main -- src/ | grep -E '^[-+]' | grep -vE '^[-+]{3}'`
Expected: every line is an addition (`+`) inside `src/standalone/`. The only new
`src/` files are `v1-allowed.ts`, `dispatcher.ts`, `standalone-native.ts`,
`vscode-stub.ts`, and the three `__tests__/*.test.ts`. No deletions and no edits
outside `src/standalone/`.
(If `upstream/main` is not configured: `git remote add upstream <url> && git fetch upstream`.)

- [ ] **Step 4: Verify the shared-file edits are additive only**

Run: `git diff upstream/main -- package.json vitest.config.mts`
Expected: additions only — `package.json` gains the `"open": "^10.1.0"`
dependency line; `vitest.config.mts` gains the `node:url` import and the
`resolve.alias` block. No `-` lines that remove or change an existing value.
These are the two sanctioned shared edits for this spec (`esbuild.mjs` is **not**
touched here — that build-side alias belongs to `07-build`).

- [ ] **Step 5: Confirm `dispatcher.ts` has no direct `vscode` reference**

Run: `grep -rn "vscode" src/standalone/dispatcher.ts src/standalone/standalone-native.ts src/standalone/v1-allowed.ts`
Expected: no matches. The `vscode` pull is purely transitive (via `panel-rpc`);
the standalone source never imports it directly.

- [ ] **Step 6: Final commit (only if Steps 1–5 required a fix)**

If Steps 1–5 surfaced nothing, there is nothing to commit. If a fix was needed:

```bash
git add src/standalone/ package.json vitest.config.mts
git commit -m "test(standalone): verify dispatcher passes full suite and additive checks"
```

---

## Acceptance criteria mapping (self-review)

Every acceptance criterion in `docs-fork/specs/02-dispatcher.md` maps to a task/test:

| Spec acceptance criterion | Task | Test |
|---------------------------|------|------|
| 1. `getSessions` happy path returns `{ ok: true, data }` | Task 3 | `allows a whitelisted method through (mocked handler)` (uses `getStats`; same registry path) |
| 2. `saveRule` → `standalone-v1-disabled`, no handler invoked | Task 3 | `blocks non-whitelisted method (no log line)` |
| 3. `totallyMadeUp` → `standalone-v1-disabled`, not `unknown-method` | Task 3 | `unknown input (in no tier) returns standalone-v1-disabled, not unknown-method` |
| 4. thrown handler → `handler-error`, process survives | Task 3 | `wraps a thrown handler error as a handler-error envelope (no crash)` |
| 5. `V1_ALLOWED.size === 40` | Task 2 | `contains exactly the documented 40` |
| 6. `openExternal` `file:` → `bad-request`, no `open`; `https` → `open` once, no analyzer | Tasks 4 & 5 | `rejects a non-http(s) url and does not call open`; `opens an http(s) url exactly once`; `runs a native method before the allowlist, with no analyzer` |
| 7. `getStats` with undefined analyzer → `handler-error` "data not ready" | Task 3 | `returns handler-error "data not ready" when analyzer is undefined` |

Dispatcher **test-plan** rows (`02-dispatcher.md`) all covered:
`native method runs before allowlist` (Task 5),
`allows whitelisted method through` (Task 3),
`blocks non-whitelisted method` (Task 3),
`data-not-ready guard for registry method` (Task 3),
`unknown method returns unknown-method envelope` (Task 3 — via mocked
`getRpcHandler` returning `undefined` for an allowlisted method, the equivalent of
the spec's "stub `V1_ALLOWED` with a method absent from the registry"; logs to
stderr),
`handler throw becomes handler-error envelope` (Task 3),
`handler returning undefined becomes data: null` (Task 3),
`V1_ALLOWED contains exactly the documented 40` (Task 2),
`V1_ALLOWED is frozen / readonly` (Task 2).

`standalone-native.test.ts` rows all covered:
`openExternal rejects non-http(s) url` (Task 4),
`openExternal rejects unparseable url` (Task 4),
`openExternal opens http(s) url once` (Task 4),
plus an extra `missing url` case (Task 4) pinning the `typeof url !== 'string'`
branch.

**Type-consistency check:** `dispatch`, `DispatchContext`, `DispatchResult`,
`NativeHandler` are defined once in `dispatcher.ts` (Task 3) and consumed unchanged
by `standalone-native.ts` (Task 4, `import type`) and the tests. `STANDALONE_NATIVE`
is spelled identically in `standalone-native.ts` and the dispatcher import (Task 5).
`V1_ALLOWED` is the single export of `v1-allowed.ts` (Task 2) and the only thing
the dispatcher imports from it. These names are the contract `01-server` will
consume — do not rename them in later plans.

**Placeholder scan:** no TBD/TODO/"handle edge cases"/"similar to" — every code
step shows complete, compilable code; every run step shows the exact command and
expected output. The only deliberately deferred element is tier 1, which is added
as real code in Task 5 (not a placeholder return).

**Deviations from the spec text, all intentional and noted inline:**
- `V1_ALLOWED`/frozen tests live in `v1-allowed.test.ts` rather than
  `dispatcher.test.ts` (same test names; keeps files focused).
- Registry call casts `params as Record<string, unknown>` (the spec sketch omits
  it; required by the real handler signature under `strict`).
- `unknown-method` is exercised by mocking `getRpcHandler` to return `undefined`
  rather than stubbing `V1_ALLOWED` (cleaner with the file-level mock; same code
  path and stderr log).
- This plan front-loads `open`, `vscode-stub.ts`, and the vitest `vscode` alias
  (Task 1) because the dispatcher is the first module that needs them; they are
  idempotent with `07-build`/`08-testing`.
