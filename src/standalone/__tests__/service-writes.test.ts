import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type * as vscode from 'vscode';
import { PanelRequestService } from '../../webview/panel-request-service'; // vscode → stub via alias
import type { RequestMessage } from '../../webview/panel-shared';

interface Frame {
  type?: string;
  id?: string;
  data?: Record<string, unknown>;
}

function makeService(): { frames: Frame[]; service: PanelRequestService } {
  const frames: Frame[] = [];
  const webview = { postMessage: (f: Frame): void => { frames.push(f); } };
  // installSkill / installCatalogItem need no analyzer.
  const service = new PanelRequestService(
    webview as unknown as vscode.Webview,
    () => undefined,
    () => undefined,
  );
  return { frames, service };
}

const tmpHomes: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  for (const h of tmpHomes.splice(0)) fs.rmSync(h, { recursive: true, force: true });
});

function tmpHome(): string {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-sw-'));
  tmpHomes.push(h);
  vi.stubEnv('HOME', h);
  vi.stubEnv('USERPROFILE', h);
  return h;
}

describe('installSkill (service write via the stub workspace.fs seam)', () => {
  it('writes ~/.agents/skills/<filename> and responds { ok:true, path }', async () => {
    const home = tmpHome();
    const { frames, service } = makeService();
    const handled = service.tryHandle({ type: 'request', id: 'is1', method: 'installSkill', params: { filename: 'demo.md', content: 'hello-skill' } } as RequestMessage);
    expect(handled).toBe(true);
    await vi.waitFor(() => expect(frames).toHaveLength(1));

    const target = path.join(home, '.agents', 'skills', 'demo.md');
    expect(frames[0]).toMatchObject({ type: 'response', id: 'is1', data: { ok: true, path: target } });
    expect(fs.readFileSync(target, 'utf8')).toBe('hello-skill');
  });

  it('responds with an error frame for a traversal filename (no write)', async () => {
    tmpHome();
    const { frames, service } = makeService();
    service.tryHandle({ type: 'request', id: 'is2', method: 'installSkill', params: { filename: '../evil.md', content: 'x' } } as RequestMessage);
    await vi.waitFor(() => expect(frames).toHaveLength(1));
    expect((frames[0].data as { error?: string }).error).toBe('Invalid filename');
  });
});

describe('installCatalogItem (fetch + service write via the stub seam)', () => {
  it('fetches the canned body and writes ~/.agents/skills/<slug>/<file>, responding { content, filename }', async () => {
    const home = tmpHome();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('# Canned skill\n', { status: 200 })));
    const { frames, service } = makeService();
    service.tryHandle({ type: 'request', id: 'ci1', method: 'installCatalogItem', params: { path: 'skills/demo/demo.md', kind: 'skill', title: 'Demo Skill' } } as RequestMessage);
    await vi.waitFor(() => expect(frames).toHaveLength(1));

    const target = path.join(home, '.agents', 'skills', 'demo-skill', 'demo.md');
    expect(frames[0]).toMatchObject({ type: 'response', id: 'ci1', data: { content: '# Canned skill\n', filename: 'demo-skill/demo.md' } });
    expect(fs.readFileSync(target, 'utf8')).toBe('# Canned skill\n');
  });

  it('responds with an error frame for a traversal catalog path (no fetch, no write)', async () => {
    tmpHome();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { frames, service } = makeService();
    service.tryHandle({ type: 'request', id: 'ci2', method: 'installCatalogItem', params: { path: '../etc/passwd', kind: 'skill', title: 'x' } } as RequestMessage);
    await vi.waitFor(() => expect(frames).toHaveLength(1));
    expect((frames[0].data as { error?: string }).error).toBe('Invalid catalog path');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
