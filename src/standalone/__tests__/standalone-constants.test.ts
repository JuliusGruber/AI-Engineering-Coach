import { describe, expect, it } from 'vitest';
import * as standalone from '../standalone-constants';
import * as core from '../../core/constants';

describe('standalone-constants', () => {
  it('overrides FF_TOKEN_REPORTING_ENABLED to true while core stays false', () => {
    expect(standalone.FF_TOKEN_REPORTING_ENABLED).toBe(true);
    expect(core.FF_TOKEN_REPORTING_ENABLED).toBe(false); // upstream constant untouched
  });

  it('re-exports every other core constant unchanged', () => {
    expect(standalone.CONTEXT_WINDOW_DEFAULT).toBe(core.CONTEXT_WINDOW_DEFAULT);
    expect(standalone.TOKEN_DATA_AVAILABLE_FROM).toBe(core.TOKEN_DATA_AVAILABLE_FROM);
    expect(standalone.FLOW_DEEP_SCORE).toBe(core.FLOW_DEEP_SCORE);
  });
});
