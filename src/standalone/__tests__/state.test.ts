import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stateDir, type ServerState } from '../state';

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
