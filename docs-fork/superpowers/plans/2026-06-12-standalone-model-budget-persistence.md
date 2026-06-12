# Standalone Model-Budget Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Burndown-page model budgets survive page reload / server restart in the standalone build by exposing `saveModelBudgets`/`loadModelBudgets` as Tier-1 native handlers backed by `~/.ai-engineer-coach/model-budgets.json`.

**Architecture:** A new persistence module `src/standalone/model-budget-store.ts` (modeled on `state.ts`: versioned wrapper, atomic `0o600` write, quarantine-on-corrupt read) plus two thin handlers added to `STANDALONE_NATIVE`, the dispatcher's Tier 1 — which bypasses the allowlist and needs no `ctx.analyzer`, exactly how upstream services these methods at the panel layer ahead of its readiness gate. Zero webview changes; the existing `page-burndown.ts` call sites work unmodified.

**Tech Stack:** TypeScript, Node `fs`, vitest 4 (unit tests in `src/standalone/__tests__/`, run via `npm run test`).

**Spec:** `docs-fork/superpowers/spec/2026-06-04-standalone-model-budget-persistence-design.md` (verified against main `dc99a22` on 2026-06-12 — all line refs current).

**Branch:** work on `feat/standalone-model-budget-persistence` (already carries the spec commit). Do NOT merge to main or push.

**Constraints (read before coding):**

- **Additive-only invariant:** every `src/` edit stays inside `src/standalone/`. Run `bash .claude/skills/merging-upstream/scripts/drift-gate.sh` at the end — it must print `VERDICT: INVARIANT OK`.
- **Mock `os.homedir` via `vi.mock` + `vi.hoisted`** (the pattern in `src/standalone/__tests__/state.test.ts:13-23`). `vi.spyOn(os, 'homedir')` throws under vitest ESM — do not use it.
- **`STANDALONE_NATIVE` keys must be 2-space-indented top-level keys** of the object literal. The parity tripwire (`.claude/skills/merging-upstream/scripts/parity-gap.mjs:62`) parses them with `^  ([A-Za-z_$][\w$]*)\s*:` — a nested or differently-indented key is invisible to it.
- **The tripwire reads allowlists from `git show HEAD:`**, not the working tree — run it only AFTER committing Task 2.
- **`Date.now()` is fine here** — this is production runtime code (same as `state.ts:50`), not a workflow script.

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `src/standalone/state.ts` | edit (1 word) | export the existing private `atomicWriteJson` for reuse |
| `src/standalone/model-budget-store.ts` | **new** | read/write `~/.ai-engineer-coach/model-budgets.json` (versioned, atomic, never-throws read) |
| `src/standalone/standalone-native.ts` | edit | add `saveModelBudgets` + `loadModelBudgets` handlers (validate → sanitize → delegate) |
| `src/standalone/__tests__/model-budget-store.test.ts` | **new** | store unit tests (temp homedir) |
| `src/standalone/__tests__/standalone-native.test.ts` | edit | handler tests (sanitization, bad-request, roundtrip) |
| `src/standalone/__tests__/dispatcher.test.ts` | edit | pin Tier-1 routing with empty ctx (store mocked) |
| `.claude/skills/merging-upstream/scripts/parity-gap.mjs` | edit | `BASELINE` → `{ v1: 52, service: 15, native: 3, exposed: 70 }` |
| `docs-fork/STANDALONE-PARITY-GAPS.md` | edit | flip 2 rows to ✅, update appendix counts + gap-method sentence |

No edits to `src/webview/`, `src/core/`, or anything else outside `src/standalone/`.

---

### Task 1: Persistence module `model-budget-store.ts`

**Files:**
- Modify: `src/standalone/state.ts:26` (export `atomicWriteJson`)
- Create: `src/standalone/model-budget-store.ts`
- Test: `src/standalone/__tests__/model-budget-store.test.ts`

- [x] **Step 1: Export `atomicWriteJson` from `state.ts`**

In `src/standalone/state.ts:26`, change:

```ts
function atomicWriteJson(filePath: string, value: unknown): void {
```

to:

```ts
export function atomicWriteJson(filePath: string, value: unknown): void {
```

(One keyword. The store reuses it instead of duplicating the tmp-write-rename dance. `state.ts` is a fork file — invariant-safe.)

- [x] **Step 2: Write the failing store tests**

Create `src/standalone/__tests__/model-budget-store.test.ts`:

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readModelBudgets, writeModelBudgets } from '../model-budget-store';
import { stateDir } from '../state';

const mockOs = vi.hoisted(() => ({
  homedir: vi.fn(),
}));

vi.mock('os', async () => {
  const actual = await vi.importActual('os');
  return {
    ...actual,
    homedir: mockOs.homedir,
  };
});

let tmpHome: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-budget-'));
  mockOs.homedir.mockReturnValue(tmpHome);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

const budgetsFile = () => path.join(stateDir(), 'model-budgets.json');

describe('read/write round-trip', () => {
  it('returns {} when the file is missing', () => {
    expect(readModelBudgets()).toEqual({});
  });

  it('write then read round-trips the record', () => {
    const budgets = { 'claude-fable-5': 500000, 'gpt-5': 250000 };
    writeModelBudgets(budgets);
    expect(readModelBudgets()).toEqual(budgets);
  });

  it('persists a versioned wrapper on disk', () => {
    writeModelBudgets({ m: 1 });
    const raw = JSON.parse(fs.readFileSync(budgetsFile(), 'utf8'));
    expect(raw).toEqual({ version: 1, budgets: { m: 1 } });
  });

  it('atomic write leaves no .tmp on success', () => {
    writeModelBudgets({ m: 1 });
    expect(fs.existsSync(`${budgetsFile()}.tmp`)).toBe(false);
  });
});

describe('corruption recovery', () => {
  it('quarantines corrupt JSON to .broken-* and returns {}', () => {
    fs.writeFileSync(budgetsFile(), 'not valid json {{{');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(readModelBudgets()).toEqual({});

    const broken = fs
      .readdirSync(stateDir())
      .filter((f) => f.startsWith('model-budgets.json.broken-'));
    expect(broken).toHaveLength(1);
    expect(fs.existsSync(budgetsFile())).toBe(false);
    expect(warn).toHaveBeenCalled();
  });
});

describe('schema version', () => {
  it('warns and returns {} on unknown version, without quarantining', () => {
    fs.writeFileSync(budgetsFile(), JSON.stringify({ version: 99, budgets: { m: 1 } }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(readModelBudgets()).toEqual({});
    expect(warn).toHaveBeenCalled();
    expect(fs.existsSync(budgetsFile())).toBe(true); // not overwritten, not quarantined
  });

  it('returns {} when budgets field is absent or not an object', () => {
    fs.writeFileSync(budgetsFile(), JSON.stringify({ version: 1 }));
    expect(readModelBudgets()).toEqual({});
    fs.writeFileSync(budgetsFile(), JSON.stringify({ version: 1, budgets: [1, 2] }));
    expect(readModelBudgets()).toEqual({});
  });
});

const itPosix = process.platform === 'win32' ? it.skip : it;

describe('file mode', () => {
  itPosix('file mode is 0600 on POSIX', () => {
    writeModelBudgets({ m: 1 });
    const mode = fs.statSync(budgetsFile()).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
```

- [x] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/standalone/__tests__/model-budget-store.test.ts`

Expected: FAIL — `Cannot find module '../model-budget-store'` (or equivalent resolve error).

- [x] **Step 4: Implement the store**

Create `src/standalone/model-budget-store.ts`:

```ts
// src/standalone/model-budget-store.ts — standalone replacement for the upstream
// globalState Memento that backs saveModelBudgets/loadModelBudgets (panel.ts:342).
// Modeled on state.ts: versioned wrapper, atomic 0o600 write, resilient read.
import * as fs from 'fs';
import * as path from 'path';
import { atomicWriteJson, stateDir } from './state';

const MODEL_BUDGETS_FILE = 'model-budgets.json';
const SCHEMA_VERSION = 1;

interface ModelBudgetsFile {
  version: number;
  budgets: Record<string, number>;
}

function modelBudgetsFile(): string {
  return path.join(stateDir(), MODEL_BUDGETS_FILE);
}

export function writeModelBudgets(budgets: Record<string, number>): void {
  atomicWriteJson(modelBudgetsFile(), { version: SCHEMA_VERSION, budgets });
}

/** Never throws — every failure path degrades to {}. */
export function readModelBudgets(): Record<string, number> {
  const file = modelBudgetsFile();
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<ModelBudgetsFile>;
    if (parsed?.version !== SCHEMA_VERSION) {
      console.warn(
        `[coach] unknown model-budgets.json schema version ${parsed?.version}; ignoring`,
      );
      return {};
    }
    const budgets = parsed.budgets;
    if (typeof budgets !== 'object' || budgets === null || Array.isArray(budgets)) return {};
    return budgets as Record<string, number>;
  } catch {
    // Corrupt JSON (or unreadable file): quarantine so the next save starts clean.
    try {
      const broken = `${file}.broken-${Date.now()}`;
      fs.renameSync(file, broken);
      console.warn(`[coach] corrupt model-budgets.json; moved to ${broken}`);
    } catch { /* quarantine is best-effort; still degrade to {} */ }
    return {};
  }
}
```

- [x] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/standalone/__tests__/model-budget-store.test.ts src/standalone/__tests__/state.test.ts`

Expected: ALL PASS (state.test.ts included to confirm the `export` keyword broke nothing).

- [x] **Step 6: Commit**

```bash
git add src/standalone/state.ts src/standalone/model-budget-store.ts src/standalone/__tests__/model-budget-store.test.ts
git commit -m "feat(standalone): add model-budget-store (versioned, atomic, resilient)"
```

---

### Task 2: Native handlers in `standalone-native.ts`

**Files:**
- Modify: `src/standalone/standalone-native.ts`
- Test: `src/standalone/__tests__/standalone-native.test.ts`

- [x] **Step 1: Extend the handler tests (failing)**

In `src/standalone/__tests__/standalone-native.test.ts`, replace the import/mock preamble (lines 1-10) with:

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import open from 'open';
import { STANDALONE_NATIVE } from '../standalone-native';
import { readModelBudgets } from '../model-budget-store';

vi.mock('open', () => ({ default: vi.fn() }));
const mockedOpen = vi.mocked(open);

const mockOs = vi.hoisted(() => ({
  homedir: vi.fn(),
}));

vi.mock('os', async () => {
  const actual = await vi.importActual('os');
  return {
    ...actual,
    homedir: mockOs.homedir,
  };
});

let tmpHome: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-native-'));
  mockOs.homedir.mockReturnValue(tmpHome);
});

afterEach(() => {
  vi.clearAllMocks();
  fs.rmSync(tmpHome, { recursive: true, force: true });
});
```

(The existing `openExternal` describe block stays unchanged — the homedir mock is inert for it.) Then append at the end of the file:

```ts
describe('STANDALONE_NATIVE.saveModelBudgets', () => {
  it('rejects a missing budgets object with bad-request', async () => {
    const res = await STANDALONE_NATIVE.saveModelBudgets({});
    expect(res).toEqual({
      ok: false,
      error: { code: 'bad-request', method: 'saveModelBudgets', message: 'missing budgets' },
    });
  });

  it('rejects a non-object budgets value with bad-request', async () => {
    for (const bad of ['x', 42, null, [1, 2]]) {
      const res = await STANDALONE_NATIVE.saveModelBudgets({ budgets: bad });
      expect(res.ok).toBe(false);
    }
  });

  it('drops non-positive and non-numeric entries before persisting', async () => {
    const res = await STANDALONE_NATIVE.saveModelBudgets({
      budgets: { keep: 100, zero: 0, neg: -5, nan: NaN, inf: Infinity, str: 'x', also: 1 },
    });
    expect(res).toEqual({ ok: true, data: { ok: true } });
    expect(readModelBudgets()).toEqual({ keep: 100, also: 1 });
  });

  it('caps the persisted record at 200 keys', async () => {
    const budgets: Record<string, number> = {};
    for (let i = 0; i < 201; i++) budgets[`model-${i}`] = i + 1;
    await STANDALONE_NATIVE.saveModelBudgets({ budgets });
    expect(Object.keys(readModelBudgets())).toHaveLength(200);
  });
});

describe('STANDALONE_NATIVE.loadModelBudgets', () => {
  it('returns {} when nothing was ever saved', async () => {
    const res = await STANDALONE_NATIVE.loadModelBudgets(undefined);
    expect(res).toEqual({ ok: true, data: {} });
  });

  it('save -> load roundtrips through the handlers', async () => {
    await STANDALONE_NATIVE.saveModelBudgets({ budgets: { 'claude-fable-5': 500000 } });
    const res = await STANDALONE_NATIVE.loadModelBudgets({});
    expect(res).toEqual({ ok: true, data: { 'claude-fable-5': 500000 } });
  });
});
```

- [x] **Step 2: Run the tests to verify the new ones fail**

Run: `npx vitest run src/standalone/__tests__/standalone-native.test.ts`

Expected: the 4 `openExternal` tests PASS; every new budget test FAILS (`STANDALONE_NATIVE.saveModelBudgets is not a function`).

- [x] **Step 3: Implement the handlers**

In `src/standalone/standalone-native.ts`, add after the imports:

```ts
import { readModelBudgets, writeModelBudgets } from './model-budget-store';

// Defensive bound on a single persisted record — far above any realistic model count.
const MAX_BUDGET_KEYS = 200;
```

and add two entries to the `STANDALONE_NATIVE` map after `openExternal` (KEEP the 2-space key indentation — the parity tripwire's parser depends on it):

```ts
  // page-burndown.ts:95 — persist per-model token budgets (upstream: globalState, panel.ts:342).
  saveModelBudgets: async (params): Promise<DispatchResult> => {
    const budgets = (params as { budgets?: unknown } | undefined)?.budgets;
    if (typeof budgets !== 'object' || budgets === null || Array.isArray(budgets)) {
      return { ok: false, error: { code: 'bad-request', method: 'saveModelBudgets', message: 'missing budgets' } };
    }
    // Mirror the webview's own `if (v > 0)` filter (page-burndown.ts:88-90):
    // zero/negative/NaN/Infinity/non-number values never reach disk.
    const sanitized: Record<string, number> = {};
    for (const [k, v] of Object.entries(budgets as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
        if (Object.keys(sanitized).length >= MAX_BUDGET_KEYS) break;
        sanitized[k] = v;
      }
    }
    writeModelBudgets(sanitized);
    return { ok: true, data: { ok: true } };
  },
  // page-burndown.ts:103 — load persisted budgets; resolves to the bare record. Params ignored.
  loadModelBudgets: async (): Promise<DispatchResult> => {
    return { ok: true, data: readModelBudgets() };
  },
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/standalone/__tests__/standalone-native.test.ts`

Expected: ALL PASS.

- [x] **Step 5: Commit**

```bash
git add src/standalone/standalone-native.ts src/standalone/__tests__/standalone-native.test.ts
git commit -m "feat(standalone): expose saveModelBudgets/loadModelBudgets as Tier-1 native handlers"
```

---

### Task 3: Dispatcher Tier-1 routing tests

No production code changes — `dispatcher.ts:37-48` already routes any `STANDALONE_NATIVE` key ahead of the allowlist. These tests pin that contract for the two new methods (so a future tier reshuffle can't silently re-break persistence). They pass immediately; that's expected.

**Files:**
- Test: `src/standalone/__tests__/dispatcher.test.ts`

- [ ] **Step 1: Add the routing tests**

In `src/standalone/__tests__/dispatcher.test.ts`, add next to the existing `vi.mock('open', ...)` (line 8) a store mock — the dispatcher tests verify routing, not persistence, so no real fs:

```ts
import { readModelBudgets, writeModelBudgets } from '../model-budget-store';
vi.mock('../model-budget-store', () => ({
  readModelBudgets: vi.fn(() => ({ 'claude-fable-5': 500000 })),
  writeModelBudgets: vi.fn(),
}));
const mockedReadBudgets = vi.mocked(readModelBudgets);
const mockedWriteBudgets = vi.mocked(writeModelBudgets);
```

In the `afterEach` (lines 35-40), add:

```ts
  mockedReadBudgets.mockClear();
  mockedWriteBudgets.mockReset();
```

(`mockClear`, not `mockReset`, for the read mock — `mockReset` would wipe the `() => ({...})` factory implementation.) Then extend the existing `describe('dispatch — native tier', ...)` block (after the `openExternal` test at line 116-123) with:

```ts
  it('routes saveModelBudgets via Tier 1 with empty ctx (no allowlist, no data-ready gate)', async () => {
    const res = await dispatch('saveModelBudgets', { budgets: { m: 100 } }, {});
    expect(res).toEqual({ ok: true, data: { ok: true } });
    expect(mockedWriteBudgets).toHaveBeenCalledWith({ m: 100 });
    expect(mockedGetRpcHandler).not.toHaveBeenCalled();
    expect(mockedDispatchService).not.toHaveBeenCalled();
  });

  it('routes loadModelBudgets via Tier 1 with empty ctx, resolving the bare record', async () => {
    const res = await dispatch('loadModelBudgets', {}, {});
    expect(res).toEqual({ ok: true, data: { 'claude-fable-5': 500000 } });
    expect(mockedGetRpcHandler).not.toHaveBeenCalled();
    expect(mockedDispatchService).not.toHaveBeenCalled();
  });

  it('wraps a store throw as handler-error (Tier-1 crash safety)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedWriteBudgets.mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    const res = await dispatch('saveModelBudgets', { budgets: { m: 100 } }, {});
    expect(res).toEqual({
      ok: false,
      error: { code: 'handler-error', method: 'saveModelBudgets', message: 'disk full' },
    });
    expect(errSpy).toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the dispatcher tests**

Run: `npx vitest run src/standalone/__tests__/dispatcher.test.ts`

Expected: ALL PASS (including the pre-existing 20 tests).

- [ ] **Step 3: Run the full unit suite**

Run: `npm run test`

Expected: ALL PASS, no regressions.

- [ ] **Step 4: Commit**

```bash
git add src/standalone/__tests__/dispatcher.test.ts
git commit -m "test(standalone): pin Tier-1 routing for model-budget methods"
```

---

### Task 4: Tripwire baseline + parity-doc updates

The spec (§6) makes these part of the deliverable, not follow-up. The tripwire reads the allowlists from `git show HEAD:` — Task 2 must be committed before this task (it is, after Task 2 Step 5).

**Files:**
- Modify: `.claude/skills/merging-upstream/scripts/parity-gap.mjs:26`
- Modify: `docs-fork/STANDALONE-PARITY-GAPS.md:48,52,130-144`

- [ ] **Step 1: Bump the tripwire baseline**

In `.claude/skills/merging-upstream/scripts/parity-gap.mjs:26`, change:

```js
const BASELINE = { v1: 52, service: 15, native: 1, exposed: 68 };
```

to:

```js
const BASELINE = { v1: 52, service: 15, native: 3, exposed: 70 };
```

- [ ] **Step 2: Run the tripwire and verify the new counts**

Run: `node .claude/skills/merging-upstream/scripts/parity-gap.mjs`

Expected output (counts section):

```
V1_ALLOWED         = 52   OK
V1_SERVICE_ALLOWED = 15   OK
STANDALONE_NATIVE  = 3    OK
exposed (union)    = 70   OK
universe (upstream)= 75
gap                = 5   (universe \ exposed)
```

and the gap list must NO LONGER contain `loadModelBudgets`/`saveModelBudgets` (5 methods: `calibrateRule`, `createSkill`, `getSdlcGitHubData`, `reviewLocalRules`, `runRuleTests`). The per-method degradations section must no longer show the two budget methods. If any count differs, STOP — the handlers were mis-parsed (check the 2-space key indentation in `standalone-native.ts`) — do not paper over it by editing the baseline again.

- [ ] **Step 3: Flip the Model-budget persistence row**

In `docs-fork/STANDALONE-PARITY-GAPS.md:52`, replace:

```markdown
| Model-budget persistence | ❌ | `saveModelBudgets`/`loadModelBudgets` NOT exposed (gap list; called at `page-burndown.ts:95,103`); chart works, budgets don't persist across reloads |
```

with:

```markdown
| Model-budget persistence | ✅ | `saveModelBudgets`/`loadModelBudgets` are Tier-1 native handlers (`standalone-native.ts`), backed by `model-budget-store.ts` → `~/.ai-engineer-coach/model-budgets.json` (versioned, atomic, 0o600); call sites `page-burndown.ts:95,103` unchanged |
```

- [ ] **Step 4: Flip the Burndown chart row**

In `docs-fork/STANDALONE-PARITY-GAPS.md:48`, replace:

```markdown
| Burndown chart | ⚠️ | renders via the `FF_TOKEN_REPORTING_ENABLED` build override (`standalone-constants.ts:11` flips it `true`; esbuild `onResolve` redirects `core/constants` only in the standalone bundle; the published extension stays FF=false). `app.ts:27` only bounces `burndown`→`dashboard` when FF is false, so the route works in standalone. Model-budget save/load degraded — see Model-budget persistence row |
```

with:

```markdown
| Burndown chart | ✅ | renders via the `FF_TOKEN_REPORTING_ENABLED` build override (`standalone-constants.ts:11` flips it `true`; esbuild `onResolve` redirects `core/constants` only in the standalone bundle; the published extension stays FF=false). `app.ts:27` only bounces `burndown`→`dashboard` when FF is false, so the route works in standalone. Model budgets persist — see Model-budget persistence row |
```

- [ ] **Step 5: Update the appendix tripwire block and gap-method sentence**

In `docs-fork/STANDALONE-PARITY-GAPS.md`, the fenced block at lines 130-138: paste the fresh script output (header line + counts) from Step 2. The counts lines become:

```
V1_ALLOWED         = 52   OK
V1_SERVICE_ALLOWED = 15   OK
STANDALONE_NATIVE  = 3    OK
exposed (union)    = 70   OK
universe (upstream)= 75
gap                = 5   (universe \ exposed)
```

Then replace the gap-methods paragraph (lines 140-144):

```markdown
Gap methods (7, `universe \ exposed`) and the feature row each maps to:
`calibrateRule` · `runRuleTests` — off-allowlist, deferred (no shipped page reaches them);
`createSkill` → Create skill ⚠️; `getSdlcGitHubData` → SDLC GitHub data ❌;
`loadModelBudgets` · `saveModelBudgets` → Model-budget persistence ❌;
`reviewLocalRules` → Local-rule trust approval ❌.
```

with:

```markdown
Gap methods (5, `universe \ exposed`) and the feature row each maps to:
`calibrateRule` · `runRuleTests` — off-allowlist, deferred (no shipped page reaches them);
`createSkill` → Create skill ⚠️; `getSdlcGitHubData` → SDLC GitHub data ❌;
`reviewLocalRules` → Local-rule trust approval ❌.
```

- [ ] **Step 6: Verify no other fixed-count comments need touching**

The spec's §6 "count comments" item — both already verified, record for the record:
- `standalone-native.ts` header comment carries no method count (it's just the file path) — adding one is not required; if you added one in Task 2, make sure it says 3.
- `v1-allowed.ts:6` cites `= 52`, which is V1_ALLOWED only and unchanged — no edit.

Run: `git grep -n "STANDALONE_NATIVE.*= 1\|native count" -- docs-fork src/standalone` — expected: no hits (nothing stale remains).

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/merging-upstream/scripts/parity-gap.mjs docs-fork/STANDALONE-PARITY-GAPS.md
git commit -m "docs(fork): flip model-budget persistence + burndown rows to green; bump tripwire baseline to native=3"
```

---

### Task 5: Final verification (no commit)

- [ ] **Step 1: Full unit suite**

Run: `npm run test`
Expected: ALL PASS.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: clean exit, no new esbuild warnings (the store/handlers use only `fs`/`path`, both already bundled for `state.ts`).

- [ ] **Step 3: Drift gate**

Run: `bash .claude/skills/merging-upstream/scripts/drift-gate.sh`
Expected: `VERDICT: INVARIANT OK — additive-only holds, override preconditions intact.` and exit 0. Anything else: STOP and find which file leaked outside `src/standalone/` (only `state.ts`, `standalone-native.ts`, `model-budget-store.ts`, tests, the tripwire script, and the parity doc should have changed — `git diff main --stat` to check).

- [ ] **Step 4: Tripwire once more (post-commit)**

Run: `node .claude/skills/merging-upstream/scripts/parity-gap.mjs`
Expected: all four counts `OK`, `gap = 5`, and NO budget methods under "per-method degradations".

- [ ] **Step 5 (optional, manual): end-to-end smoke**

Start the standalone server, open the Burndown page, set a model budget, hard-reload the page → the budget survives. Then `Get-Content ~\.ai-engineer-coach\model-budgets.json` shows `{ "version": 1, "budgets": { ... } }`. (Webview-shim note from the spec §4: neither method appears in `BANNER_WORTHY`/`RESOLVE_EMPTY_WHEN_DISABLED` — verified 2026-06-12 — so no shim change is needed for this to work.)

Done. The branch ends with 5 commits on top of main (spec + 4 implementation commits), unmerged and unpushed, per the standing instruction.
