import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from '../vscode-stub';
import { callLlmJson, SCHEMA_CONTEXT_REVIEW } from '../../webview/panel-llm';

const LLM_ENV_KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'COACH_LLM_MODEL', 'COACH_LLM_BASE_URL', 'COACH_LLM_MAX_TOKENS', 'COACH_LLM_TIMEOUT_MS'];
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(LLM_ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of LLM_ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of LLM_ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.unstubAllGlobals();
});

describe('LanguageModelChatMessage', () => {
  it('User and Assistant produce role-tagged messages whose content is a LanguageModelTextPart array', () => {
    // VS Code semantics (relied on by panel-llm.ts redactMessages, upstream d00f84b): content is an
    // array of parts, each a LanguageModelTextPart — NOT a bare string.
    expect(vscode.LanguageModelChatMessage.User('hi')).toEqual({ role: 'user', content: [{ value: 'hi' }] });
    expect(vscode.LanguageModelChatMessage.Assistant('ok')).toEqual({ role: 'assistant', content: [{ value: 'ok' }] });
  });

  it('content parts are real LanguageModelTextPart instances so `part instanceof vscode.LanguageModelTextPart` holds (regression: redactMessages)', () => {
    const [part] = vscode.LanguageModelChatMessage.User('hi').content;
    expect(part).toBeInstanceOf(vscode.LanguageModelTextPart);
    expect(part.value).toBe('hi');
  });
});

describe('lm.selectChatModels', () => {
  it('returns [] when no provider key is configured', async () => {
    expect(await vscode.lm.selectChatModels({})).toEqual([]);
  });

  it('returns one model when a key is configured', async () => {
    process.env.ANTHROPIC_API_KEY = 'k';
    expect(await vscode.lm.selectChatModels({})).toHaveLength(1);
  });

  it('IGNORES the family selector — returns the Anthropic model for family:gpt-4.1 (selector-ignored regression)', async () => {
    process.env.ANTHROPIC_API_KEY = 'k'; // no OPENAI key
    const models = await vscode.lm.selectChatModels({ family: 'gpt-4.1' });
    expect(models).toHaveLength(1); // would be [] if the family selector were honored
  });
});

describe('model.sendRequest', () => {
  it('streams the provider text as a single chunk WITH NO token argument (rule-compiler form)', async () => {
    process.env.ANTHROPIC_API_KEY = 'k';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ content: [{ text: 'done' }] }), { status: 200 })));
    const [model] = await vscode.lm.selectChatModels({});
    const res = model.sendRequest([vscode.LanguageModelChatMessage.User('hi')], {}); // no token
    let text = '';
    for await (const chunk of res.text) text += chunk;
    expect(text).toBe('done');
  });

  it('aborts the in-flight fetch when the cancellation token fires', async () => {
    process.env.ANTHROPIC_API_KEY = 'k';
    // fetch that only settles on abort.
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }),
    ));
    const cts = new vscode.CancellationTokenSource();
    const [model] = await vscode.lm.selectChatModels({});
    const res = model.sendRequest([vscode.LanguageModelChatMessage.User('hi')], {}, cts.token);
    const iterate = (async () => { for await (const _ of res.text) { /* drain */ } })();
    cts.cancel();
    await expect(iterate).rejects.toThrow(/abort/i);
  });
});

describe('callLlmJson OpenAI strict-mode self-heal through the stub lm (grilling decision 7)', () => {
  // Moved here from llm-provider.test.ts: it imports the real panel-llm, whose `vscode` resolves
  // to THIS stub via the vitest alias — so it only passes once `lm` exists (this task).
  it('drops modelOptions and retries in plain mode after a response_format 400', async () => {
    process.env.OPENAI_API_KEY = 'tok';
    const valid = JSON.stringify({ items: [] });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('Invalid schema for response_format: additionalProperties required', { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: valid } }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callLlmJson<{ items: unknown[] }>(
      // A proper chat message (parts-array content) so redactMessages() can .map() it; a raw
      // { content: 'review' } string would throw now that panel-llm redacts each text part.
      [vscode.LanguageModelChatMessage.User('review')] as never,
      SCHEMA_CONTEXT_REVIEW,
    );
    expect(result).toEqual({ items: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).response_format).toBeDefined();
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string).response_format).toBeUndefined();
  });
});

describe('write seam — Uri', () => {
  it('Uri.file normalizes fsPath to native separators and keeps path forward-slash (real VS Code parity)', () => {
    const input = '/home/u/.agents/skills/x.md';
    expect(vscode.Uri.file(input)).toEqual({
      fsPath: path.normalize(input), // native: backslashes on Windows, unchanged on POSIX
      path: input, // forward-slash form (input has no backslashes → unchanged)
    });
  });

  it('Uri.file converts a mixed-separator input (Windows HOME + forward-slash tail) to a native fsPath', () => {
    // installSkill builds `${homeDir}/.agents/skills/x.md`; on Windows homeDir carries backslashes.
    const mixed = 'C:\\Users\\u/.agents/skills/x.md';
    expect(vscode.Uri.file(mixed)).toEqual({
      fsPath: path.normalize(mixed),
      path: 'C:/Users/u/.agents/skills/x.md',
    });
  });

  it('Uri.joinPath honors a base carrying fsPath', () => {
    expect(vscode.Uri.joinPath({ fsPath: '/base' }, 'a', 'b.md')).toEqual({
      path: '/base/a/b.md',
      fsPath: '/base/a/b.md',
    });
  });

  it('Uri.joinPath honors a base carrying only path', () => {
    expect(vscode.Uri.joinPath({ path: '/p' }, 'c.md')).toEqual({
      path: '/p/c.md',
      fsPath: '/p/c.md',
    });
  });

  it('Uri.joinPath with an empty {} base still equals the joined parts (getDashboardHtml no-op regression guard)', () => {
    // panel-html.ts:11 calls joinPath(extensionUri, 'dist','webview','app.js') with extensionUri = {}.
    // The base-fix must drop the empty base so the result is byte-identical to the old impl.
    expect(vscode.Uri.joinPath({}, 'dist', 'webview', 'app.js')).toEqual({
      path: 'dist/webview/app.js',
      fsPath: 'dist/webview/app.js',
    });
  });
});

describe('write seam — workspace', () => {
  it('workspace.workspaceFolders is undefined (single-folder degrade)', () => {
    expect(vscode.workspace.workspaceFolders).toBeUndefined();
  });

  it('workspace.fs.writeFile creates parent dirs (mkdir-p) and writes the bytes to uri.fsPath', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-stub-'));
    try {
      const target = path.join(tmp, 'nested', 'deep', 'file.txt');
      await vscode.workspace.fs.writeFile(vscode.Uri.file(target), Buffer.from('hello', 'utf8'));
      expect(fs.existsSync(target)).toBe(true);
      expect(fs.readFileSync(target, 'utf8')).toBe('hello');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('workspace.fs.createDirectory creates the dir and all missing parents (mkdir-p), and is idempotent on an existing dir', async () => {
    // installSkill/installCatalogItem call createDirectory(dirname(target)) before writeFile
    // (panel-request-service.ts:626/665, upstream af35d49). Missing parents must be created,
    // and a re-install into an existing dir must NOT throw (recursive: true).
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-stub-'));
    try {
      const target = path.join(tmp, 'nested', 'deep', 'dir');
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(target));
      expect(fs.statSync(target).isDirectory()).toBe(true);
      // Second call on the now-existing dir resolves instead of throwing EEXIST.
      await expect(vscode.workspace.fs.createDirectory(vscode.Uri.file(target))).resolves.toBeUndefined();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('write seam — window + env', () => {
  it('showOpenDialog returns COACH_EXPORT_DIR when set', async () => {
    const saved = process.env.COACH_EXPORT_DIR;
    process.env.COACH_EXPORT_DIR = '/tmp/exports';
    try {
      const folders = await vscode.window.showOpenDialog({ canSelectFolders: true });
      expect(folders).toEqual([{ fsPath: '/tmp/exports', path: '/tmp/exports' }]);
    } finally {
      if (saved === undefined) delete process.env.COACH_EXPORT_DIR;
      else process.env.COACH_EXPORT_DIR = saved;
    }
  });

  it('showOpenDialog falls back to ~/.ai-engineer-coach/exports when COACH_EXPORT_DIR is unset', async () => {
    const saved = process.env.COACH_EXPORT_DIR;
    delete process.env.COACH_EXPORT_DIR;
    try {
      const expected = path.join(os.homedir(), '.ai-engineer-coach', 'exports');
      const folders = await vscode.window.showOpenDialog({ canSelectFolders: true });
      expect(folders).toEqual([{ fsPath: expected, path: expected }]);
    } finally {
      if (saved !== undefined) process.env.COACH_EXPORT_DIR = saved;
    }
  });

  it('showInformationMessage resolves undefined (no button → never opens the folder)', async () => {
    expect(await vscode.window.showInformationMessage('done', 'Open Folder')).toBeUndefined();
  });

  it('env.openExternal resolves true (provided for safety; never reached in export flow)', async () => {
    expect(await vscode.env.openExternal({ fsPath: '/x', path: '/x' })).toBe(true);
  });
});
