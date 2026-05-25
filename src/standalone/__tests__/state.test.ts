import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearServerState,
  readServerState,
  stateDir,
  writeServerState,
  type ServerState,
} from '../state';

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

function sampleState(): ServerState {
  return {
    version: 1,
    port: 7331,
    token: 'a'.repeat(64),
    pid: 4242,
    startedAt: '2026-05-25T12:00:00.000Z',
  };
}

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-state-'));
  mockOs.homedir.mockReturnValue(tmpHome);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe('stateDir', () => {
  it('creates the state dir on first call', () => {
    const dir = stateDir();
    expect(dir).toBe(path.join(tmpHome, '.ai-engineer-coach'));
    expect(fs.existsSync(dir)).toBe(true);
  });
});

describe('read/write round-trip', () => {
  it('read server state returns null when absent', () => {
    expect(readServerState()).toBeNull();
  });

  it('write then read server state round-trips', () => {
    const state = sampleState();
    writeServerState(state);
    expect(readServerState()).toEqual(state);
  });

  it('atomic write does not leave .tmp on success', () => {
    writeServerState(sampleState());
    const tmp = path.join(stateDir(), 'server-state.json.tmp');
    expect(fs.existsSync(tmp)).toBe(false);
  });
});

describe('corruption recovery', () => {
  it('read recovers from corrupt JSON', () => {
    const file = path.join(stateDir(), 'server-state.json');
    fs.writeFileSync(file, 'not valid json {{{');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(readServerState()).toBeNull();

    const broken = fs
      .readdirSync(stateDir())
      .filter((f) => f.startsWith('server-state.json.broken-'));
    expect(broken).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
  });
});

describe('schema version', () => {
  it('read handles unknown schema version', () => {
    const file = path.join(stateDir(), 'server-state.json');
    fs.writeFileSync(
      file,
      JSON.stringify({ version: 99, port: 1, token: 'x', pid: 1, startedAt: 'x' }),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(readServerState()).toBeNull();
    expect(warn).toHaveBeenCalled();
    expect(fs.existsSync(file)).toBe(true); // not overwritten, not quarantined
  });
});

describe('clearServerState', () => {
  it('clear server state is idempotent', () => {
    writeServerState(sampleState());
    expect(() => {
      clearServerState();
      clearServerState();
    }).not.toThrow();
    expect(readServerState()).toBeNull();
  });
});
