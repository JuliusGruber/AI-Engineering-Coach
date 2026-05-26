import * as fs from 'node:fs';
import * as path from 'node:path';

// CommonJS project: use __dirname (no import.meta).
const RUNTIME = path.join(__dirname, '.runtime.json');

export default async function globalTeardown(): Promise<void> {
  if (!fs.existsSync(RUNTIME)) return;
  const { pid, home } = JSON.parse(fs.readFileSync(RUNTIME, 'utf8')) as { pid: number; home: string };
  try { process.kill(pid, 'SIGINT'); } catch { /* already gone */ }
  await new Promise((r) => setTimeout(r, 500)); // let close() clear server-state.json
  try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* ignore */ }
  try { fs.rmSync(RUNTIME, { force: true }); } catch { /* ignore */ }
}
