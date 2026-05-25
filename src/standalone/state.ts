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
  try {
    return JSON.parse(raw) as ServerState;
  } catch {
    const broken = `${file}.broken-${Date.now()}`;
    fs.renameSync(file, broken);
    console.warn(`[coach] corrupt server-state.json; moved to ${broken}`);
    return null;
  }
}
