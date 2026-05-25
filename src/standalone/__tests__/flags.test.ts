import { describe, expect, it } from 'vitest';
import { parseFlags, FlagError } from '../flags';

describe('parseFlags', () => {
  it('returns defaults when no flags are given', () => {
    expect(parseFlags([])).toEqual({
      port: 7331,
      open: true,
      logFile: null,
      rotateToken: false,
      showVersion: false,
      showHelp: false,
    });
  });

  it('parses --port as a number', () => {
    expect(parseFlags(['--port', '8080']).port).toBe(8080);
  });

  it('throws FlagError on a non-numeric --port', () => {
    expect(() => parseFlags(['--port', 'abc'])).toThrow(FlagError);
  });

  it('throws FlagError when --port has no value', () => {
    expect(() => parseFlags(['--port'])).toThrow(FlagError);
  });

  it('sets open=false for --no-open', () => {
    expect(parseFlags(['--no-open']).open).toBe(false);
  });

  it('sets showHelp for both -h and --help', () => {
    expect(parseFlags(['-h']).showHelp).toBe(true);
    expect(parseFlags(['--help']).showHelp).toBe(true);
  });

  it('sets showVersion for both -v and --version', () => {
    expect(parseFlags(['-v']).showVersion).toBe(true);
    expect(parseFlags(['--version']).showVersion).toBe(true);
  });

  it('throws FlagError on an unknown flag', () => {
    expect(() => parseFlags(['--made-up'])).toThrow(FlagError);
  });

  it('throws FlagError when --log-file has no value', () => {
    expect(() => parseFlags(['--log-file'])).toThrow(FlagError);
  });

  it('captures the --log-file path', () => {
    expect(parseFlags(['--log-file', '/tmp/x.log']).logFile).toBe('/tmp/x.log');
  });

  it('treats --rotate-token as a boolean and does not consume the next arg', () => {
    const flags = parseFlags(['--rotate-token', '--no-open']);
    expect(flags.rotateToken).toBe(true);
    expect(flags.open).toBe(false);
  });

  it('rejects a v2 flag with a v1-specific message', () => {
    expect(() => parseFlags(['--host'])).toThrow(/not supported in v1/);
  });
});
