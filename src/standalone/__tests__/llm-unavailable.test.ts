import { describe, expect, it } from 'vitest';
import { rewriteLlmUnavailable, rewriteLlmUnavailableInData, LLM_UNAVAILABLE_HINT } from '../llm-unavailable';

const UPSTREAM = 'No language model available. Make sure GitHub Copilot is installed and signed in.';

describe('rewriteLlmUnavailable (DispatchResult error.message — bridge / thrown handler)', () => {
  it('rewrites a handler-error whose message carries the upstream marker', () => {
    expect(rewriteLlmUnavailable({ ok: false, error: { code: 'handler-error', method: 'm', message: UPSTREAM } }))
      .toEqual({ ok: false, error: { code: 'handler-error', method: 'm', message: LLM_UNAVAILABLE_HINT } });
  });
  it('passes a non-marker error through unchanged (e.g. discoverCatalog needs no LLM)', () => {
    const r = { ok: false, error: { code: 'handler-error', method: 'discoverCatalog', message: 'some other failure' } } as const;
    expect(rewriteLlmUnavailable(r)).toEqual(r);
  });
  it('passes ok results through unchanged', () => {
    const r = { ok: true, data: { items: [] } } as const;
    expect(rewriteLlmUnavailable(r)).toBe(r);
  });
});

describe('rewriteLlmUnavailableInData (registry data.error — explainOccurrence catches its own throw)', () => {
  it('rewrites a string data.error carrying the upstream marker', () => {
    expect(rewriteLlmUnavailableInData({ ok: false, explanation: '', error: UPSTREAM }))
      .toEqual({ ok: false, explanation: '', error: LLM_UNAVAILABLE_HINT });
  });
  it('passes data without the marker through unchanged (incl. non-error data and null)', () => {
    expect(rewriteLlmUnavailableInData({ ok: false, error: 'Session not found' }))
      .toEqual({ ok: false, error: 'Session not found' });
    expect(rewriteLlmUnavailableInData({ rules: [] })).toEqual({ rules: [] });
    expect(rewriteLlmUnavailableInData(null)).toBeNull();
  });
});
