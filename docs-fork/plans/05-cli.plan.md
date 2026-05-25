# CLI (05-cli) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `coach` user-facing entry point — `src/standalone/cli.ts` (`runCli(argv)`), `src/standalone/flags.ts` (a pure argv parser), `src/standalone/parse-bootstrap.ts` (the vscode-free worker-pool + Analyzer setup duplicated from `panel.ts`), and the `bin/coach` launcher — so that `coach` (and `npx @JuliusGruber/ai-engineer-coach`) parses flags, reuses a live instance when one exists, otherwise serves-then-parses ([01-server](../specs/01-server.md) binds first, the browser opens onto the loading shell, then `bootstrapParse` runs and `setData(...)` broadcasts `dataReady`), and shuts down cleanly on SIGINT/SIGTERM.

**Architecture:** Three leaf source files plus a launcher. `flags.ts` is a side-effect-free parser (`parseFlags(argv): ParsedFlags`, throwing `FlagError` on bad input) so it unit-tests without spawning anything. `parse-bootstrap.ts` exports `bootstrapParse(onProgress)` — it reuses the core `findLogsDirs()` + `parseAllLogsViaWorker(dirs, onProgress)` (both vscode-free) and builds an `Analyzer` exactly as `panel.ts:205-224` does, resolving an empty `ParseResult` when no log dirs exist so the dashboard renders an empty state rather than hanging. `cli.ts` orchestrates: parse → help/version early-exit → optional log-file tee → `probeExistingInstance` (reuse and return) → `createServer` (serve) → print URL + `open` browser → `bootstrapParse` → `handle.setData(...)` → block on a shutdown promise resolved by SIGINT (130) / SIGTERM (143). The heavy boundaries (`./server`, `./parse-bootstrap`, `open`) are mocked in `cli.ts`'s unit tests so `runCli` is exercised deterministically in-process; the true multi-process boot is left to [08-testing](../specs/08-testing.md)'s smoke layer (which runs after [07-build](../specs/07-build.md) produces `dist/standalone/cli.js`).

**Tech Stack:** TypeScript (strict, ES2022 modules, `moduleResolution: bundler`, `esModuleInterop`), vitest (`vitest run`, `environment: 'node'`, 15 s timeout), Node built-ins (`crypto`, `fs`, `path`, `node:url`, `process`), and the `open` (^10) dep introduced earlier by [02-dispatcher](../specs/02-dispatcher.md). Reuses `createServer`/`probeExistingInstance`/`ServerHandle` (01), and the core `findLogsDirs`/`parseAllLogsViaWorker`/`LoadProgress` (`src/core/parser`) + `Analyzer` (`src/core/analyzer`) + `ParseResult` (`src/core/cache`).

---

## Spec references

- Spec under implementation: `docs-fork/specs/05-cli.md`
- Shared contract: `docs-fork/specs/00-overview.md` — relevant pieces:
  - **Parse lifecycle (serve-then-parse)** — `createServer` is awaited **before** `bootstrapParse`; the webview gates all rendering on `dataReady` (`app.ts:444`), so `setData(...)` (which broadcasts `dataReady`) is mandatory and called exactly once. `progress` forwarding is the only deferrable piece.
  - **Security model** — `127.0.0.1` bind only (no `--host` in v1; it is a deferred-to-v2 flag → unknown-flag error). The URL carries the token; the CLI prints it to **stderr** and treats it as a secret.
  - **Style conventions** — vitest, kebab-case filenames under `src/standalone/`, named exports only, TS strict, comments only where the *why* is non-obvious. No new runtime deps beyond `express`/`ws`/`open`.
  - **Additive-only fork discipline** — every `+` line lives under `src/standalone/`. `bin/coach` is a sanctioned new file (00-overview: "`bin/coach` … are new files (allowed)"). This plan does **not** edit `package.json`'s `bin`/`files`/`scripts` (that is [07-build](../specs/07-build.md)'s additive wiring) and touches `package.json` only via an **idempotent** `open`-dep check that no-ops because 02-dispatcher already added it.

### Dependency note — this is the 6th plan in the queue

`05-cli` depends on **two** already-planned specs. Honor these settled interfaces verbatim:

- **01-server** (`01-server.plan.md`): `import { createServer, probeExistingInstance, type ServerHandle, type ServerOptions } from './server'`.
  - `createServer(opts: ServerOptions): Promise<ServerHandle>` where `ServerOptions = { port?: number; token?: string; logFile?: string; analyzer?: Analyzer; parseResult?: ParseResult }`.
  - `ServerHandle = { url: string; port: number; token: string; setData(analyzer: Analyzer, parseResult: ParseResult): void; broadcast(frame: Record<string, unknown>): void; close(): Promise<void> }`. `handle.url` already carries `?t=<token>`.
  - `probeExistingInstance(port: number): Promise<string | null>` — returns the live instance's URL (with `?t=`) or `null`. The server's `close()` calls `clearServerState()`, so single-instance `server-state.json` removal on shutdown is the server's job, reached through `handle.close()`.
- **06-state** (`06-state.plan.md`): consumed only **transitively** through the server (`server-state.json` is written/cleared inside `createServer`/`close()`). The CLI never imports `./state` directly. Token regeneration for `--rotate-token` is `crypto.randomBytes(32).toString('hex')` (the same 64-hex format `state.ts` validates).

Upstream reuse (verified in-repo):
- `src/core/parser.ts`: `export function findLogsDirs(): string[]` (line 101); `export async function parseAllLogsViaWorker(logsDirs: string[], onProgress?: ProgressCallback): Promise<ParseResult>` (line 626); `export interface LoadProgress { phase: number; detail?: string; pct: number; … }` (line 23); `export type ProgressCallback = (p: LoadProgress) => void` (line 44). Both `findLogsDirs` and `parseAllLogsViaWorker` are vscode-free.
- `src/core/analyzer.ts`: `export class Analyzer` with `constructor(sessions: Session[], editLocIndex?: Map<string, Map<string, number>>, workspaces?: Map<string, Workspace>)` (line 49).
- `src/core/cache.ts`: `export interface ParseResult { workspaces: Map<string, Workspace>; sessions: Session[]; editLocIndex: Map<string, Map<string, number>>; sessionSourceIndex: Map<string, SessionSource> }` (line 21), re-exported by `parser.ts:20` (`export type { ParseResult }`). The 01-server plan imports the type from `../core/cache`; this plan does the same for consistency.
- The duplicated parse pattern lives at `src/webview/panel.ts:205-224` (`loadData`): `findLogsDirs()` → `parseAllLogsViaWorker(dirs, progress => …)` → `new Analyzer(parseResult.sessions, parseResult.editLocIndex, parseResult.workspaces)`.

### Deliberate deviations from the spec text (all noted inline, none change observable contracts)

1. **`cli.test.ts` runs `runCli` in-process, not against a forked built `cli.js`.** The spec's test plan says "spawned child processes via `child_process.fork` against the built `cli.js`". But the esbuild entry for `cli.ts` and the `dist/standalone/cli.js` artifact are [07-build](../specs/07-build.md)'s deliverables — later in topological order — so no built CLI exists at this point. This plan tests `runCli(argv)` directly with `vi.mock` for `./server`, `./parse-bootstrap`, and `open`, which deterministically covers every behavior (flags, reuse, serve-then-parse ordering, `--no-open`, `--rotate-token`, SIGINT→130, fatal-error propagation). The real multi-process boot/reuse/SIGINT scenario is covered by [08-testing](../specs/08-testing.md)'s smoke layer once the build exists. This mirrors 01-server's deviations #4/#5 (probe live-case in-process; mock `dispatch`).
2. **A third test file, `parse-bootstrap.test.ts`, is added.** The spec's test plan names only `flags.test.ts` and `cli.test.ts`, but `bootstrapParse` has a load-bearing empty-vs-populated contract (acceptance: "empty `ParseResult` so the dashboard still renders … rather than hanging") that must be TDD'd in isolation.
3. **`bootstrapParse`'s progress parameter is typed `(p: LoadProgress) => void`.** The spec's signature uses a looser structural shape `{ phase: number; pct: number; detail?: string; [k: string]: unknown }`. `LoadProgress` is the concrete type the core callback actually emits and is assignment-compatible with both the spec shape and `handle.broadcast(frame: Record<string, unknown>)` (the CLI spreads `...p`).
4. **`attachLogFile` and `readPkgVersion` are added as named exports** beyond the spec's Public API list (which names only `parseFlags`/`FlagError`/`runCli`). They are test-support/reuse helpers consistent with the spec; this mirrors 01-server adding `resolveWebviewRoot`/`resolveShimPath`.
5. **`attachLogFile` tees stderr via synchronous `fs.appendFileSync` per write**, not a long-lived `createWriteStream`. The spec says "open append stream and tee"; the synchronous form is flush-safe and deterministic to unit-test (no async-buffer race), and diagnostic-log volume is low. It still satisfies the contract: subsequent stderr also lands in the file, and an unwritable path warns-and-continues without throwing.
6. **SIGTERM resolves exit `143`** (128+15, conventional). The spec's exit-code table fixes only SIGINT→`130`; SIGTERM has no listed code. Not an acceptance criterion.
7. **`bin/coach` is created but not executed or unit-tested here** (no `dist/standalone/cli.js` until 07-build). It is exercised by 08-testing's smoke layer. The `package.json` `bin`/`files`/`scripts` wiring is 07-build's additive edit; this plan leaves `package.json` untouched except the idempotent `open` check.

## File Structure

| Path | Responsibility | Created/edited by |
|------|----------------|-------------------|
| `package.json` | Idempotent `open` dep check (already added by 02-dispatcher → expected no-op). | Task 1 |
| `src/standalone/flags.ts` | `ParsedFlags`, `FlagError`, `parseFlags(argv)` — pure parser. | Task 2 |
| `src/standalone/__tests__/flags.test.ts` | Flag-parser unit tests. | Task 2 |
| `src/standalone/parse-bootstrap.ts` | `bootstrapParse(onProgress)` — vscode-free parse + `Analyzer`. | Task 3 |
| `src/standalone/__tests__/parse-bootstrap.test.ts` | Empty-vs-populated + progress-forwarding tests. | Task 3 |
| `src/standalone/cli.ts` | `HELP_TEXT`, `readPkgVersion`, `runCli(argv)` (early exits → Task 4; boot → Task 5; `attachLogFile` → Task 6). | Task 4 (grown in 5, 6) |
| `src/standalone/__tests__/cli.test.ts` | In-process `runCli` integration tests. | Task 4 (grown in 5, 6) |
| `bin/coach` | Node shebang launcher → `dist/standalone/cli.js`. | Task 7 |

`src/standalone/` already exists from earlier plans. All test paths match the existing vitest `include: ['src/**/*.test.ts']`, so **no `include` change is needed**. `bin/` does not exist yet; Task 7 creates it implicitly via the new file path.

## Conventions to copy (already in the repo)

- vitest imports come from `'vitest'`: `import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';`
- Single test file run: `npx vitest run <path>`; full suite: `npm test` (= `vitest run`, `package.json:scripts.test`).
- Strict TS, named exports only, kebab-case filenames under `src/standalone/`, comments only where the *why* is non-obvious.
- `import.meta.url` + `fileURLToPath` to resolve the project root, exactly as `server.ts` does (works under vitest source layout and the esbuild CJS bundle alike — esbuild rewrites `import.meta.url` for cjs output).
- Mocking `open`: `vi.mock('open', () => ({ default: vi.fn() }))` then `import open from 'open'; const mockedOpen = vi.mocked(open);` — the pattern 02-dispatcher's `standalone-native.test.ts` uses (`open@^10` is ESM-only; mocking avoids loading it).
- Temp dirs: `fs.mkdtempSync(path.join(os.tmpdir(), 'prefix-'))` + `fs.rmSync(dir, { recursive: true, force: true })` in teardown (as in `src/core/cache.test.ts`).

### Preconditions

If `node_modules/` is empty, run `npm install` once. By topological order the following are already present and must **not** be re-created: the `open` dep, `src/standalone/vscode-stub.ts`, and the vitest `resolve.alias` for `vscode` (all from 02-dispatcher), plus `express`/`ws` (01-server). None of the `vscode`-adjacent paths are exercised here — `cli.test.ts` mocks `./server` (which would transitively pull `panel-rpc`→`vscode`) and `parse-bootstrap.test.ts` mocks `../core/parser`/`../core/analyzer`, so the alias is not even reached. The baseline suite must be green (`npm test`) before changes; a pre-existing red suite is an escalation, not introduced here.

---

## Task 1: Prerequisites — confirm the `open` dependency (idempotent)

`open` is the CLI's only new runtime dep, but 02-dispatcher already added it for the `openExternal` native handler (00-overview: the `open` dep is "bootstrapped at first use by 02-dispatcher"; treat its creation as idempotent — check-and-skip). This task verifies it is present and the suite is green before writing code.

**Files:**
- Modify (only if missing): `package.json` (+ `package-lock.json`)

- [ ] **Step 1: Check whether `open` is already a dependency**

Run: `node -e "process.exit(require('./package.json').dependencies?.open ? 0 : 1)"`
Expected: exit `0` — `open` is present (added by 02-dispatcher). If it exits `1`, run `npm install open@^10.1.0` (the only case this task edits `package.json`), then continue.

- [ ] **Step 2: Verify the baseline suite passes**

Run: `npm test`
Expected: PASS — the whole suite is green. If red, stop and investigate before writing any CLI code.

- [ ] **Step 3: Commit only if Step 1 had to install `open`**

If `open` was already present, there is nothing to commit — skip this step. If Step 1 installed it:

```bash
git add package.json package-lock.json
git commit -m "build(standalone): ensure open runtime dep present for the cli"
```

---

## Task 2: `flags.ts` — pure argv parser

Implements the flag inventory and strict unknown-flag rejection (spec "Flag inventory"; acceptance #1–#3; the entire `flags.test.ts` table). No I/O, no side effects — tested in isolation.

**Files:**
- Create: `src/standalone/flags.ts`
- Test: `src/standalone/__tests__/flags.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/standalone/__tests__/flags.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseFlags, FlagError } from '../flags';

describe('parseFlags', () => {
  it('returns defaults when no flags are given', () => {
    expect(parseFlags([])).toEqual({
      port: 7331,
      open: true,
      logFile: null,
      rotateToken: false,
      showVersion: false,
      showHelp: false,
    });
  });

  it('parses --port as a number', () => {
    expect(parseFlags(['--port', '8080']).port).toBe(8080);
  });

  it('throws FlagError on a non-numeric --port', () => {
    expect(() => parseFlags(['--port', 'abc'])).toThrow(FlagError);
  });

  it('throws FlagError when --port has no value', () => {
    expect(() => parseFlags(['--port'])).toThrow(FlagError);
  });

  it('sets open=false for --no-open', () => {
    expect(parseFlags(['--no-open']).open).toBe(false);
  });

  it('sets showHelp for both -h and --help', () => {
    expect(parseFlags(['-h']).showHelp).toBe(true);
    expect(parseFlags(['--help']).showHelp).toBe(true);
  });

  it('sets showVersion for both -v and --version', () => {
    expect(parseFlags(['-v']).showVersion).toBe(true);
    expect(parseFlags(['--version']).showVersion).toBe(true);
  });

  it('throws FlagError on an unknown flag', () => {
    expect(() => parseFlags(['--made-up'])).toThrow(FlagError);
  });

  it('throws FlagError when --log-file has no value', () => {
    expect(() => parseFlags(['--log-file'])).toThrow(FlagError);
  });

  it('captures the --log-file path', () => {
    expect(parseFlags(['--log-file', '/tmp/x.log']).logFile).toBe('/tmp/x.log');
  });

  it('treats --rotate-token as a boolean and does not consume the next arg', () => {
    const flags = parseFlags(['--rotate-token', '--no-open']);
    expect(flags.rotateToken).toBe(true);
    expect(flags.open).toBe(false);
  });

  it('rejects a v2 flag with a v1-specific message', () => {
    expect(() => parseFlags(['--host'])).toThrow(/not supported in v1/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/standalone/__tests__/flags.test.ts`
Expected: FAIL — `Failed to resolve import "../flags"` (the source file does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/standalone/flags.ts`:

```ts
// src/standalone/flags.ts
// Pure argv -> ParsedFlags parser for the `coach` CLI. No I/O, no side effects,
// so it is unit-tested in isolation without spawning a server.
// See docs-fork/specs/05-cli.md.

export interface ParsedFlags {
  port: number; // default 7331
  open: boolean; // default true
  logFile: string | null; // default null
  rotateToken: boolean; // default false
  showVersion: boolean; // default false
  showHelp: boolean; // default false
}

export class FlagError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FlagError';
  }
}

const DEFAULT_PORT = 7331;

// Listed so a v2 flag yields a specific message instead of a bare "unknown flag".
const V2_FLAGS = new Set(['--host', '--project', '--inspect', '--no-cache', '--reset']);

export function parseFlags(argv: string[]): ParsedFlags {
  const flags: ParsedFlags = {
    port: DEFAULT_PORT,
    open: true,
    logFile: null,
    rotateToken: false,
    showVersion: false,
    showHelp: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--port': {
        const value = argv[++i];
        if (value === undefined) throw new FlagError('--port requires a number');
        const port = Number(value);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          throw new FlagError(`--port must be an integer 1..65535, got "${value}"`);
        }
        flags.port = port;
        break;
      }
      case '--no-open':
        flags.open = false;
        break;
      case '--log-file': {
        const value = argv[++i];
        if (value === undefined) throw new FlagError('--log-file requires a path');
        flags.logFile = value;
        break;
      }
      case '--rotate-token':
        flags.rotateToken = true;
        break;
      case '-v':
      case '--version':
        flags.showVersion = true;
        break;
      case '-h':
      case '--help':
        flags.showHelp = true;
        break;
      default:
        if (V2_FLAGS.has(arg)) {
          throw new FlagError(`${arg} is not supported in v1 (planned for a later release)`);
        }
        throw new FlagError(`unknown flag: ${arg}`);
    }
  }
  return flags;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/standalone/__tests__/flags.test.ts`
Expected: PASS — 12 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/standalone/flags.ts src/standalone/__tests__/flags.test.ts
git commit -m "feat(standalone): add coach CLI flag parser"
```

---

## Task 3: `parse-bootstrap.ts` — vscode-free parse + Analyzer

Isolates the intentionally-duplicated parse setup from `panel.ts:205-224` (spec "Dependencies" caveat). Covers the empty-dirs contract (resolve an empty `ParseResult`, never spawn a worker) and the populated path (worker result → `Analyzer`, progress forwarded). Tested with `../core/parser` and `../core/analyzer` mocked, so no real worker spawns and no `vscode`-adjacent module loads.

**Files:**
- Create: `src/standalone/parse-bootstrap.ts`
- Test: `src/standalone/__tests__/parse-bootstrap.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/standalone/__tests__/parse-bootstrap.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../core/parser', () => ({
  findLogsDirs: vi.fn(),
  parseAllLogsViaWorker: vi.fn(),
}));
vi.mock('../../core/analyzer', () => ({
  Analyzer: vi.fn(),
}));

import { findLogsDirs, parseAllLogsViaWorker } from '../../core/parser';
import { Analyzer } from '../../core/analyzer';
import { bootstrapParse } from '../parse-bootstrap';

const mockedFindLogsDirs = vi.mocked(findLogsDirs);
const mockedParseViaWorker = vi.mocked(parseAllLogsViaWorker);
const MockedAnalyzer = vi.mocked(Analyzer);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('bootstrapParse', () => {
  it('returns an empty ParseResult without spawning a worker when no log dirs exist', async () => {
    mockedFindLogsDirs.mockReturnValue([]);

    const { parseResult } = await bootstrapParse(() => {});

    expect(parseResult.sessions).toEqual([]);
    expect(parseResult.workspaces.size).toBe(0);
    expect(parseResult.editLocIndex.size).toBe(0);
    expect(parseResult.sessionSourceIndex.size).toBe(0);
    expect(mockedParseViaWorker).not.toHaveBeenCalled();
    // The Analyzer is still constructed (over empty data) so the dashboard renders.
    expect(MockedAnalyzer).toHaveBeenCalledOnce();
  });

  it('parses via the worker and builds the Analyzer from its result', async () => {
    mockedFindLogsDirs.mockReturnValue(['/logs/a', '/logs/b']);
    const workerResult = {
      workspaces: new Map(),
      sessions: [],
      editLocIndex: new Map(),
      sessionSourceIndex: new Map(),
    };
    mockedParseViaWorker.mockResolvedValue(workerResult as never);

    const { parseResult } = await bootstrapParse(() => {});

    expect(mockedParseViaWorker).toHaveBeenCalledWith(['/logs/a', '/logs/b'], expect.any(Function));
    expect(parseResult).toBe(workerResult);
    expect(MockedAnalyzer).toHaveBeenCalledWith(
      workerResult.sessions,
      workerResult.editLocIndex,
      workerResult.workspaces,
    );
  });

  it('forwards worker progress to the caller callback', async () => {
    mockedFindLogsDirs.mockReturnValue(['/logs/a']);
    mockedParseViaWorker.mockResolvedValue({
      workspaces: new Map(),
      sessions: [],
      editLocIndex: new Map(),
      sessionSourceIndex: new Map(),
    } as never);
    const onProgress = vi.fn();

    await bootstrapParse(onProgress);

    // Grab the onProgress the worker received and fire it; the caller should see it.
    const workerOnProgress = mockedParseViaWorker.mock.calls[0][1] as (p: unknown) => void;
    workerOnProgress({ phase: 2, pct: 50, detail: 'parsing' });
    expect(onProgress).toHaveBeenCalledWith({ phase: 2, pct: 50, detail: 'parsing' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/standalone/__tests__/parse-bootstrap.test.ts`
Expected: FAIL — `Failed to resolve import "../parse-bootstrap"` (the source file does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/standalone/parse-bootstrap.ts`:

```ts
// src/standalone/parse-bootstrap.ts
// Standalone parse entry. DUPLICATES the worker-pool + Analyzer construction from
// src/webview/panel.ts:205-224 (loadData) -- copied, not imported, because panel.ts
// pulls `vscode`. A future upstream "shared bootstrap" refactor can collapse the two.
// Both halves (findLogsDirs, parseAllLogsViaWorker) are vscode-free core functions.
// See docs-fork/specs/05-cli.md.
import { findLogsDirs, parseAllLogsViaWorker, type LoadProgress } from '../core/parser';
import { Analyzer } from '../core/analyzer';
import type { ParseResult } from '../core/cache';

type ProgressFn = (p: LoadProgress) => void;

function emptyResult(): ParseResult {
  return {
    workspaces: new Map(),
    sessions: [],
    editLocIndex: new Map(),
    sessionSourceIndex: new Map(),
  };
}

export async function bootstrapParse(
  onProgress: ProgressFn,
): Promise<{ analyzer: Analyzer; parseResult: ParseResult }> {
  onProgress({ phase: 0, detail: 'Discovering log directories', pct: 0 });

  const dirs = findLogsDirs();
  const parseResult = dirs.length === 0 ? emptyResult() : await parseAllLogsViaWorker(dirs, (p) => onProgress(p));

  const analyzer = new Analyzer(parseResult.sessions, parseResult.editLocIndex, parseResult.workspaces);
  return { analyzer, parseResult };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/standalone/__tests__/parse-bootstrap.test.ts`
Expected: PASS — 3 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/standalone/parse-bootstrap.ts src/standalone/__tests__/parse-bootstrap.test.ts
git commit -m "feat(standalone): add vscode-free parse bootstrap"
```

---

## Task 4: `cli.ts` — flag dispatch, help, version

Creates `cli.ts` with `HELP_TEXT`, `readPkgVersion`, and the early-exit half of `runCli` (parse errors → exit 2; `--help`/`--version` → stdout + exit 0). Boot logic is a clearly-marked stub completed in Task 5. Covers `cli.test.ts` rows `--version exits 0 and prints version`, `--help exits 0 and prints usage`, `unknown flag exits 2`, and acceptance #1–#3.

The test file mocks `./server`, `./parse-bootstrap`, and `open` from the start (they are imported by `cli.ts` in Task 5; mocking a not-yet-imported module is harmless and keeps the test file stable). `process.stdout`/`process.stderr` writes are captured via spies.

**Files:**
- Create: `src/standalone/cli.ts`
- Test: `src/standalone/__tests__/cli.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/standalone/__tests__/cli.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server', () => ({
  createServer: vi.fn(),
  probeExistingInstance: vi.fn(),
}));
vi.mock('../parse-bootstrap', () => ({
  bootstrapParse: vi.fn(),
}));
vi.mock('open', () => ({ default: vi.fn() }));

import { runCli } from '../cli';

function captureStream(stream: NodeJS.WriteStream): { text: () => string; restore: () => void } {
  let buf = '';
  const spy = vi.spyOn(stream, 'write').mockImplementation((chunk: unknown): boolean => {
    buf += typeof chunk === 'string' ? chunk : String(chunk);
    return true;
  });
  return { text: () => buf, restore: () => spy.mockRestore() };
}

let outCap: ReturnType<typeof captureStream>;
let errCap: ReturnType<typeof captureStream>;

beforeEach(() => {
  vi.clearAllMocks();
  outCap = captureStream(process.stdout);
  errCap = captureStream(process.stderr);
});

afterEach(() => {
  outCap.restore();
  errCap.restore();
});

describe('runCli — flags and early exits', () => {
  it('--version prints the package version and exits 0', async () => {
    const code = await runCli(['node', 'coach', '--version']);
    expect(code).toBe(0);
    expect(outCap.text()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('-v is an alias for --version', async () => {
    const code = await runCli(['node', 'coach', '-v']);
    expect(code).toBe(0);
    expect(outCap.text()).toMatch(/\d+\.\d+\.\d+/);
  });

  it('--help prints usage and exits 0', async () => {
    const code = await runCli(['node', 'coach', '--help']);
    expect(code).toBe(0);
    expect(outCap.text()).toContain('Usage: coach [options]');
  });

  it('an unknown flag prints an error to stderr and exits 2', async () => {
    const code = await runCli(['node', 'coach', '--made-up-flag']);
    expect(code).toBe(2);
    expect(errCap.text()).toContain('unknown flag: --made-up-flag');
    expect(errCap.text()).toContain('coach --help');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/standalone/__tests__/cli.test.ts`
Expected: FAIL — `Failed to resolve import "../cli"` (the source file does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/standalone/cli.ts`. Boot is a stub returning `0`; Task 5 replaces it. Only the imports used now are present — Task 5 adds the boot imports:

```ts
// src/standalone/cli.ts
// The `coach` command: parse flags, reuse a live instance or serve-then-parse,
// open the browser, and shut down cleanly on signal. See docs-fork/specs/05-cli.md.
import { parseFlags, FlagError, type ParsedFlags } from './flags';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';

const HELP_TEXT = `Usage: coach [options]

Open the AI Engineer Coach dashboard in a local browser.

Options:
  --port <n>          Listen on port n (default 7331; retries +1..+9 on collision)
  --no-open           Do not open a browser; just print the URL
  --log-file <path>   Append diagnostic logs to a file
  --rotate-token      Generate a fresh auth token before booting
  -v, --version       Print version and exit
  -h, --help          Print this help and exit

The server binds to 127.0.0.1 only. The URL contains an access token;
treat it as a secret. State lives under ~/.ai-engineer-coach/.
`;

// Resolve package.json from import.meta.url so it works under vitest (src/standalone)
// and the esbuild CJS bundle (dist/standalone) alike -- both sit two levels below the
// dir holding package.json. esbuild rewrites import.meta.url for cjs output.
export function readPkgVersion(): string {
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export async function runCli(argv: string[]): Promise<number> {
  let flags: ParsedFlags;
  try {
    flags = parseFlags(argv.slice(2));
  } catch (e) {
    if (e instanceof FlagError) {
      process.stderr.write(`${e.message}\n`);
      process.stderr.write('Run `coach --help` for usage.\n');
      return 2;
    }
    throw e;
  }

  if (flags.showHelp) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }
  if (flags.showVersion) {
    process.stdout.write(`${readPkgVersion()}\n`);
    return 0;
  }

  // Boot is added in Task 5.
  return 0;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/standalone/__tests__/cli.test.ts`
Expected: PASS — 4 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/standalone/cli.ts src/standalone/__tests__/cli.test.ts
git commit -m "feat(standalone): add coach CLI flag dispatch, help, and version"
```

---

## Task 5: `cli.ts` boot — reuse, serve-then-parse, shutdown

Completes `runCli`: probe for a live instance (reuse → print + open + return 0), else `createServer` (serve), print the URL to stderr, open the browser unless `--no-open`, `bootstrapParse` (forwarding progress), `handle.setData(...)`, then block on a shutdown promise resolved by SIGINT (130) / SIGTERM (143). Covers `cli.test.ts` rows `fresh boot prints URL`, `second invocation reuses existing`, `SIGINT shuts down cleanly`, and acceptance #4, #4a, #5, #6, #7, #8.

**Files:**
- Modify: `src/standalone/cli.ts`
- Modify: `src/standalone/__tests__/cli.test.ts`

- [ ] **Step 1: Write the failing tests**

Add the boot-path imports and a fake-handle helper just below the existing `import { runCli } from '../cli';` line in `src/standalone/__tests__/cli.test.ts`:

```ts
import { createServer, probeExistingInstance, type ServerHandle } from '../server';
import { bootstrapParse } from '../parse-bootstrap';
import open from 'open';

const mockedCreateServer = vi.mocked(createServer);
const mockedProbe = vi.mocked(probeExistingInstance);
const mockedBootstrap = vi.mocked(bootstrapParse);
const mockedOpen = vi.mocked(open);

const TOKEN = 'a'.repeat(64);

function fakeHandle(): ServerHandle {
  return {
    url: `http://127.0.0.1:7331/?t=${TOKEN}`,
    port: 7331,
    token: TOKEN,
    setData: vi.fn(),
    broadcast: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

// Retrieve a process signal handler that runCli registered, so the test can trigger
// shutdown deterministically without delivering a real OS signal to the test runner.
function triggerSignal(onSpy: ReturnType<typeof vi.spyOn>, signal: 'SIGINT' | 'SIGTERM'): void {
  const call = onSpy.mock.calls.find((c) => c[0] === signal);
  if (!call) throw new Error(`runCli did not register a ${signal} handler`);
  (call[1] as () => void)();
}
```

Then append the boot describe block:

```ts
describe('runCli — boot', () => {
  it('reuses a live instance: prints, opens, exits 0 without starting a server', async () => {
    const existingUrl = `http://127.0.0.1:7331/?t=${'b'.repeat(64)}`;
    mockedProbe.mockResolvedValue(existingUrl);

    const code = await runCli(['node', 'coach']);

    expect(code).toBe(0);
    expect(errCap.text()).toContain('coach already running at');
    expect(mockedOpen).toHaveBeenCalledWith(existingUrl);
    expect(mockedCreateServer).not.toHaveBeenCalled();
  });

  it('fresh boot serves first, prints URL, opens, parses, calls setData once; SIGINT -> 130', async () => {
    mockedProbe.mockResolvedValue(null);
    const handle = fakeHandle();
    mockedCreateServer.mockResolvedValue(handle);
    mockedBootstrap.mockResolvedValue({ analyzer: {} as never, parseResult: {} as never });
    const onSpy = vi.spyOn(process, 'on');

    const p = runCli(['node', 'coach']);
    await vi.waitFor(() => expect(handle.setData).toHaveBeenCalledOnce());

    expect(mockedCreateServer).toHaveBeenCalledWith({ port: 7331, token: undefined, logFile: undefined });
    expect(errCap.text()).toContain(`coach running at ${handle.url}`);
    expect(mockedOpen).toHaveBeenCalledWith(handle.url);
    expect(mockedBootstrap).toHaveBeenCalledWith(expect.any(Function));

    // Serve-then-parse (acceptance 4a): createServer was called before bootstrapParse.
    expect(mockedCreateServer.mock.invocationCallOrder[0]).toBeLessThan(
      mockedBootstrap.mock.invocationCallOrder[0],
    );

    // Progress forwarding: the callback handed to bootstrapParse broadcasts a progress frame.
    const forward = mockedBootstrap.mock.calls[0][0] as (p: Record<string, unknown>) => void;
    forward({ phase: 2, pct: 40 });
    expect(handle.broadcast).toHaveBeenCalledWith({ type: 'progress', phase: 2, pct: 40 });

    triggerSignal(onSpy, 'SIGINT');
    expect(await p).toBe(130);
    expect(handle.close).toHaveBeenCalledOnce();
  });

  it('--no-open does not call open', async () => {
    mockedProbe.mockResolvedValue(null);
    const handle = fakeHandle();
    mockedCreateServer.mockResolvedValue(handle);
    mockedBootstrap.mockResolvedValue({ analyzer: {} as never, parseResult: {} as never });
    const onSpy = vi.spyOn(process, 'on');

    const p = runCli(['node', 'coach', '--no-open']);
    await vi.waitFor(() => expect(handle.setData).toHaveBeenCalledOnce());

    expect(mockedOpen).not.toHaveBeenCalled();

    triggerSignal(onSpy, 'SIGINT');
    await p;
  });

  it('--rotate-token passes a fresh 64-hex token to createServer', async () => {
    mockedProbe.mockResolvedValue(null);
    const handle = fakeHandle();
    mockedCreateServer.mockResolvedValue(handle);
    mockedBootstrap.mockResolvedValue({ analyzer: {} as never, parseResult: {} as never });
    const onSpy = vi.spyOn(process, 'on');

    const p = runCli(['node', 'coach', '--rotate-token', '--no-open']);
    await vi.waitFor(() => expect(handle.setData).toHaveBeenCalledOnce());

    const opts = mockedCreateServer.mock.calls[0][0];
    expect(opts.token).toMatch(/^[0-9a-f]{64}$/);

    triggerSignal(onSpy, 'SIGINT');
    await p;
  });

  it('propagates a fatal createServer error (bin/coach maps it to exit 1)', async () => {
    mockedProbe.mockResolvedValue(null);
    mockedCreateServer.mockRejectedValue(new Error('no free port in 7331..7340'));

    await expect(runCli(['node', 'coach', '--no-open'])).rejects.toThrow('no free port');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/standalone/__tests__/cli.test.ts`
Expected: FAIL — the boot stub returns `0` immediately, so `probeExistingInstance`/`createServer`/`bootstrapParse` are never called and no signal handler is registered: `reuses a live instance` fails (`mockedOpen` not called), the three boot tests time out in `vi.waitFor` (`setData` never called), and `propagates a fatal createServer error` fails (resolves `0` instead of rejecting). The 4 early-exit tests still pass.

- [ ] **Step 3: Write minimal implementation**

In `src/standalone/cli.ts`, add the boot-path imports just below the existing `import { parseFlags, ... } from './flags';` line:

```ts
import { createServer, probeExistingInstance, type ServerHandle } from './server';
import { bootstrapParse } from './parse-bootstrap';
import open from 'open';
import { randomBytes } from 'crypto';
```

Then replace the boot stub (`// Boot is added in Task 5.` and its `return 0;`) with the full boot sequence, and add `installShutdownHandlers` below `runCli`:

```ts
  const existing = await probeExistingInstance(flags.port);
  if (existing) {
    process.stderr.write(`coach already running at ${existing}\n`);
    if (flags.open) {
      try {
        await open(existing);
      } catch {
        /* warn-and-go: a missing browser must not fail the reuse path */
      }
    }
    return 0;
  }

  const token = flags.rotateToken ? randomBytes(32).toString('hex') : undefined;

  // Serve first -- the browser shows the loading shell while we parse.
  const handle = await createServer({ port: flags.port, token, logFile: flags.logFile ?? undefined });
  process.stderr.write(`coach running at ${handle.url}\n`);
  if (flags.open) {
    try {
      await open(handle.url);
    } catch (e) {
      process.stderr.write(`(browser open failed: ${(e as Error).message})\n`);
    }
  }

  // Then parse, forwarding progress; setData broadcasts dataReady to the open browser.
  const { analyzer, parseResult } = await bootstrapParse((p) => handle.broadcast({ type: 'progress', ...p }));
  handle.setData(analyzer, parseResult);

  return await new Promise<number>((resolve) => installShutdownHandlers(handle, resolve));
}

// SIGINT -> 130, SIGTERM -> 143 (128 + signal). Each handler removes both listeners
// so the process can exit and tests leave no dangling registrations.
function installShutdownHandlers(handle: ServerHandle, resolve: (code: number) => void): void {
  let done = false;
  const shutdown = (code: number) => (): void => {
    if (done) return;
    done = true;
    process.removeListener('SIGINT', onInt);
    process.removeListener('SIGTERM', onTerm);
    void handle.close().then(() => resolve(code));
  };
  const onInt = shutdown(130);
  const onTerm = shutdown(143);
  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);
```

The original closing brace of `runCli` is now the closing brace of `installShutdownHandlers`; ensure the file ends with that single brace (do not leave a stray one from the removed stub).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/standalone/__tests__/cli.test.ts`
Expected: PASS — 9 tests passed (4 early-exit + 5 boot).

- [ ] **Step 5: Commit**

```bash
git add src/standalone/cli.ts src/standalone/__tests__/cli.test.ts
git commit -m "feat(standalone): add coach CLI serve-then-parse boot and shutdown"
```

---

## Task 6: `--log-file` — tee stderr to a file

Adds `attachLogFile` (spec boot step 2) and wires it into `runCli` before the probe. The tee is synchronous (`fs.appendFileSync`) so it is flush-safe and deterministic to test; a failed open warns and continues without exiting.

**Files:**
- Modify: `src/standalone/cli.ts`
- Modify: `src/standalone/__tests__/cli.test.ts`

- [ ] **Step 1: Write the failing tests**

Add an `os` import at the top of `src/standalone/__tests__/cli.test.ts` (below the `vi.mock(...)` calls and the `runCli` import), and the `attachLogFile` symbol to the `../cli` import:

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
```

Change `import { runCli } from '../cli';` to:

```ts
import { runCli, attachLogFile } from '../cli';
```

Then append:

```ts
describe('attachLogFile', () => {
  it('tees subsequent stderr writes into the log file', () => {
    errCap.restore(); // drop the global stderr spy so we tee the real stream
    const realWrite = process.stderr.write;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-log-'));
    const logPath = path.join(dir, 'coach.log');

    try {
      attachLogFile(logPath);
      process.stderr.write('hello-log\n');
      process.stderr.write = realWrite; // detach the tee before asserting

      expect(fs.readFileSync(logPath, 'utf8')).toContain('hello-log');
    } finally {
      process.stderr.write = realWrite;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not throw when the log path is unwritable', () => {
    errCap.restore();
    const realWrite = process.stderr.write;
    const badPath = path.join(os.tmpdir(), 'coach-no-such-dir-xyz', 'a.log');

    try {
      expect(() => attachLogFile(badPath)).not.toThrow();
      expect(process.stderr.write).toBe(realWrite); // left the stream untouched
    } finally {
      process.stderr.write = realWrite;
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/standalone/__tests__/cli.test.ts`
Expected: FAIL — `attachLogFile is not a function` / `does not provide an export named 'attachLogFile'` (not yet defined). The other 9 tests still pass.

- [ ] **Step 3: Write minimal implementation**

In `src/standalone/cli.ts`, add `attachLogFile` below `readPkgVersion`:

```ts
// Tee every subsequent stderr write into `logFile` (append). A bad path warns once
// and leaves stderr untouched -- a missing log target must never abort boot.
export function attachLogFile(logFile: string): void {
  try {
    fs.appendFileSync(logFile, ''); // validate the path up front
  } catch (e) {
    process.stderr.write(`(could not open log file ${logFile}: ${(e as Error).message})\n`);
    return;
  }
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
    try {
      fs.appendFileSync(logFile, typeof chunk === 'string' ? chunk : Buffer.from(chunk));
    } catch {
      /* keep stderr working even if the file later vanishes */
    }
    return (original as (c: string | Uint8Array, ...r: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stderr.write;
}
```

Then wire it into `runCli`, immediately after the `--version` early-exit block and before the `probeExistingInstance` call:

```ts
  if (flags.logFile) attachLogFile(flags.logFile);

  const existing = await probeExistingInstance(flags.port);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/standalone/__tests__/cli.test.ts`
Expected: PASS — 11 tests passed (4 early-exit + 5 boot + 2 log-file).

- [ ] **Step 5: Commit**

```bash
git add src/standalone/cli.ts src/standalone/__tests__/cli.test.ts
git commit -m "feat(standalone): add --log-file stderr tee"
```

---

## Task 7: `bin/coach` launcher + full-suite & additive-only verification

Creates the Node shebang launcher (spec Public API) and runs the project-wide checks. `bin/coach` cannot be executed here (no `dist/standalone/cli.js` until 07-build); it is smoke-exercised by 08-testing. The `package.json` `bin`/`files`/`scripts` wiring is 07-build's additive edit and is **not** done here.

**Files:**
- Create: `bin/coach`

- [ ] **Step 1: Create the launcher**

Create `bin/coach` with exactly:

```js
#!/usr/bin/env node
require('../dist/standalone/cli.js').runCli(process.argv)
  .then((code) => process.exit(code))
  .catch((err) => { console.error(err); process.exit(1); });
```

The `.catch` is the exit-1 path (spec exit-code table: fatal `createServer` error → bin maps the rejected `runCli` to exit 1). On Windows, npm generates a `.cmd` shim from the `bin` field + shebang at install time (07-build wires the field), so no custom Windows launcher is needed.

- [ ] **Step 2: Run the full vitest suite**

Run: `npm test`
Expected: PASS — the whole suite is green, including the new `flags.test.ts` (12), `parse-bootstrap.test.ts` (3), and `cli.test.ts` (11). If a pre-existing test now fails, stop and investigate — this work is additive and must not affect other suites.

- [ ] **Step 3: TypeScript strict check**

Run: `npx tsc --noEmit`
Expected: no errors. (`bin/coach` is not type-checked — `tsconfig.json` `include` is `src/**/*.ts`.)

- [ ] **Step 4: Verify additive-only fork discipline**

Run: `git diff upstream/main -- src/ | grep -E '^[-+]' | grep -vE '^[-+]{3}'`
Expected: every line is an addition (`+`) and every added line is inside `src/standalone/`. No deletions (`-`) and no edits to files outside `src/standalone/`.
(If `upstream/main` is not configured: `git remote add upstream <upstream-url> && git fetch upstream`. `bin/coach` lives outside `src/` and is a sanctioned new file per 00-overview, so it does not appear in this `src/`-scoped diff. `package.json` is unchanged by this plan unless Task 1 had to install `open`.)

- [ ] **Step 5: Confirm no `vscode` import crept into the leaf modules**

Run: `grep -rn "vscode" src/standalone/flags.ts src/standalone/cli.ts src/standalone/parse-bootstrap.ts`
Expected: no matches. `flags.ts` is pure; `parse-bootstrap.ts` reuses only vscode-free core functions; `cli.ts` reaches `vscode`-adjacent code only transitively through `./server` at runtime (resolved by the standalone build alias), never by direct import.

- [ ] **Step 6: Commit**

```bash
git add bin/coach
git commit -m "feat(standalone): add bin/coach launcher"
```

---

## Self-Review

### Spec coverage

| Spec requirement (`05-cli.md`) | Task | Test / artifact |
|---|---|---|
| `ParsedFlags` / `FlagError` / `parseFlags` Public API | Task 2 | `flags.ts` + `flags.test.ts` |
| Flag inventory (`--port`, `--no-open`, `--log-file`, `--rotate-token`, `-v/--version`, `-h/--help`); unknown → exit 2; v2 flags rejected | Tasks 2, 4, 5, 6 | `flags.test.ts` (all rows) + `cli.test.ts` unknown-flag |
| `runCli(argv): Promise<number>` Public API | Task 4 (grown 5, 6) | `cli.ts` + `cli.test.ts` |
| Boot step 1 — parse; help/version print + return 0 | Task 4 | `--version`/`--help` tests |
| Boot step 2 — `--log-file` tee, non-fatal on open failure | Task 6 | `attachLogFile` tests |
| Boot step 3 — `--rotate-token` → fresh token into `createServer` | Task 5 | `--rotate-token` test |
| Boot step 4 — `probeExistingInstance` reuse: print + open + return 0, no server | Task 5 | `reuses a live instance` test |
| Boot steps 5–7 — serve-then-parse: `createServer` → print URL → open → `bootstrapParse` → `setData` | Task 5 | `fresh boot` test (+ `invocationCallOrder` for 4a, `setData` called once) |
| Boot step 7 — progress forwarding via `broadcast({type:'progress', ...p})` | Task 5 | `fresh boot` progress-forward assertion |
| Boot step 8 — SIGINT/SIGTERM → `handle.close()` then exit | Task 5 | `SIGINT -> 130` test |
| `bootstrapParse` reuses `findLogsDirs`+`parseAllLogsViaWorker`+`Analyzer`; empty `ParseResult` when no dirs | Task 3 | `parse-bootstrap.test.ts` |
| `bin/coach` launcher | Task 7 | `bin/coach` |
| Output streams — stderr for status/URL, stdout only for `--version`/`--help` | Tasks 4, 5 | `outCap`/`errCap` assertions |
| Exit codes 0 / 1 / 2 / 130 | Tasks 4, 5, 7 | version/help/reuse (0), fatal-error reject → bin 1, unknown flag (2), SIGINT (130) |
| Acceptance #1–#8 | Tasks 2, 4, 5 | mapped above; #7 end-to-end two-invocation token persistence and #8 `server-state.json` removal are the **server's** half (06-state `clearServerState` via `handle.close()`), verified there + 08-testing |

### Placeholder scan

No `TBD`/`TODO`/"handle edge cases"/"similar to Task N". Every code step shows complete code; every run step shows the exact command and expected result. The one intentional transient is Task 4's `// Boot is added in Task 5.` stub, explicitly replaced in Task 5 Step 3.

### Type consistency

- `ParsedFlags` is defined once (Task 2) with `port/open/logFile/rotateToken/showVersion/showHelp` and consumed unchanged by `runCli`.
- `runCli(argv: string[]): Promise<number>` — signature stable across Tasks 4–6; `bin/coach` calls `.runCli(process.argv)` and maps the resolved number via `process.exit(code)`.
- Server seam matches `01-server.plan.md` exactly: `createServer({ port?, token?, logFile? }): Promise<ServerHandle>`, `probeExistingInstance(port): Promise<string|null>`, `ServerHandle.{url,port,token,setData,broadcast,close}`. `handle.broadcast` takes `Record<string, unknown>` — the `{ type:'progress', ...p }` frame conforms.
- `bootstrapParse(onProgress: (p: LoadProgress) => void): Promise<{ analyzer: Analyzer; parseResult: ParseResult }>` — the returned shape is destructured as `{ analyzer, parseResult }` and fed straight into `handle.setData(analyzer, parseResult)`. `LoadProgress`/`ParseResult`/`Analyzer` are imported from the verified upstream paths (`../core/parser`, `../core/cache`, `../core/analyzer`).
- `attachLogFile`/`readPkgVersion` named exports are spelled identically in source and tests.
- `randomBytes(32).toString('hex')` produces the 64-hex token the `--rotate-token` test asserts (`/^[0-9a-f]{64}$/`) and that `state.ts`/the server validate.
