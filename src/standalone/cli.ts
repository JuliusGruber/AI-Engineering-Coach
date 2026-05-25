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
