# State Persistence (06-state) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `src/standalone/state.ts`, a tiny module that owns atomic, versioned, `0600`-mode persistence of `~/.ai-engineer-coach/server-state.json` so callers never touch `fs` directly.

**Architecture:** A single leaf module with four named exports (`stateDir`, `readServerState`, `writeServerState`, `clearServerState`) plus a `ServerState` interface. Writes go through a private `atomicWriteJson` helper (write `.tmp`, then `renameSync`). Readers never throw: absent → `null`, corrupt JSON → quarantine to `.broken-<ms>` and return `null`, unknown schema version → warn and return `null` without touching the file. Home dir is resolved via `os.homedir()` (matching `src/core/rule-loader.ts:46`), which makes it mockable in tests.

**Tech Stack:** TypeScript (strict, ES2022 modules, `moduleResolution: bundler`), Node built-ins only (`fs`, `os`, `path`), vitest (`vitest run`). No new dependencies. No `vscode` import anywhere in this module, so the standalone `vscode-stub` alias from `00-overview.md` is irrelevant here.

---

## Spec references

- Spec under implementation: `docs-fork/specs/06-state.md`
- Shared contract: `docs-fork/specs/00-overview.md` — relevant pieces:
  - Cache/state co-existence table: `server-state.json` is the **only**
    standalone-owned file in v1 (no `state.json` / `UserState` — deferred to v2
    with the flag-gated burndown page).
  - Style conventions: vitest, kebab-case filenames under `src/standalone/`,
    named exports only, TypeScript strict, comments only where the *why* is
    non-obvious.
  - Additive-only fork discipline: every `+` line must live under
    `src/standalone/` (verified in the final task).

This module has **no fork dependencies** — it is the first plan in the queue, so
no earlier-planned interfaces need to be honored. Its `ServerState` interface is
the contract that `01-server` and `05-cli` will later consume; keep the field
names exactly as written here.

## File Structure

| Path | Responsibility | Created by |
|------|----------------|------------|
| `src/standalone/state.ts` | Reader/writer module: `ServerState` type, `stateDir`, `readServerState`, `writeServerState`, `clearServerState`, private `atomicWriteJson`. | Task 1 (grown through Task 6) |
| `src/standalone/__tests__/state.test.ts` | Vitest unit tests for all behaviors and acceptance criteria. | Task 1 (grown through Task 6) |

No other files are created or modified. `src/standalone/` does not yet exist;
Task 1 creates it implicitly via the new file paths. The test path
(`src/standalone/__tests__/state.test.ts`) is taken verbatim from the spec; it is
matched by the existing vitest `include: ['src/**/*.test.ts']` in
`vitest.config.mts`, so no config change is needed.

## Conventions to copy (already in the repo)

- Test fixtures: create a throwaway dir with
  `fs.mkdtempSync(path.join(os.tmpdir(), 'prefix-'))` and remove it in
  `afterEach` with `fs.rmSync(dir, { recursive: true, force: true })` — exactly
  the pattern in `src/core/cache.test.ts:26-39`.
- Home-dir resolution: `os.homedir()` (see `src/core/rule-loader.ts:46`). Tests
  override it with `vi.spyOn(os, 'homedir').mockReturnValue(tmpHome)`; the source
  must call `os.homedir()` **at call time** (inside `stateDir()`), never cache it
  at module load, or the spy won't take effect.
- vitest imports come from `'vitest'`:
  `import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';`

---

## Task 1: Module skeleton — `ServerState` + `stateDir()`

Establishes the file, the public type, and directory creation
(spec behavior #1; acceptance #—; test `state dir created on first call`).

**Files:**
- Create: `src/standalone/state.ts`
- Test: `src/standalone/__tests__/state.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/standalone/__tests__/state.test.ts`:

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stateDir, type ServerState } from '../state';

let tmpHome: string;

function sampleState(): ServerState {
  return {
    version: 1,
    port: 7331,
    token: 'a'.repeat(64),
    pid: 4242,
    startedAt: '2026-05-25T12:00:00.000Z',
  };
}

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-state-'));
  vi.spyOn(os, 'homedir').mockReturnValue(tmpHome);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe('stateDir', () => {
  it('creates the state dir on first call', () => {
    const dir = stateDir();
    expect(dir).toBe(path.join(tmpHome, '.ai-engineer-coach'));
    expect(fs.existsSync(dir)).toBe(true);
  });
});
```

`sampleState()` is defined now even though Task 1 doesn't use it — later tasks
in the same file reuse it, and keeping one definition avoids duplication.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/standalone/__tests__/state.test.ts`
Expected: FAIL — module resolution error, `Failed to resolve import "../state"`
(the source file does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/standalone/state.ts`:

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface ServerState {
  version: 1;
  port: number;
  token: string; // 64-char hex
  pid: number;
  startedAt: string; // ISO-8601 UTC
}

const STATE_DIR_NAME = '.ai-engineer-coach';
const SERVER_STATE_FILE = 'server-state.json';

export function stateDir(): string {
  const dir = path.join(os.homedir(), STATE_DIR_NAME);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function serverStateFile(): string {
  return path.join(stateDir(), SERVER_STATE_FILE);
}
```

`serverStateFile()` is unused until Task 2. TypeScript strict does not error on
an unused private function (only unused locals/parameters), so this compiles. If
your editor's linter flags it, leave it — Task 2 consumes it immediately.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/standalone/__tests__/state.test.ts`
Expected: PASS — 1 test passed.

- [ ] **Step 5: Commit**

```bash
git add src/standalone/state.ts src/standalone/__tests__/state.test.ts
git commit -m "feat(standalone): add state module skeleton with stateDir"
```

---

## Task 2: Round-trip read/write + atomic write

Implements `writeServerState`/`readServerState` over a private
`atomicWriteJson` helper, **without** the `0600` mode flag yet (that is driven in
by Task 6's test). Covers spec behaviors #1 (absent → null) and #2 (atomic write),
acceptance #1, and tests `read server state returns null when absent`,
`write then read server state round-trips`, `atomic write does not leave .tmp on success`.

**Files:**
- Modify: `src/standalone/state.ts`
- Test: `src/standalone/__tests__/state.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/standalone/__tests__/state.test.ts` (after the `stateDir` block):

```ts
describe('read/write round-trip', () => {
  it('read server state returns null when absent', () => {
    expect(readServerState()).toBeNull();
  });

  it('write then read server state round-trips', () => {
    const state = sampleState();
    writeServerState(state);
    expect(readServerState()).toEqual(state);
  });

  it('atomic write does not leave .tmp on success', () => {
    writeServerState(sampleState());
    const tmp = path.join(stateDir(), 'server-state.json.tmp');
    expect(fs.existsSync(tmp)).toBe(false);
  });
});
```

Update the import at the top of the file to add the two new symbols:

```ts
import { readServerState, stateDir, writeServerState, type ServerState } from '../state';
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/standalone/__tests__/state.test.ts`
Expected: FAIL — `readServerState is not a function` / `writeServerState is not
a function` (not yet exported).

- [ ] **Step 3: Write minimal implementation**

Add to `src/standalone/state.ts`, below `serverStateFile()`:

```ts
function atomicWriteJson(filePath: string, value: unknown): void {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, filePath);
}

export function writeServerState(state: ServerState): void {
  atomicWriteJson(serverStateFile(), state);
}

export function readServerState(): ServerState | null {
  const file = serverStateFile();
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw) as ServerState;
}
```

This is intentionally minimal: no corruption handling, no version check, no mode
flag. Those are driven in by Tasks 3, 4, and 6 respectively.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/standalone/__tests__/state.test.ts`
Expected: PASS — 4 tests passed (1 from Task 1 + 3 new).

- [ ] **Step 5: Commit**

```bash
git add src/standalone/state.ts src/standalone/__tests__/state.test.ts
git commit -m "feat(standalone): add atomic server-state read/write round-trip"
```

---

## Task 3: Corruption recovery

Quarantines unparseable files to `<file>.broken-<unix-ms>` and returns `null`
instead of throwing (spec behavior #5; acceptance #3; test
`read recovers from corrupt JSON`).

**Files:**
- Modify: `src/standalone/state.ts`
- Test: `src/standalone/__tests__/state.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/standalone/__tests__/state.test.ts`:

```ts
describe('corruption recovery', () => {
  it('read recovers from corrupt JSON', () => {
    const file = path.join(stateDir(), 'server-state.json');
    fs.writeFileSync(file, 'not valid json {{{');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(readServerState()).toBeNull();

    const broken = fs
      .readdirSync(stateDir())
      .filter((f) => f.startsWith('server-state.json.broken-'));
    expect(broken).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/standalone/__tests__/state.test.ts`
Expected: FAIL — `readServerState` throws `SyntaxError: ... is not valid JSON`
(the current implementation calls `JSON.parse` without a guard), so the
`expect(...).toBeNull()` line never runs and the test errors.

- [ ] **Step 3: Write minimal implementation**

Replace the body of `readServerState` in `src/standalone/state.ts` with:

```ts
export function readServerState(): ServerState | null {
  const file = serverStateFile();
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, 'utf8');
  try {
    return JSON.parse(raw) as ServerState;
  } catch {
    const broken = `${file}.broken-${Date.now()}`;
    fs.renameSync(file, broken);
    console.warn(`[coach] corrupt server-state.json; moved to ${broken}`);
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/standalone/__tests__/state.test.ts`
Expected: PASS — 5 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/standalone/state.ts src/standalone/__tests__/state.test.ts
git commit -m "feat(standalone): quarantine corrupt server-state.json on read"
```

---

## Task 4: Schema-version validation

Returns `null` (with a stderr warning) on an unknown top-level `version`, leaving
the file untouched so a downgrading user does not lose data (spec behavior #4;
acceptance #5; test `read handles unknown schema version`).

**Files:**
- Modify: `src/standalone/state.ts`
- Test: `src/standalone/__tests__/state.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/standalone/__tests__/state.test.ts`:

```ts
describe('schema version', () => {
  it('read handles unknown schema version', () => {
    const file = path.join(stateDir(), 'server-state.json');
    fs.writeFileSync(
      file,
      JSON.stringify({ version: 99, port: 1, token: 'x', pid: 1, startedAt: 'x' }),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(readServerState()).toBeNull();
    expect(warn).toHaveBeenCalled();
    expect(fs.existsSync(file)).toBe(true); // not overwritten, not quarantined
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/standalone/__tests__/state.test.ts`
Expected: FAIL — `readServerState()` returns the `{ version: 99, ... }` object
(parses fine), so `expect(...).toBeNull()` fails with
`expected { version: 99, ... } to be null`.

- [ ] **Step 3: Write minimal implementation**

In `src/standalone/state.ts`, change the `try` block in `readServerState` to
validate the version after parsing:

```ts
  try {
    const parsed = JSON.parse(raw) as Partial<ServerState>;
    if (parsed?.version !== 1) {
      console.warn(
        `[coach] unknown server-state.json schema version ${parsed?.version}; ignoring`,
      );
      return null;
    }
    return parsed as ServerState;
  } catch {
    const broken = `${file}.broken-${Date.now()}`;
    fs.renameSync(file, broken);
    console.warn(`[coach] corrupt server-state.json; moved to ${broken}`);
    return null;
  }
```

Only the `try` branch changed; the `catch` branch is identical to Task 3. The
version mismatch path deliberately does **not** rename or delete the file
(acceptance #5: "file is not overwritten").

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/standalone/__tests__/state.test.ts`
Expected: PASS — 6 tests passed. (The Task 2 round-trip still passes: its
`sampleState()` has `version: 1`.)

- [ ] **Step 5: Commit**

```bash
git add src/standalone/state.ts src/standalone/__tests__/state.test.ts
git commit -m "feat(standalone): reject unknown server-state schema version"
```

---

## Task 5: `clearServerState` (idempotent unlink)

Adds graceful-shutdown cleanup that tolerates a missing file (spec behavior #6;
acceptance #2; test `clear server state is idempotent`).

**Files:**
- Modify: `src/standalone/state.ts`
- Test: `src/standalone/__tests__/state.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/standalone/__tests__/state.test.ts`:

```ts
describe('clearServerState', () => {
  it('clear server state is idempotent', () => {
    writeServerState(sampleState());
    expect(() => {
      clearServerState();
      clearServerState();
    }).not.toThrow();
    expect(readServerState()).toBeNull();
  });
});
```

Add `clearServerState` to the import at the top of the file:

```ts
import {
  clearServerState,
  readServerState,
  stateDir,
  writeServerState,
  type ServerState,
} from '../state';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/standalone/__tests__/state.test.ts`
Expected: FAIL — `clearServerState is not a function` (not yet exported).

- [ ] **Step 3: Write minimal implementation**

Add to `src/standalone/state.ts`:

```ts
export function clearServerState(): void {
  try {
    fs.unlinkSync(serverStateFile());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/standalone/__tests__/state.test.ts`
Expected: PASS — 7 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/standalone/state.ts src/standalone/__tests__/state.test.ts
git commit -m "feat(standalone): add idempotent clearServerState"
```

---

## Task 6: Enforce `0600` file mode

Drives in the secret-protecting file mode (spec behavior #3; acceptance #4; test
`file mode is 0600 on POSIX`). The test is skipped on Windows, where POSIX mode
bits are not meaningful.

**Files:**
- Modify: `src/standalone/state.ts`
- Test: `src/standalone/__tests__/state.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/standalone/__tests__/state.test.ts`. Use a platform-gated `it` so
the assertion never runs on Windows:

```ts
const itPosix = process.platform === 'win32' ? it.skip : it;

describe('file mode', () => {
  itPosix('file mode is 0600 on POSIX', () => {
    writeServerState(sampleState());
    const file = path.join(stateDir(), 'server-state.json');
    const mode = fs.statSync(file).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
```

- [ ] **Step 2: Run test to verify it fails (POSIX) / skips (Windows)**

Run: `npx vitest run src/standalone/__tests__/state.test.ts`
Expected on macOS/Linux: FAIL — `expected 420 to be 384` (i.e. `0o644` vs
`0o600`), because `atomicWriteJson` writes with the default umask mode.
Expected on Windows: the test reports as **skipped**, the other 7 pass, and you
cannot drive this change locally — implement Step 3 from the spec and rely on the
CI matrix (`08-testing`) to verify on POSIX.

- [ ] **Step 3: Write minimal implementation**

In `src/standalone/state.ts`, add the `mode` option to the write in
`atomicWriteJson`:

```ts
function atomicWriteJson(filePath: string, value: unknown): void {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, filePath);
}
```

`renameSync` preserves the tmp file's mode, so the destination
`server-state.json` lands at `0600`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/standalone/__tests__/state.test.ts`
Expected on macOS/Linux: PASS — 8 tests passed.
Expected on Windows: 7 passed, 1 skipped.

- [ ] **Step 5: Commit**

```bash
git add src/standalone/state.ts src/standalone/__tests__/state.test.ts
git commit -m "feat(standalone): write server-state.json with 0600 mode"
```

---

## Task 7: Full-suite run + additive-only verification

Confirms the module passes the project test runner (not just the single file) and
that the diff respects the fork's additive-only discipline
(`00-overview.md` → "Additive-only fork discipline" and acceptance #11).

**Files:** none (verification only).

- [ ] **Step 1: Run the full vitest suite**

Run: `npm test`
Expected: PASS — the whole suite is green, including the 8 new
`src/standalone/__tests__/state.test.ts` cases. (On Windows: 1 of the 8 skipped.)
If any pre-existing test now fails, stop and investigate — this module is
additive and must not affect other suites.

- [ ] **Step 2: TypeScript strict check**

Run: `npx tsc --noEmit`
Expected: no errors. Confirms the new file type-checks under the repo's strict
config.

- [ ] **Step 3: Verify additive-only fork discipline**

Run: `git diff upstream/main -- src/ | grep -E '^[-+]' | grep -vE '^[-+]{3}'`
Expected: every line is an addition (`+`), and every added line is inside
`src/standalone/`. No deletions (`-`) and no edits to files outside
`src/standalone/`.
(If the `upstream/main` ref is not configured in this clone, add it first:
`git remote add upstream <upstream-url> && git fetch upstream`. The two
shared-file exceptions in `00-overview.md` — `package.json`, `esbuild.mjs`,
vitest config — are **not** touched by this spec; that work belongs to
`07-build`.)

- [ ] **Step 4: Confirm no `vscode` import crept in**

Run: `grep -rn "vscode" src/standalone/state.ts src/standalone/__tests__/state.test.ts`
Expected: no matches. This leaf module is pure Node built-ins; the standalone
`vscode-stub` alias does not apply here.

- [ ] **Step 5: Final commit (if anything was adjusted)**

If Steps 1–4 surfaced no changes, there is nothing to commit and this task is
done. If a fix was needed:

```bash
git add src/standalone/
git commit -m "test(standalone): verify state module passes full suite"
```

---

## Acceptance criteria mapping (self-review)

Every acceptance criterion in `docs-fork/specs/06-state.md` maps to a task:

| Spec acceptance criterion | Task | Test |
|---------------------------|------|------|
| 1. Write then read round-trips | Task 2 | `write then read server state round-trips` |
| 2. Write then clear → read returns null | Task 5 | `clear server state is idempotent` (asserts read → null after clear) |
| 3. Corrupt JSON → null + `.broken-*` left behind | Task 3 | `read recovers from corrupt JSON` |
| 4. File created with mode `0600` (POSIX; skipped win32) | Task 6 | `file mode is 0600 on POSIX` (`itPosix`) |
| 5. Unknown schema version → warn + null + file untouched | Task 4 | `read handles unknown schema version` |

Spec **behaviors** (1–7) coverage: dir creation (Task 1), atomic write (Tasks 2 & 6),
file mode (Task 6), schema versioning (Task 4), corruption recovery (Task 3),
`clearServerState` (Task 5), no-locking concurrency (design-level — no code; the
single-writer guarantee in the spec means there is nothing to test here).

Spec **test plan** coverage — all eight named tests are present:
`read server state returns null when absent` (Task 2),
`write then read server state round-trips` (Task 2),
`read recovers from corrupt JSON` (Task 3),
`read handles unknown schema version` (Task 4),
`atomic write does not leave .tmp on success` (Task 2),
`clear server state is idempotent` (Task 5),
`state dir created on first call` (Task 1),
`file mode is 0600 on POSIX` (Task 6).

**Type consistency check:** `ServerState` is defined once (Task 1) with fields
`version: 1, port, token, pid, startedAt` and consumed unchanged by
`writeServerState`/`readServerState`. `stateDir`, `readServerState`,
`writeServerState`, `clearServerState`, and `serverStateFile` are spelled
identically across all tasks. These names are the public contract that
`01-server` and `05-cli` plans will reference.

**Placeholder scan:** no TBD/TODO/"handle edge cases"/"similar to" — every code
step shows complete code; every run step shows the exact command and expected
output.
