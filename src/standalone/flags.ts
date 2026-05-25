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
