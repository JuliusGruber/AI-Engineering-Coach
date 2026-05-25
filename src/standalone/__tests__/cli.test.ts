import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server', () => ({
  createServer: vi.fn(),
  probeExistingInstance: vi.fn(),
}));
vi.mock('../parse-bootstrap', () => ({
  bootstrapParse: vi.fn(),
}));
vi.mock('open', () => ({ default: vi.fn() }));

import { runCli } from '../cli';

function captureStream(stream: NodeJS.WriteStream): { text: () => string; restore: () => void } {
  let buf = '';
  const spy = vi.spyOn(stream, 'write').mockImplementation((chunk: unknown): boolean => {
    buf += typeof chunk === 'string' ? chunk : String(chunk);
    return true;
  });
  return { text: () => buf, restore: () => spy.mockRestore() };
}

let outCap: ReturnType<typeof captureStream>;
let errCap: ReturnType<typeof captureStream>;

beforeEach(() => {
  vi.clearAllMocks();
  outCap = captureStream(process.stdout);
  errCap = captureStream(process.stderr);
});

afterEach(() => {
  outCap.restore();
  errCap.restore();
});

describe('runCli — flags and early exits', () => {
  it('--version prints the package version and exits 0', async () => {
    const code = await runCli(['node', 'coach', '--version']);
    expect(code).toBe(0);
    expect(outCap.text()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('-v is an alias for --version', async () => {
    const code = await runCli(['node', 'coach', '-v']);
    expect(code).toBe(0);
    expect(outCap.text()).toMatch(/\d+\.\d+\.\d+/);
  });

  it('--help prints usage and exits 0', async () => {
    const code = await runCli(['node', 'coach', '--help']);
    expect(code).toBe(0);
    expect(outCap.text()).toContain('Usage: coach [options]');
  });

  it('an unknown flag prints an error to stderr and exits 2', async () => {
    const code = await runCli(['node', 'coach', '--made-up-flag']);
    expect(code).toBe(2);
    expect(errCap.text()).toContain('unknown flag: --made-up-flag');
    expect(errCap.text()).toContain('coach --help');
  });
});
