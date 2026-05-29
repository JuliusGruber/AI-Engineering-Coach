import { describe, expect, it } from 'vitest';
import { V1_ALLOWED } from '../v1-allowed';

describe('V1_ALLOWED', () => {
  it('contains exactly the documented 52', () => {
    expect(V1_ALLOWED.size).toBe(52);
  });

  it('is frozen / readonly', () => {
    expect(() => {
      (V1_ALLOWED as Set<string>).add('totallyNew');
    }).toThrow();
    expect(V1_ALLOWED.size).toBe(52);
  });

  it('includes representative read-only methods and the now-exposed write/editor methods', () => {
    expect(V1_ALLOWED.has('getSessions')).toBe(true);
    expect(V1_ALLOWED.has('getStats')).toBe(true);
    expect(V1_ALLOWED.has('getRegistryCatalog')).toBe(true);
    expect(V1_ALLOWED.has('saveRule')).toBe(true);        // bucket B: writes via Node fs
    expect(V1_ALLOWED.has('getRuleEditor')).toBe(true);   // bucket B: graceful require('vscode') fallback
  });

  it('includes the bucket-B rule/import methods', () => {
    for (const m of [
      'getRuleEditor', 'getRuleSource', 'getRulePreview',
      'saveRule', 'updateRuleThreshold', 'testRuleLive', 'importRegistryRules',
    ]) {
      expect(V1_ALLOWED.has(m)).toBe(true);
    }
  });

  it('includes the bucket-A additions reachable by an exposed page', () => {
    expect(V1_ALLOWED.has('getDataExplorer')).toBe(true); // page-data-explorer.ts:133
    expect(V1_ALLOWED.has('evaluateExpression')).toBe(true); // page-rule-playground.ts (Run)
  });

  it('includes the bucket-D NL-rule registry methods (now LLM-backed via the stub)', () => {
    expect(V1_ALLOWED.has('explainOccurrence')).toBe(true); // panel-rpc.ts:895
    expect(V1_ALLOWED.has('generateRule')).toBe(true); // panel-rpc.ts:996 (template fallback)
    expect(V1_ALLOWED.has('compileNlRule')).toBe(true); // panel-rpc.ts:1134 (heuristic fallback offline)
  });

  it('does NOT add the deferred rule-write methods (no exposed page calls them)', () => {
    expect(V1_ALLOWED.has('calibrateRule')).toBe(false);
    expect(V1_ALLOWED.has('runRuleTests')).toBe(false);
  });
});
