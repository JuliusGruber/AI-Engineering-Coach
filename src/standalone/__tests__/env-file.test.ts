import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseEnvFile, loadEnvFile } from '../env-file';

describe('parseEnvFile', () => {
  it('parses simple KEY=VALUE lines', () => {
    expect(parseEnvFile('A=1\nB=2')).toEqual({ A: '1', B: '2' });
  });

  it('ignores blank lines and # comment lines', () => {
    expect(parseEnvFile('\n# a comment\nA=1\n   # indented comment\n\nB=2\n')).toEqual({ A: '1', B: '2' });
  });

  it('trims whitespace around the key and the value', () => {
    expect(parseEnvFile('  A = 1 ')).toEqual({ A: '1' });
  });

  it('strips matching surrounding double or single quotes', () => {
    expect(parseEnvFile('A="x y"\nB=\'z w\'')).toEqual({ A: 'x y', B: 'z w' });
  });

  it('splits on the first = only, preserving = in the value', () => {
    expect(parseEnvFile('URL=http://a?b=c')).toEqual({ URL: 'http://a?b=c' });
  });

  it('tolerates CRLF line endings without leaving a trailing carriage return', () => {
    expect(parseEnvFile('A=1\r\nB=2\r\n')).toEqual({ A: '1', B: '2' });
  });

  it('ignores lines with no = and lines with an empty key', () => {
    expect(parseEnvFile('justtext\n=novalue\nA=1')).toEqual({ A: '1' });
  });
});

describe('loadEnvFile', () => {
  let dir: string;
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeEnv(contents: string): string {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-env-'));
    const file = path.join(dir, '.env');
    fs.writeFileSync(file, contents);
    return file;
  }

  it('applies parsed entries to the given env object and returns the names set', () => {
    const env = {} as NodeJS.ProcessEnv;
    const names = loadEnvFile(writeEnv('ANTHROPIC_API_KEY=sk-test\nFOO=bar'), env);
    expect(env.ANTHROPIC_API_KEY).toBe('sk-test');
    expect(env.FOO).toBe('bar');
    expect(names).toEqual(['ANTHROPIC_API_KEY', 'FOO']);
  });

  it('does not override a variable already present in the env (real env wins)', () => {
    const env = { ANTHROPIC_API_KEY: 'real' } as NodeJS.ProcessEnv;
    const names = loadEnvFile(writeEnv('ANTHROPIC_API_KEY=from-file\nNEW=added'), env);
    expect(env.ANTHROPIC_API_KEY).toBe('real');
    expect(env.NEW).toBe('added');
    expect(names).toEqual(['NEW']);
  });

  it('returns an empty array and does not throw when the file is missing', () => {
    const missing = path.join(os.tmpdir(), 'coach-no-such-env-xyz', '.env');
    const env = {} as NodeJS.ProcessEnv;
    expect(loadEnvFile(missing, env)).toEqual([]);
    expect(env).toEqual({});
  });
});
