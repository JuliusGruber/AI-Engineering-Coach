import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bootCli, makeTmpHome, stopCli, wsConnect, wsRequest, wsWaitFor, type Booted } from './helpers';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

function track(b: Booted, home: string): Booted {
  cleanups.push(async () => { await stopCli(b); fs.rmSync(home, { recursive: true, force: true }); });
  return b;
}

describe('cli write path (bucket B)', () => {
  it('installSkill writes the file under the sandbox HOME and returns { ok:true, path }', async () => {
    const home = makeTmpHome();
    const b = track(await bootCli(home, ['--port', '7370']), home);
    const ws = await wsConnect(b);
    await wsWaitFor(ws, 'dataReady');

    const res = await wsRequest(ws, 'installSkill', { filename: 'smoke.md', content: '# Smoke skill' }, 'is1');
    ws.close();

    const data = res.data as { ok?: boolean; path?: string; code?: string };
    expect(data.code).not.toBe('standalone-v1-disabled'); // was disabled before bucket B
    expect(data.ok).toBe(true);
    const written = path.join(home, '.agents', 'skills', 'smoke.md');
    expect(fs.existsSync(written)).toBe(true);
    expect(fs.readFileSync(written, 'utf8')).toBe('# Smoke skill');
  });

  it('exportSummary writes summary-*.md and summary-*.json into COACH_EXPORT_DIR', async () => {
    const home = makeTmpHome();
    const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-exp-'));
    cleanups.push(() => fs.rmSync(exportDir, { recursive: true, force: true }));
    const b = track(await bootCli(home, ['--port', '7371'], 20_000, { COACH_EXPORT_DIR: exportDir }), home);
    const ws = await wsConnect(b);
    await wsWaitFor(ws, 'dataReady'); // analyzer present after this frame

    const res = await wsRequest(ws, 'exportSummary', {}, 'es1');
    ws.close();

    const data = res.data as { ok?: boolean; folder?: string; markdownPath?: string; jsonPath?: string; code?: string };
    expect(data.code).not.toBe('standalone-v1-disabled');
    expect(data.ok).toBe(true);
    expect(data.folder).toBe(exportDir);
    expect(typeof data.markdownPath).toBe('string');
    expect(typeof data.jsonPath).toBe('string');
    expect(fs.existsSync(data.markdownPath!)).toBe(true);
    expect(fs.existsSync(data.jsonPath!)).toBe(true);
    expect(path.dirname(data.markdownPath!)).toBe(exportDir); // wrote nowhere real
  });
});
