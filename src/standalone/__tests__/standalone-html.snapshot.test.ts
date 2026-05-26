import { describe, expect, it } from 'vitest';
import { renderStandaloneHtml } from '../standalone-html';

// One whole-output snapshot. `renderStandaloneHtml` strips the per-call nonce, so a
// fixed token yields byte-identical output — this pins the entire served document
// (nav entries, CSP, CSS links, script order) against accidental upstream drift that
// the structural assertions in standalone-html.test.ts don't individually cover.
// appVersion is not interpolated into the body (03-standalone-html), so any value works.
describe('renderStandaloneHtml snapshot', () => {
  it('matches the committed standalone HTML snapshot', () => {
    const html = renderStandaloneHtml({ token: 'a'.repeat(64), appVersion: '0.0.0-test' });
    expect(html).toMatchSnapshot();
  });
});
