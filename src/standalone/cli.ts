// src/standalone/cli.ts
// The `coach` command: parse flags, reuse a live instance or serve-then-parse,
// open the browser, and shut down cleanly on signal. See docs-fork/specs/05-cli.md.
import { parseFlags, FlagError, type ParsedFlags } from './flags';
import { createServer, probeExistingInstance, type ServerHandle } from './server';
import { bootstrapParse } from './parse-bootstrap';
import open from 'open';
import { randomBytes } from 'crypto';
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

  if (flags.logFile) attachLogFile(flags.logFile);

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
}
