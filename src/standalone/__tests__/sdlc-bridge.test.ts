import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { dispatchServiceMethod } from '../request-service-bridge';
import type { DispatchContext, DispatchResult } from '../dispatcher';
import type { ParseResult } from '../../core/cache';
import type { Session } from '../../core/types/session-types';
import type { Workspace } from '../../core/types/session-types';

// --- temp-dir scratch (bucket-B pattern: real fs, cleaned per test) ---
const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-sdlc-'));
  tmpDirs.push(d);
  return d;
}

// --- fixtures ---
function session(opts: { toolsUsed?: string[]; workspaceId?: string; workspaceName?: string; harness?: string }): Session {
  return {
    sessionId: 's1',
    workspaceId: opts.workspaceId ?? 'ws1',
    workspaceName: opts.workspaceName ?? 'demo',
    harness: opts.harness ?? 'codex',
    creationDate: null,
    lastMessageDate: 1,
    requests: [{ toolsUsed: opts.toolsUsed ?? [] }],
  } as unknown as Session;
}

function makeParseResult(opts: { workspaces?: Workspace[]; sessions?: Session[] }): ParseResult {
  return {
    workspaces: new Map((opts.workspaces ?? []).map(w => [w.id, w])),
    sessions: opts.sessions ?? [],
    editLocIndex: new Map(),
    sessionSourceIndex: new Map(),
  } as unknown as ParseResult;
}

// analyzer is unused by all three local-scan handlers; only parseResult matters.
function ctx(parseResult?: ParseResult): DispatchContext {
  return { parseResult };
}

// narrow the success branch for data access
function data(res: DispatchResult): Record<string, unknown> {
  expect(res.ok).toBe(true);
  return (res as { ok: true; data: Record<string, unknown> }).data;
}

describe('bucket-E SDLC bridge — populated (resolvable, Codex-shaped root)', () => {
  it('getSdlcToolAnalysis counts mcp_ tool prefixes into SDLC-relevant servers', async () => {
    const parseResult = makeParseResult({
      sessions: [session({ toolsUsed: ['mcp_github_create_issue', 'mcp_github_list_prs'] })],
    });
    const res = await dispatchServiceMethod('getSdlcToolAnalysis', {}, ctx(parseResult));
    expect(data(res).mcpServers).toMatchObject([
      { id: 'github', isSdlcRelevant: true, toolCalls: 2 },
    ]);
  });

  it('getWorkspaceDeps reads package.json from a package.json-marked root', async () => {
    const root = tmpDir();
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
      dependencies: { react: '^18.0.0' },
      devDependencies: { vitest: '^4.0.0' },
    }));
    const parseResult = makeParseResult({ workspaces: [{ id: 'ws1', name: 'demo', path: root }] });
    const res = await dispatchServiceMethod('getWorkspaceDeps', {}, ctx(parseResult));
    expect(res).toEqual({
      ok: true,
      data: { deps: [{ workspace: 'demo', dependencies: ['react'], devDependencies: ['vitest'] }] },
    });
  });

  it('getSdlcRepoScan lists .github workflows under a resolvable root', async () => {
    const root = tmpDir();
    fs.writeFileSync(path.join(root, 'package.json'), '{}');
    fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'name: ci');
    const parseResult = makeParseResult({ workspaces: [{ id: 'ws1', name: 'demo', path: root }] });
    const res = await dispatchServiceMethod('getSdlcRepoScan', {}, ctx(parseResult));
    expect(data(res).repos).toMatchObject([
      { workspace: 'demo', remote: null, workflows: ['ci.yml'] },
    ]);
  });
});

describe('bucket-E SDLC bridge — unresolved root (log-dir-shaped, Claude/OpenCode)', () => {
  it('getSdlcRepoScan returns no repos when the root resolves to null', async () => {
    const logDir = tmpDir(); // no package.json / workspace.json / workspace.yaml
    const parseResult = makeParseResult({ workspaces: [{ id: 'ws1', name: 'claude-proj', path: logDir }] });
    const res = await dispatchServiceMethod('getSdlcRepoScan', {}, ctx(parseResult));
    expect(res).toEqual({ ok: true, data: { repos: [] } });
  });

  it('getWorkspaceDeps returns no deps when the root resolves to null', async () => {
    const logDir = tmpDir();
    const parseResult = makeParseResult({ workspaces: [{ id: 'ws1', name: 'claude-proj', path: logDir }] });
    const res = await dispatchServiceMethod('getWorkspaceDeps', {}, ctx(parseResult));
    expect(res).toEqual({ ok: true, data: { deps: [] } });
  });
});

describe('bucket-E SDLC bridge — serve-then-parse (parseResult undefined → empty, never ok:false)', () => {
  it('getSdlcToolAnalysis self-guards to empty', async () => {
    const res = await dispatchServiceMethod('getSdlcToolAnalysis', {}, ctx(undefined));
    expect(res).toEqual({ ok: true, data: { mcpServers: [], toolCounts: {} } });
  });

  it('getWorkspaceDeps self-guards to empty', async () => {
    const res = await dispatchServiceMethod('getWorkspaceDeps', {}, ctx(undefined));
    expect(res).toEqual({ ok: true, data: { deps: [] } });
  });

  it('getSdlcRepoScan self-guards to empty', async () => {
    const res = await dispatchServiceMethod('getSdlcRepoScan', {}, ctx(undefined));
    expect(res).toEqual({ ok: true, data: { repos: [] } });
  });
});
