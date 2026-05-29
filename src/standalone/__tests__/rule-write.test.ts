import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getRpcHandler } from '../../webview/panel-rpc'; // pulls vscode → stub via the vitest alias

// A rule markdown that parseRule + createRuleFromMarkdown accept (mirrors the fake-llm fixture).
const VALID_RULE_MD = [
  '---',
  'id: flag-short-prompts',
  'name: flag short prompts',
  'group: prompt-quality',
  'severity: medium',
  'scope: requests',
  'version: 1',
  'tags: [custom]',
  'thresholds:',
  '  maxLength: 30',
  '  maxRatio: 0.3',
  '  minSample: 5',
  '---',
  '',
  '# Description',
  'flag short prompts',
  '',
  '# Filter',
  'messageLength < {{thresholds.maxLength}} AND messageLength > 0',
  '',
  '# Trigger',
  'ratio > {{thresholds.maxRatio}} AND count > {{thresholds.minSample}}',
  '',
  '# When Triggered',
  '{{count}} of {{total}} items ({{pct}}) match this pattern.',
  '',
  '# How to Improve',
  'Review the flagged items and adjust your workflow accordingly.',
  '',
  '# Examples',
  '"{{messageText | truncate:80}}"',
  '',
  '# Test Cases',
  '- input: { "messageLength": 10 }',
  '  expect: flagged',
  '- input: { "messageLength": 200 }',
  '  expect: clean',
].join('\n');

// Minimal analyzer for getRuleEditor / getRulePreview / testRuleLive (they only call
// filterRequests / filterSessions, which return arrays the rule engine runs over).
const fakeAnalyzer = {
  filterRequests: () => [],
  filterSessions: () => [],
} as never;
const fakeParse = {} as never;

const tmpHomes: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const h of tmpHomes.splice(0)) fs.rmSync(h, { recursive: true, force: true });
});

function tmpHome(): string {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-rw-'));
  tmpHomes.push(h);
  // os.homedir() honors $HOME on POSIX (CI is Linux); getPersonalRulesDir() resolves under it.
  vi.stubEnv('HOME', h);
  vi.stubEnv('USERPROFILE', h);
  return h;
}

describe('saveRule (registry write via Node fs)', () => {
  it('writes a parsed rule under ~/.ai-engineer-coach/rules/ and returns { ok:true, filePath }', async () => {
    const home = tmpHome();
    const handler = getRpcHandler('saveRule');
    expect(handler).toBeTypeOf('function');
    const result = (await handler!(undefined as never, undefined as never, { markdown: VALID_RULE_MD })) as {
      ok: boolean;
      filePath: string;
    };
    expect(result.ok).toBe(true);
    expect(result.filePath).toBe(path.join(home, '.ai-engineer-coach', 'rules', 'flag-short-prompts.md'));
    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(fs.readFileSync(result.filePath, 'utf8')).toBe(VALID_RULE_MD);
  });

  it('does not throw on the trust step when no default trust store is set (standalone)', async () => {
    tmpHome();
    const handler = getRpcHandler('saveRule');
    // getDefaultTrustStore() is undefined in standalone → approveTrust is skipped, no throw.
    await expect(handler!(undefined as never, undefined as never, { markdown: VALID_RULE_MD })).resolves.toMatchObject({ ok: true });
  });

  it('returns { ok:false } for empty markdown (no write)', async () => {
    tmpHome();
    const handler = getRpcHandler('saveRule');
    const result = (await handler!(undefined as never, undefined as never, { markdown: '   ' })) as { ok: boolean };
    expect(result.ok).toBe(false);
  });
});

describe('getRuleEditor (registry, degrades with no workspace)', () => {
  it('returns layers + rules + empty pending without throwing (workspaceRoot → undefined)', async () => {
    const handler = getRpcHandler('getRuleEditor');
    const result = (await handler!(fakeAnalyzer, fakeParse, {})) as {
      rules: unknown[];
      layers: unknown;
      pending: unknown[];
    };
    expect(Array.isArray(result.rules)).toBe(true);
    expect(result.layers).toBeDefined();
    expect(result.pending).toEqual([]); // no trust store → getPending() empty
  });
});

describe('getRulePreview / updateRuleThreshold / testRuleLive (registry smoke)', () => {
  it('getRulePreview returns the not-found shape for an unknown ruleId', async () => {
    const handler = getRpcHandler('getRulePreview');
    const result = (await handler!(fakeAnalyzer, fakeParse, { ruleId: 'does-not-exist' })) as {
      previewDescription: string;
      previewExamples: unknown[];
    };
    expect(result.previewDescription).toBe('Rule not found.');
    expect(result.previewExamples).toEqual([]);
  });

  it('updateRuleThreshold returns { ok:false } for an unknown ruleId (no throw)', async () => {
    const handler = getRpcHandler('updateRuleThreshold');
    const result = (await handler!(undefined as never, undefined as never, { ruleId: 'does-not-exist', key: 'maxLength', value: 1 })) as { ok: boolean };
    expect(result.ok).toBe(false);
  });

  it('testRuleLive returns the no-markdown error shape (no throw)', async () => {
    const handler = getRpcHandler('testRuleLive');
    const result = (await handler!(fakeAnalyzer, fakeParse, { markdown: '' })) as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toBe('No rule markdown provided');
  });
});
