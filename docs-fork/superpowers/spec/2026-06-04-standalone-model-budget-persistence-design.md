# Standalone model-budget persistence — design

**Date:** 2026-06-04
**Status:** Approved (brainstorming) — ready for an implementation plan
**Scope owner:** fork standalone build (`src/standalone/`)
**Closes parity rows:** *Token & cost reporting* → *Model-budget persistence* (❌) and *Burndown chart* (⚠️)

## 1. Problem

The Burndown page lets the user set a per-model monthly token budget. Upstream persists
those budgets in VS Code's `globalState` Memento. The save/load path is **not** a registry
getter — the panel intercepts the two methods *before* its data-ready check and services them
directly:

- `src/webview/panel.ts:281` — `saveModelBudgets`/`loadModelBudgets` are routed to
  `handleBudgetMessage` ahead of the readiness gate.
- `src/webview/panel.ts:342` — `handleBudgetMessage` reads/writes
  `globalState` under the key `modelBudgets` (`BUDGET_STATE_KEY`, `panel.ts:340`).

The webview call sites are:

- `src/webview/page-burndown.ts:95` — `rpc('saveModelBudgets', { budgets: toSave }).catch(...)`
  (fire-and-forget; the result is ignored).
- `src/webview/page-burndown.ts:103` — `await rpc<Record<string, number>>('loadModelBudgets', {})`
  inside `loadModelBudgetsFromDisk()` (`page-burndown.ts:99`); the resolved value is the budgets
  record, merged into the in-memory `modelBudgets` at `page-burndown.ts:106-110`.
  `renderBurndown` kicks the first disk load at `page-burndown.ts:140`.

The wire contract (`src/core/types/rpc-types.ts:137-138`):

```ts
saveModelBudgets: { params: { budgets: Record<string, number> }; result: { ok: boolean } };
loadModelBudgets: { params: Record<string, unknown> | undefined; result: Record<string, number> };
```

In the standalone build there is no `globalState`. Neither method is on any allowlist, so the
dispatcher returns `standalone-v1-disabled`; `saveModelBudgets`'s `.catch` swallows it and
`loadModelBudgetsFromDisk`'s `try/catch` swallows it. The chart still works because
`vscode.setState` (webview state) survives tab switches — but **budgets are lost on page
reload / server restart**. That is the sole reason the *Burndown chart* row is ⚠️ rather than ✅.

**One fix, two rows.** There is no separate Burndown work. Exposing the two persistence methods
closes the ❌ *Model-budget persistence* row and lifts *Burndown chart* ⚠️→✅ as a consequence.

## 2. Goals / non-goals

**Goals**
- Model budgets persist across page reload and server restart in the standalone build.
- Purely additive: all new code under `src/standalone/`; zero edits to `src/` outside it
  (preserves the additive-only invariant gated by `drift-gate.sh`).
- No webview changes — the existing `page-burndown.ts` call sites work unmodified.

**Non-goals (YAGNI)**
- No generic key-value `globalState` shim. A reusable native state store is deferred until
  `reviewLocalRules`'s "standalone trust store" is actually built; this spec serves one consumer.
- No workspace-scoping. Upstream `globalState` is global across workspaces and budgets are keyed
  by model name, so the standalone store is a single global file too.
- No `page-burndown.ts` / webview edits.
- No migration tooling — `version: 1` is the first on-disk schema.

## 3. Architecture

### 3.1 Dispatch tier

Both methods join `STANDALONE_NATIVE` (`src/standalone/standalone-native.ts`), the dispatcher's
**Tier 1** (`src/standalone/dispatcher.ts:37-48`). Tier 1 is correct because:

- It bypasses the upstream registry (`getRpcHandler`) entirely — these methods have no registry
  handler; upstream services them at the panel layer.
- It does **not** require `ctx.analyzer` / `ctx.parseResult`. Budgets are user settings, not
  derived from parsed sessions, so they must work during serve-then-parse (exactly as upstream
  services them before its data-ready check).
- `openExternal` is the established precedent: a small, side-effecting native handler that
  returns a `DispatchResult`.

Tier 1 already wraps handler throws into `{ ok:false, error:{ code:'handler-error', ... } }`
(`dispatcher.ts:41-47`), so the handlers get crash-safety for free.

### 3.2 Persistence module — `src/standalone/model-budget-store.ts` (new)

The standalone replacement for `globalState`, modeled one-to-one on `src/standalone/state.ts`.

- **Location:** `~/.ai-engineer-coach/model-budgets.json`, via the existing `stateDir()`
  (`state.ts:16-20`, which `mkdir -p`s the directory).
- **On-disk shape:** `{ version: 1, budgets: Record<string, number> }` — a versioned wrapper for
  forward compatibility and corrupt-file detection (same discipline as `ServerState`).
- **`writeModelBudgets(budgets: Record<string, number>): void`** — atomic write: serialize
  `{ version: 1, budgets }`, write to `…json.tmp` with mode `0o600`, `fs.renameSync` over the
  target (the `atomicWriteJson` pattern, `state.ts:26-30`).
- **`readModelBudgets(): Record<string, number>`** — resilient read:
  - file missing → `{}`;
  - parse error → quarantine to `…json.broken-<ts>` and return `{}` (mirrors
    `readServerState`, `state.ts:49-54`);
  - `parsed.version !== 1` → warn and return `{}`;
  - valid → return the unwrapped `budgets` record (or `{}` if the field is absent/not an object).
  - Never throws — all failure paths degrade to `{}`.

> **Timestamp note.** `Date.now()` is used for the `.broken-<ts>` suffix exactly as `state.ts:50`
> already does (this is production runtime code, not a workflow script).

### 3.3 Native handlers — `src/standalone/standalone-native.ts` (extend)

Two thin handlers added to the `STANDALONE_NATIVE` map, in the style of `openExternal`
(validate → delegate → return a `DispatchResult`):

- **`saveModelBudgets(params)`**
  - If `params.budgets` is not a plain non-null object → return
    `{ ok:false, error:{ code:'bad-request', method:'saveModelBudgets', message:'missing budgets' } }`.
  - **Sanitize** before persisting: keep only entries whose key is a string and whose value is a
    finite number `> 0` (mirrors the webview's own `if (v > 0)` filter at `page-burndown.ts:88-90`,
    so zero/negative/NaN/∞ never reach disk). Cap at **200** keys (defensive bound against an
    unbounded write; well above any realistic model count) — extra keys are dropped.
  - `writeModelBudgets(sanitized)`; return `{ ok:true, data:{ ok:true } }`.
- **`loadModelBudgets()`**
  - Return `{ ok:true, data: readModelBudgets() }`. The server maps `{ ok:true, data }` to
    `{ type:'response', id, data }` (`server.ts:142-146`) and the shim resolves `rpc()` to `data`,
    so the call site receives the bare `Record<string, number>` it awaits. Params are ignored.

### 3.4 End-to-end data flow

```
[save]  page-burndown.ts:95  rpc('saveModelBudgets',{budgets})
          → webview-shim (ws send)  → server.ts dispatch()
          → Tier 1 saveModelBudgets → writeModelBudgets()
          → ~/.ai-engineer-coach/model-budgets.json   (atomic, 0o600)

[load]  page-burndown.ts:140 renderBurndown → loadModelBudgetsFromDisk()
          → :103 rpc('loadModelBudgets',{})
          → server dispatch() → Tier 1 loadModelBudgets → readModelBudgets()
          → resolves to the budgets record
          → merged into in-memory modelBudgets  (page-burndown.ts:106-110)
```

Result: budgets survive reload/restart, not just tab switches.

## 4. Error handling

- **Save, bad params:** explicit `bad-request`. The webview's `.catch` (`page-burndown.ts:95`)
  already swallows it; no UI regression.
- **Load, missing/corrupt file:** degrades to `{}` inside the store; the handler never throws.
  `loadModelBudgetsFromDisk`'s `try/catch` (`page-burndown.ts:102-119`) is preserved as a belt.
- **Unexpected throw:** caught by the Tier-1 dispatcher wrapper → `handler-error`
  (`dispatcher.ts:41-47`).
- **No new webview-shim wiring.** Because both methods now resolve via Tier 1, they never reach
  the `standalone-v1-disabled` path, so they do not belong in `BANNER_WORTHY` or
  `RESOLVE_EMPTY_WHEN_DISABLED` (`webview-shim.ts`). Implementation should confirm neither method
  is listed there (no change expected).

## 5. Testing (TDD — tests precede implementation)

- **`src/standalone/__tests__/model-budget-store.test.ts` (new)**
  - write → read roundtrip returns the same record;
  - missing file → `{}`;
  - corrupt JSON → file quarantined to `.broken-*` and returns `{}`;
  - `version !== 1` → `{}` (with warning);
  - file written with mode `0o600`;
  - atomic write leaves no `.tmp` and never a partially-written target.
  - Isolate the home dir per existing standalone test patterns (point `stateDir()` at a temp
    directory; follow how `state.test.ts` isolates the state dir).
- **`src/standalone/__tests__/standalone-native.test.ts` (extend)**
  - `saveModelBudgets` drops non-positive / non-numeric / over-cap entries;
  - `saveModelBudgets` with non-object `budgets` → `bad-request`;
  - `loadModelBudgets` returns the persisted record;
  - save → load roundtrip through the handlers.
- **`src/standalone/__tests__/dispatcher.test.ts` (extend)**
  - both methods resolve via Tier 1 with a context carrying **no** `analyzer`/`parseResult`
    (i.e. they are not gated by the allowlist and do not return `standalone-v1-disabled` or
    `data not ready`).

## 6. Definition of done — tripwire & doc updates

These are part of the deliverable, not follow-up:

- **`parity-gap.mjs` tripwire:** `STANDALONE_NATIVE` 1 → 3; exposed union 68 → 70; gap 7 → 5
  (the `saveModelBudgets` and `loadModelBudgets` entries leave the `universe \ exposed` gap list).
- **`docs-fork/STANDALONE-PARITY-GAPS.md`:**
  - *Model-budget persistence* ❌ → ✅ (note: now backed by `model-budget-store.ts` /
    `~/.ai-engineer-coach/model-budgets.json`);
  - *Burndown chart* ⚠️ → ✅ (drop the "Model-budget save/load degraded" clause);
  - update the Appendix `parity-gap` block (counts) and the "Gap methods" sentence to drop both
    `…ModelBudgets` methods.
- **Count comments:** adjust any header/inline method totals that cite a fixed count
  (`standalone-native.ts` header; `v1-allowed.ts` lead comment if it references the native count).

## 7. File-change summary

| File | Change |
|---|---|
| `src/standalone/model-budget-store.ts` | **new** — `readModelBudgets` / `writeModelBudgets` over `~/.ai-engineer-coach/model-budgets.json` (versioned, atomic, resilient) |
| `src/standalone/standalone-native.ts` | **edit** — add `saveModelBudgets` + `loadModelBudgets` native handlers |
| `src/standalone/__tests__/model-budget-store.test.ts` | **new** — store unit tests |
| `src/standalone/__tests__/standalone-native.test.ts` | **edit** — handler tests |
| `src/standalone/__tests__/dispatcher.test.ts` | **edit** — Tier-1 routing tests |
| `docs-fork/STANDALONE-PARITY-GAPS.md` | **edit** — flip both rows to ✅; update appendix counts |

No edits to `src/` outside `src/standalone/`. The additive-only invariant
(`git diff $(git merge-base HEAD upstream/main) HEAD -- src/ ':(exclude)src/standalone/'` empty)
holds.
