import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('../server', () => ({
  createServer: vi.fn(),
  probeExistingInstance: vi.fn(),
}));
vi.mock('../parse-bootstrap', () => ({
  bootstrapParse: vi.fn(),
}));
vi.mock('open', () => ({ default: vi.fn() }));

import { runCli, attachLogFile } from '../cli';
import { createServer, probeExistingInstance, type ServerHandle } from '../server';
import { bootstrapParse } from '../parse-bootstrap';
import open from 'open';

const mockedCreateServer = vi.mocked(createServer);
const mockedProbe = vi.mocked(probeExistingInstance);
const mockedBootstrap = vi.mocked(bootstrapParse);
const mockedOpen = vi.mocked(open);

const TOKEN = 'a'.repeat(64);

function fakeHandle(): ServerHandle {
  return {
    url: `http://127.0.0.1:7331/?t=${TOKEN}`,
    port: 7331,
    token: TOKEN,
    setData: vi.fn(),
    broadcast: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

// Retrieve a process signal handler that runCli registered, so the test can trigger
// shutdown deterministically without delivering a real OS signal to the test runner.
function triggerSignal(onSpy: ReturnType<typeof vi.spyOn>, signal: 'SIGINT' | 'SIGTERM'): void {
  const call = onSpy.mock.calls.find((c: unknown[]) => c[0] === signal);
  if (!call) throw new Error(`runCli did not register a ${signal} handler`);
  (call[1] as () => void)();
}

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

describe('runCli — boot', () => {
  it('reuses a live instance: prints, opens, exits 0 without starting a server', async () => {
    const existingUrl = `http://127.0.0.1:7331/?t=${'b'.repeat(64)}`;
    mockedProbe.mockResolvedValue(existingUrl);

    const code = await runCli(['node', 'coach']);

    expect(code).toBe(0);
    expect(errCap.text()).toContain('coach already running at');
    expect(mockedOpen).toHaveBeenCalledWith(existingUrl);
    expect(mockedCreateServer).not.toHaveBeenCalled();
  });

  it('fresh boot serves first, prints URL, opens, parses, calls setData once; SIGINT -> 130', async () => {
    mockedProbe.mockResolvedValue(null);
    const handle = fakeHandle();
    mockedCreateServer.mockResolvedValue(handle);
    mockedBootstrap.mockResolvedValue({ analyzer: {} as never, parseResult: {} as never });
    const onSpy = vi.spyOn(process, 'on');

    const p = runCli(['node', 'coach']);
    await vi.waitFor(() => expect(handle.setData).toHaveBeenCalledOnce());

    expect(mockedCreateServer).toHaveBeenCalledWith({ port: 7331, token: undefined, logFile: undefined });
    expect(errCap.text()).toContain(`coach running at ${handle.url}`);
    expect(mockedOpen).toHaveBeenCalledWith(handle.url);
    expect(mockedBootstrap).toHaveBeenCalledWith(expect.any(Function));

    // Serve-then-parse (acceptance 4a): createServer was called before bootstrapParse.
    expect(mockedCreateServer.mock.invocationCallOrder[0]).toBeLessThan(
      mockedBootstrap.mock.invocationCallOrder[0],
    );

    // Progress forwarding: the callback handed to bootstrapParse broadcasts a progress frame.
    const forward = mockedBootstrap.mock.calls[0][0] as unknown as (p: Record<string, unknown>) => void;
    forward({ phase: 2, pct: 40 });
    expect(handle.broadcast).toHaveBeenCalledWith({ type: 'progress', phase: 2, pct: 40 });

    triggerSignal(onSpy, 'SIGINT');
    expect(await p).toBe(130);
    expect(handle.close).toHaveBeenCalledOnce();
  });

  it('--no-open does not call open', async () => {
    mockedProbe.mockResolvedValue(null);
    const handle = fakeHandle();
    mockedCreateServer.mockResolvedValue(handle);
    mockedBootstrap.mockResolvedValue({ analyzer: {} as never, parseResult: {} as never });
    const onSpy = vi.spyOn(process, 'on');

    const p = runCli(['node', 'coach', '--no-open']);
    await vi.waitFor(() => expect(handle.setData).toHaveBeenCalledOnce());

    expect(mockedOpen).not.toHaveBeenCalled();

    triggerSignal(onSpy, 'SIGINT');
    await p;
  });

  it('--rotate-token passes a fresh 64-hex token to createServer', async () => {
    mockedProbe.mockResolvedValue(null);
    const handle = fakeHandle();
    mockedCreateServer.mockResolvedValue(handle);
    mockedBootstrap.mockResolvedValue({ analyzer: {} as never, parseResult: {} as never });
    const onSpy = vi.spyOn(process, 'on');

    const p = runCli(['node', 'coach', '--rotate-token', '--no-open']);
    await vi.waitFor(() => expect(handle.setData).toHaveBeenCalledOnce());

    const opts = mockedCreateServer.mock.calls[0][0];
    expect(opts.token).toMatch(/^[0-9a-f]{64}$/);

    triggerSignal(onSpy, 'SIGINT');
    await p;
  });

  it('propagates a fatal createServer error (bin/coach maps it to exit 1)', async () => {
    mockedProbe.mockResolvedValue(null);
    mockedCreateServer.mockRejectedValue(new Error('no free port in 7331..7340'));

    await expect(runCli(['node', 'coach', '--no-open'])).rejects.toThrow('no free port');
  });
});

describe('attachLogFile', () => {
  it('tees subsequent stderr writes into the log file', () => {
    errCap.restore(); // drop the global stderr spy so we tee the real stream
    const realWrite = process.stderr.write;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-log-'));
    const logPath = path.join(dir, 'coach.log');

    try {
      attachLogFile(logPath);
      process.stderr.write('hello-log\n');
      process.stderr.write = realWrite; // detach the tee before asserting

      expect(fs.readFileSync(logPath, 'utf8')).toContain('hello-log');
    } finally {
      process.stderr.write = realWrite;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not throw when the log path is unwritable', () => {
    errCap.restore();
    const realWrite = process.stderr.write;
    const badPath = path.join(os.tmpdir(), 'coach-no-such-dir-xyz', 'a.log');

    try {
      expect(() => attachLogFile(badPath)).not.toThrow();
      expect(process.stderr.write).toBe(realWrite); // left the stream untouched
    } finally {
      process.stderr.write = realWrite;
    }
  });
});
