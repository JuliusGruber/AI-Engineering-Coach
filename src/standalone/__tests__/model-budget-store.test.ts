import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readModelBudgets, writeModelBudgets } from '../model-budget-store';
import { stateDir } from '../state';

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
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-budget-'));
  mockOs.homedir.mockReturnValue(tmpHome);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

const budgetsFile = () => path.join(stateDir(), 'model-budgets.json');

describe('read/write round-trip', () => {
  it('returns {} when the file is missing', () => {
    expect(readModelBudgets()).toEqual({});
  });

  it('write then read round-trips the record', () => {
    const budgets = { 'claude-fable-5': 500000, 'gpt-5': 250000 };
    writeModelBudgets(budgets);
    expect(readModelBudgets()).toEqual(budgets);
  });

  it('persists a versioned wrapper on disk', () => {
    writeModelBudgets({ m: 1 });
    const raw = JSON.parse(fs.readFileSync(budgetsFile(), 'utf8'));
    expect(raw).toEqual({ version: 1, budgets: { m: 1 } });
  });

  it('atomic write leaves no .tmp on success', () => {
    writeModelBudgets({ m: 1 });
    expect(fs.existsSync(`${budgetsFile()}.tmp`)).toBe(false);
  });
});

describe('corruption recovery', () => {
  it('quarantines corrupt JSON to .broken-* and returns {}', () => {
    fs.writeFileSync(budgetsFile(), 'not valid json {{{');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(readModelBudgets()).toEqual({});

    const broken = fs
      .readdirSync(stateDir())
      .filter((f) => f.startsWith('model-budgets.json.broken-'));
    expect(broken).toHaveLength(1);
    expect(fs.existsSync(budgetsFile())).toBe(false);
    expect(warn).toHaveBeenCalled();
  });
});

describe('schema version', () => {
  it('warns and returns {} on unknown version, without quarantining', () => {
    fs.writeFileSync(budgetsFile(), JSON.stringify({ version: 99, budgets: { m: 1 } }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(readModelBudgets()).toEqual({});
    expect(warn).toHaveBeenCalled();
    expect(fs.existsSync(budgetsFile())).toBe(true); // not overwritten, not quarantined
  });

  it('returns {} when budgets field is absent or not an object', () => {
    fs.writeFileSync(budgetsFile(), JSON.stringify({ version: 1 }));
    expect(readModelBudgets()).toEqual({});
    fs.writeFileSync(budgetsFile(), JSON.stringify({ version: 1, budgets: [1, 2] }));
    expect(readModelBudgets()).toEqual({});
  });
});

const itPosix = process.platform === 'win32' ? it.skip : it;

describe('file mode', () => {
  itPosix('file mode is 0600 on POSIX', () => {
    writeModelBudgets({ m: 1 });
    const mode = fs.statSync(budgetsFile()).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
