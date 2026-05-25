import { describe, expect, it } from 'vitest';
import { V1_ALLOWED } from '../v1-allowed';

describe('V1_ALLOWED', () => {
  it('contains exactly the documented 40', () => {
    expect(V1_ALLOWED.size).toBe(40);
  });

  it('is frozen / readonly', () => {
    // Cast back to a mutable shape at compile time to attempt a write; the
    // runtime Set must reject mutation (frozen) so the size is unchanged.
    expect(() => {
      (V1_ALLOWED as Set<string>).add('saveRule');
    }).toThrow();
    expect(V1_ALLOWED.size).toBe(40);
  });

  it('includes representative read-only methods and excludes write methods', () => {
    expect(V1_ALLOWED.has('getSessions')).toBe(true);
    expect(V1_ALLOWED.has('getStats')).toBe(true);
    expect(V1_ALLOWED.has('getRegistryCatalog')).toBe(true);
    expect(V1_ALLOWED.has('saveRule')).toBe(false);
    expect(V1_ALLOWED.has('getRuleEditor')).toBe(false); // deliberately excluded
  });
});
