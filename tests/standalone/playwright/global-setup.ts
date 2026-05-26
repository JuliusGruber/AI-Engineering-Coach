import { fork } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

// CommonJS project: use __dirname (no import.meta). The fixture is an ES module (.mjs), so
// load it via dynamic import with an absolute file URL.
const RUNTIME = path.join(__dirname, '.runtime.json');
const CLI = path.resolve(__dirname, '../../../dist/standalone/cli.js');
const SEED = pathToFileURL(path.resolve(__dirname, '../fixtures/seed-home.mjs')).href;

export default async function globalSetup(): Promise<void> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-pw-'));
  const { seedHome } = (await import(SEED)) as { seedHome: (home: string) => string };
  seedHome(home);
  const child = fork(CLI, ['--no-open', '--port', '7388'], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const url = await new Promise<string>((resolve, reject) => {
    let buf = '';
    const t = setTimeout(() => reject(new Error(`cli did not start in 30s. stderr:\n${buf}`)), 30_000);
    child.stderr!.on('data', (b: Buffer) => {
      buf += b.toString();
      const m = buf.match(/coach running at (http:\/\/127\.0\.0\.1:\d+\/\?t=[0-9a-f]{64})/);
      if (m) { clearTimeout(t); resolve(m[1]); }
    });
    child.once('exit', (c) => reject(new Error(`cli exited (${c}) before serving. stderr:\n${buf}`)));
  });
  const u = new URL(url);
  fs.writeFileSync(
    RUNTIME,
    JSON.stringify({ pid: child.pid, home, origin: u.origin, token: u.searchParams.get('t') }),
  );
  child.unref(); // keep it running for the test run; teardown stops it via pid
}
