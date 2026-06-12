import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import open from 'open';
import { STANDALONE_NATIVE } from '../standalone-native';
import { readModelBudgets } from '../model-budget-store';

vi.mock('open', () => ({ default: vi.fn() }));
const mockedOpen = vi.mocked(open);

const mockOs = vi.hoisted(() => ({
  homedir: vi.fn(),
}));

vi.mock('os', async () => {
  const actual = await vi.importActual('os');
  return {
    ...actual,
    homedir: mockOs.homedir,
  };
});

let tmpHome: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-native-'));
  mockOs.homedir.mockReturnValue(tmpHome);
});

afterEach(() => {
  vi.clearAllMocks();
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe('STANDALONE_NATIVE.openExternal', () => {
  it('rejects a non-http(s) url and does not call open', async () => {
    const res = await STANDALONE_NATIVE.openExternal({ url: 'file:///etc/passwd' });
    expect(res).toEqual({
      ok: false,
      error: { code: 'bad-request', method: 'openExternal', message: 'only http(s) urls allowed' },
    });
    expect(mockedOpen).not.toHaveBeenCalled();
  });

  it('rejects an unparseable url and does not call open', async () => {
    const res = await STANDALONE_NATIVE.openExternal({ url: 'not a url' });
    expect(res).toEqual({
      ok: false,
      error: { code: 'bad-request', method: 'openExternal', message: 'invalid url' },
    });
    expect(mockedOpen).not.toHaveBeenCalled();
  });

  it('rejects a missing url and does not call open', async () => {
    const res = await STANDALONE_NATIVE.openExternal({});
    expect(res).toEqual({
      ok: false,
      error: { code: 'bad-request', method: 'openExternal', message: 'missing url' },
    });
    expect(mockedOpen).not.toHaveBeenCalled();
  });

  it('opens an http(s) url exactly once', async () => {
    const res = await STANDALONE_NATIVE.openExternal({ url: 'https://example.com' });
    expect(res).toEqual({ ok: true, data: { ok: true } });
    expect(mockedOpen).toHaveBeenCalledTimes(1);
    expect(mockedOpen).toHaveBeenCalledWith('https://example.com/');
  });
});

describe('STANDALONE_NATIVE.saveModelBudgets', () => {
  it('rejects a missing budgets object with bad-request', async () => {
    const res = await STANDALONE_NATIVE.saveModelBudgets({});
    expect(res).toEqual({
      ok: false,
      error: { code: 'bad-request', method: 'saveModelBudgets', message: 'missing budgets' },
    });
  });

  it('rejects a non-object budgets value with bad-request', async () => {
    for (const bad of ['x', 42, null, [1, 2]]) {
      const res = await STANDALONE_NATIVE.saveModelBudgets({ budgets: bad });
      expect(res.ok).toBe(false);
    }
  });

  it('drops non-positive and non-numeric entries before persisting', async () => {
    const res = await STANDALONE_NATIVE.saveModelBudgets({
      budgets: { keep: 100, zero: 0, neg: -5, nan: NaN, inf: Infinity, str: 'x', also: 1 },
    });
    expect(res).toEqual({ ok: true, data: { ok: true } });
    expect(readModelBudgets()).toEqual({ keep: 100, also: 1 });
  });

  it('caps the persisted record at 200 keys', async () => {
    const budgets: Record<string, number> = {};
    for (let i = 0; i < 201; i++) budgets[`model-${i}`] = i + 1;
    await STANDALONE_NATIVE.saveModelBudgets({ budgets });
    expect(Object.keys(readModelBudgets())).toHaveLength(200);
  });
});

describe('STANDALONE_NATIVE.loadModelBudgets', () => {
  it('returns {} when nothing was ever saved', async () => {
    const res = await STANDALONE_NATIVE.loadModelBudgets(undefined);
    expect(res).toEqual({ ok: true, data: {} });
  });

  it('save -> load roundtrips through the handlers', async () => {
    await STANDALONE_NATIVE.saveModelBudgets({ budgets: { 'claude-fable-5': 500000 } });
    const res = await STANDALONE_NATIVE.loadModelBudgets({});
    expect(res).toEqual({ ok: true, data: { 'claude-fable-5': 500000 } });
  });
});
