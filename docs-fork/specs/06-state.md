# 06 — State persistence

Atomic, versioned JSON persistence for the server's single-instance
runtime metadata. Leaf module: depends on nothing in the fork; consumed
by [01-server](01-server.md) and [05-cli](05-cli.md).

## Goal

Provide a single small module that owns `server-state.json` under
`~/.ai-engineer-coach/`. Encapsulates atomic writes, schema versioning,
and corruption recovery so callers never touch `fs.readFileSync` directly.

> **v1 scope note.** This module owns **only** `ServerState`. The
> `UserState`/`modelBudgets` half — the standalone replacement for
> `panel.ts`'s `globalState`-backed budget persistence — is **deferred to
> v2** along with the burndown page that consumes it (gated by
> `FF_TOKEN_REPORTING_ENABLED`, currently `false`; see
> [02-dispatcher](02-dispatcher.md#standalone-native-handlers-standalone_native)).
> No `state.json` / `UserState` exists in v1.

## Consumers

`ServerState` is consumed by [01-server](01-server.md) (single-instance
handshake) and [05-cli](05-cli.md) (boot). It is the only persisted state
in v1, and the CLI (on boot) and server (on shutdown) never write it
concurrently — which is why the no-locking decision below holds.

## Files

| Path                                | Purpose                          | LOC |
|-------------------------------------|----------------------------------|-----|
| `src/standalone/state.ts`           | Reader/writer module             | ~35 |
| `src/standalone/__tests__/state.test.ts` | Unit tests                  | ~50 |

## Public API

```ts
// src/standalone/state.ts

export interface ServerState {
  version: 1;
  port: number;
  token: string;          // 64-char hex
  pid: number;
  startedAt: string;      // ISO-8601 UTC
}

export function readServerState(): ServerState | null;
export function writeServerState(state: ServerState): void;
export function clearServerState(): void;

export function stateDir(): string;   // resolves and mkdir-p's ~/.ai-engineer-coach/
```

## Behavior

1. **Directory creation.** First call to any reader/writer ensures
   `~/.ai-engineer-coach/` exists (`fs.mkdirSync(path, { recursive: true })`).
   Tilde resolved via `os.homedir()`.
2. **Atomic write.** Write to `<file>.tmp` first, then `fs.renameSync`
   over the destination. Never partial-write a file.
3. **File mode.** `server-state.json` written with `0600` (owner
   read/write only). Defends the token from other users on shared machines.
4. **Schema versioning.** The file's top-level `version` field is
   validated on read. Mismatch → log a warning to stderr, return `null`.
   Do not migrate or overwrite — the user might be downgrading.
5. **Corruption recovery.** JSON parse error → rename the file to
   `<file>.broken-<unix-ms>`, log to stderr, return `null`. Never throw
   out of a reader.
6. **`clearServerState`.** Idempotent `unlink` of `server-state.json`
   (ignores ENOENT). Called on graceful shutdown.
7. **Concurrency.** No locking. Atomic rename is the only ordering
   guarantee; concurrent writers may race but never observe a
   half-written file.

## Decisions

| Open question                             | Decision                                                            | Why |
|-------------------------------------------|---------------------------------------------------------------------|-----|
| Per-file lock                             | None                                                                | The two writers in v1 (CLI on boot, server on shutdown) never overlap |
| Schema migration on version bump          | None in v1; bumps return `null`                                     | YAGNI until v2 introduces a real second schema |
| Corruption recovery destination           | `<file>.broken-<unix-ms>`                                           | Preserves evidence for debugging; unique name avoids overwriting prior broken file |
| File mode                                 | `0600`                                                              | Token is a secret; nothing else needs to read the file |

## Dependencies

- Node built-ins only (`fs`, `os`, `path`).
- No fork dependencies.

## Code sketch

The atomic write helper is the only non-trivial piece:

```ts
function atomicWriteJson(filePath: string, value: unknown): void {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, filePath);
}
```

## Acceptance criteria

1. After `writeServerState({ ... })`, a subsequent `readServerState()`
   returns the same object structure.
2. After `writeServerState({ ... })` then `clearServerState()`,
   `readServerState()` returns `null`.
3. Corrupting `server-state.json` with non-JSON content, then calling
   `readServerState()`, returns `null` and leaves a
   `server-state.json.broken-*` file in `~/.ai-engineer-coach/`.
4. `server-state.json` is created with mode `0600`
   (verified on POSIX; on Windows the test asserts no-throw and skips
   mode check).
5. Schema-version mismatch (e.g. `version: 99` on disk) → reader logs
   a warning to stderr and returns `null`; file is not overwritten.

## Test plan

All under `src/standalone/__tests__/state.test.ts`. Use vitest's `tmpdir`
fixture pattern and override `os.homedir` via a setter or `HOME` env
manipulation per test.

| Test name                                    | Intent                                                    |
|----------------------------------------------|-----------------------------------------------------------|
| `read server state returns null when absent` | First-run boot behavior                                   |
| `write then read server state round-trips`   | Happy path                                                |
| `read recovers from corrupt JSON`            | Asserts `.broken-*` file created, `null` returned         |
| `read handles unknown schema version`        | Asserts warning logged (capture stderr), `null` returned, file untouched |
| `atomic write does not leave .tmp on success`| Cleanup verified                                          |
| `clear server state is idempotent`           | Two calls in a row do not throw                           |
| `state dir created on first call`            | mkdir-p semantics                                         |
| `file mode is 0600 on POSIX`                 | Skipped on win32 via `process.platform` check             |
