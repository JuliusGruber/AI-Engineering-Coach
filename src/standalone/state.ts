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
