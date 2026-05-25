# 05 — CLI (`coach` command)

User-facing entry point. Parses flags, boots [01-server](01-server.md),
opens the browser, prints the URL, and handles graceful shutdown.

## Goal

`coach` (and `npx @JuliusGruber/ai-engineer-coach`) is the only command
the user ever runs. It must:

- Work with zero arguments (the 80% case).
- Reuse an existing instance if one is alive.
- Print the URL on every boot so it can be copy-pasted into other
  browsers.
- Behave correctly under SIGINT / SIGTERM.

## Files

| Path                                          | Purpose                       | LOC |
|-----------------------------------------------|-------------------------------|-----|
| `src/standalone/cli.ts`                       | `runCli(argv)` entry          | ~90 |
| `src/standalone/flags.ts`                     | Pure flag parser              | ~40 |
| `src/standalone/parse-bootstrap.ts`           | Worker-pool / Analyzer setup duplicated from `extension.ts` | ~50 |
| `bin/coach`                                   | Node shebang launcher         | ~3  |
| `src/standalone/__tests__/flags.test.ts`      | Flag parser unit tests        | ~60 |
| `src/standalone/__tests__/cli.test.ts`        | CLI integration tests         | ~80 |

`flags.ts` is split out so the parser can be tested in isolation
without spawning servers. `parse-bootstrap.ts` isolates the small,
intentionally-duplicated piece of `extension.ts` (see the caveat in
[Dependencies](#dependencies)).

## Public API

```ts
// src/standalone/flags.ts

export interface ParsedFlags {
  port: number;          // default 7331
  open: boolean;         // default true
  logFile: string | null;// default null
  rotateToken: boolean;  // default false
  showVersion: boolean;  // default false
  showHelp: boolean;     // default false
}

export class FlagError extends Error {
  constructor(message: string);
}

export function parseFlags(argv: string[]): ParsedFlags;
```

```ts
// src/standalone/cli.ts

export async function runCli(argv: string[]): Promise<number>; // exit code
```

```sh
# bin/coach
#!/usr/bin/env node
require('../dist/standalone/cli.js').runCli(process.argv)
  .then((code) => process.exit(code))
  .catch((err) => { console.error(err); process.exit(1); });
```

## Behavior

### Flag inventory (v1)

| Flag                | Default     | Effect                                                          |
|---------------------|-------------|-----------------------------------------------------------------|
| `--port <n>`        | 7331        | Override starting port. Server still retries +1..+9 on collision. |
| `--no-open`         | false       | Skip browser open. URL is still printed.                        |
| `--log-file <path>` | none        | Append all stderr (parser errors, dispatcher errors, server warnings) to the given file in addition to stderr. |
| `--rotate-token`    | false       | Generate fresh token, persist to `server-state.json`, then continue boot. |
| `--version`, `-v`   | —           | Print `<pkg.version>` to stdout and exit 0.                     |
| `--help`, `-h`      | —           | Print usage text to stdout and exit 0.                          |

Unknown flag → print error to stderr + usage hint, exit code 2.

Deferred to v2 (any of these on the v1 CLI → unknown-flag error):
`--host`, `--project`, `--inspect`, `--no-cache`, `--reset`.

### Boot sequence

1. `parseFlags(argv.slice(2))`.
   - `--help` / `--version` → print, return 0.
2. If `logFile` set, open append stream and tee `process.stderr.write`
   into it. Wrap in try/catch; if open fails, log to real stderr and
   continue without log-file (do not exit).
3. If `rotateToken`, generate a fresh token now via
   `crypto.randomBytes(32).toString('hex')`. Pass into `createServer`
   as `opts.token`. (The server will persist it.)
4. Try `probeExistingInstance(flags.port)` from [01-server](01-server.md).
   - If it returns a URL: print URL to stderr, open browser unless
     `--no-open`, return 0. **Do not spawn the parse worker pool.**
5. Else: spawn the existing core parse worker (same pattern as
   `extension.ts` uses), build the `Analyzer` + initial `ParseResult`,
   then call `createServer({ port, token?, analyzer, parseResult, logFile })`.
6. Print URL to stderr.
7. Open browser via `open` npm package unless `--no-open`. Browser
   open errors → log warning to stderr, continue.
8. Install `SIGINT` / `SIGTERM` handlers → call `handle.close()` then
   exit 0.
9. Keep the process alive on the server handle.

### Output streams

- **stderr** for status messages (URL, "single instance reused",
  errors). Stderr is the correct stream for diagnostic output even
  when the process is succeeding; stdout stays clean for future
  scripted use.
- **stdout** for `--version` (prints pure version) and `--help` (prints
  usage). These are the only stdout writes.

### Help text

```
Usage: coach [options]

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
```

### Exit codes

| Code | Meaning                                          |
|------|--------------------------------------------------|
| 0    | Success (server running, or reused existing, or --help/--version) |
| 1    | Boot failed (port retry exhausted, fatal error in createServer)   |
| 2    | Bad arguments                                    |
| 130  | SIGINT (Node default; we preserve it)            |

## Decisions

| Open question                              | Decision                                            | Why |
|--------------------------------------------|-----------------------------------------------------|-----|
| Reuse existing instance — print or silent? | Print + open browser, return 0                      | Matches the `code .` mental model; user sees a confirmation |
| URL written to stdout or stderr?           | stderr                                              | Keeps stdout free for future `--print-url-only` machine mode |
| `--print-url-only` in v1?                  | No                                                  | YAGNI; trivially adds in v2 if asked |
| `npx` vs global install — different path?  | Identical                                           | Same `bin/coach` entry; npm handles both |
| Windows shebang                            | `npm` writes a `.cmd` shim automatically            | No custom Windows launcher needed |
| Background process / daemon                | No                                                  | Foreground only in v1; Ctrl-C kills it; matches Jupyter |

## Dependencies

- npm: `open` (^10 — pure-Node browser launcher; not the deprecated `opn`)
- Node built-ins: `crypto`, `fs`, `process`
- Fork: [01-server](01-server.md), [06-state](06-state.md)
- Upstream: core parse worker spawning code (the pattern lives in
  `src/extension.ts`; the standalone CLI duplicates the worker-pool
  setup rather than importing from `extension.ts`, since the extension
  module pulls in `vscode`).

**Caveat:** the parse-worker spawn code that lives inside
`src/extension.ts` is not directly importable (the file imports
`vscode`). The implementing agent extracts the worker-pool setup into
`src/standalone/parse-bootstrap.ts` by copying the relevant 30–50 LOC
from `extension.ts` (boot + result handling), not by editing
`extension.ts`. This duplication is annotated in `parse-bootstrap.ts`
with a comment naming the source lines, so a future "shared bootstrap"
refactor in upstream is mechanical.

## Code sketch — main flow

```ts
// src/standalone/cli.ts (abbreviated)
import { parseFlags, FlagError } from './flags';
import { createServer, probeExistingInstance } from './server';
import { bootstrapParse } from './parse-bootstrap';
import open from 'open';
import crypto from 'crypto';

export async function runCli(argv: string[]): Promise<number> {
  let flags;
  try { flags = parseFlags(argv.slice(2)); }
  catch (e) {
    if (e instanceof FlagError) { console.error(e.message); console.error('Run `coach --help` for usage.'); return 2; }
    throw e;
  }
  if (flags.showHelp)    { process.stdout.write(HELP_TEXT);          return 0; }
  if (flags.showVersion) { process.stdout.write(`${PKG_VERSION}\n`); return 0; }

  if (flags.logFile) attachLogFile(flags.logFile);

  const existing = await probeExistingInstance(flags.port);
  if (existing) {
    process.stderr.write(`coach already running at ${existing}\n`);
    if (flags.open) try { await open(existing); } catch { /* warn-and-go */ }
    return 0;
  }

  const token = flags.rotateToken ? crypto.randomBytes(32).toString('hex') : undefined;
  const { analyzer, parseResult } = await bootstrapParse();
  const handle = await createServer({ port: flags.port, token, analyzer, parseResult, logFile: flags.logFile ?? undefined });

  process.stderr.write(`coach running at ${handle.url}\n`);
  if (flags.open) try { await open(handle.url); } catch (e) { process.stderr.write(`(browser open failed: ${(e as Error).message})\n`); }

  installShutdownHandlers(handle);
  return await waitForExit(handle);
}
```

## Acceptance criteria

1. `coach --version` prints the package version and exits 0.
2. `coach --help` prints the help text and exits 0.
3. `coach --made-up-flag` prints an error, exits 2.
4. `coach` (no args) on a clean machine boots the server, prints a URL
   to stderr, opens the browser, and runs until SIGINT.
5. A second `coach` invocation while the first is alive prints
   "already running at …" to stderr, opens the same URL in the browser,
   exits 0.
6. `coach --no-open` does not invoke the `open` package (verified by
   spy in the integration test).
7. `coach --rotate-token` then a second `coach` invocation: the second
   gets the new token in its URL.
8. SIGINT during a running server shuts down cleanly, removes
   `server-state.json`, exits 130.

## Test plan

`src/standalone/__tests__/flags.test.ts`:

| Test name                              | Intent                                  |
|----------------------------------------|-----------------------------------------|
| `defaults when no flags`               | Sanity                                  |
| `--port n parses as number`            | Coercion                                |
| `--port non-numeric throws FlagError`  | Validation                              |
| `--no-open sets open=false`            | Bool toggle                             |
| `--help short and long`                | `-h` and `--help`                       |
| `--version short and long`             | `-v` and `--version`                    |
| `unknown flag throws FlagError`        | Strict mode                             |
| `--log-file requires arg`              | Missing-value detection                 |
| `--rotate-token is bool-only`          | No arg expected                         |

`src/standalone/__tests__/cli.test.ts` (uses vitest with spawned child
processes via `child_process.fork` against the built `cli.js`):

| Test name                                  | Intent                                          |
|--------------------------------------------|-------------------------------------------------|
| `--version exits 0 and prints version`     | Smoke                                           |
| `--help exits 0 and prints usage`          | Smoke                                           |
| `unknown flag exits 2`                     | Exit-code contract                              |
| `fresh boot prints URL`                    | Captures stderr, regex-matches URL pattern      |
| `second invocation reuses existing`        | Spawns two children; second exits 0 quickly     |
| `SIGINT shuts down cleanly`                | Sends SIGINT to spawned child; asserts exit 130 |
