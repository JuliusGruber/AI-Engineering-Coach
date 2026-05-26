import { execFileSync } from 'node:child_process';
import * as os from 'node:os';
import { describe, expect, it } from 'vitest';
import { CLI } from './helpers';

describe('cli bundle', () => {
  it('require()s in a bare node process without vscode (07-build AC 2a)', () => {
    // require.main !== module here, so the footer does NOT run runCli — this isolates
    // "the bundle LOADS", proving the esbuild vscode alias neutralized the transitive
    // top-level `import * as vscode`. cwd=tmpdir so no stray node_modules/vscode resolves.
    const out = execFileSync(
      process.execPath,
      ['-e', `require(${JSON.stringify(CLI)}); process.stdout.write('loaded');`],
      { encoding: 'utf8', cwd: os.tmpdir() },
    );
    expect(out).toContain('loaded');
  });
});
