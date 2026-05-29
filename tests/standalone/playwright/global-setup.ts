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
const FAKE_LLM = path.resolve(__dirname, '../fixtures/fake-llm-server.mjs');

export default async function globalSetup(): Promise<void> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-pw-'));
  const { seedHome } = (await import(SEED)) as { seedHome: (home: string) => string };
  seedHome(home);
  const fake = fork(FAKE_LLM, [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const fakeUrl = await new Promise<string>((resolve, reject) => {
    let fbuf = '';
    const ft = setTimeout(() => reject(new Error(`fake-llm did not start in 10s. stderr:\n${fbuf}`)), 10_000);
    fake.stderr!.on('data', (b: Buffer) => {
      fbuf += b.toString();
      const m = fbuf.match(/fake-llm running at (http:\/\/127\.0\.0\.1:\d+)/);
      if (m) { clearTimeout(ft); resolve(m[1]); }
    });
    fake.once('exit', (c) => reject(new Error(`fake-llm exited (${c}) before serving. stderr:\n${fbuf}`)));
  });
  const child = fork(CLI, ['--no-open', '--port', '7388'], {
    env: { ...process.env, HOME: home, USERPROFILE: home, ANTHROPIC_API_KEY: 'smoke-test-key', COACH_LLM_BASE_URL: fakeUrl, COACH_EXPORT_DIR: path.join(home, '.coach-exports') },
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
    JSON.stringify({ pid: child.pid, fakePid: fake.pid, home, origin: u.origin, token: u.searchParams.get('t') }),
  );
  child.unref(); // keep it running for the test run; teardown stops it via pid
  fake.unref();
}
