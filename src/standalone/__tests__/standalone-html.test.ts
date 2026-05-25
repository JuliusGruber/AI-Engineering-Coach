import { afterEach, describe, expect, it, vi } from 'vitest';
import * as panelHtml from '../../webview/panel-html';
import { renderStandaloneHtml } from '../standalone-html';

const TOKEN = 'a'.repeat(64); // 64 hex chars

describe('renderStandaloneHtml — token validation', () => {
  it('throws on a non-hex / wrong-length token', () => {
    expect(() => renderStandaloneHtml({ token: 'bad', appVersion: '0.1.0' })).toThrow(
      /64-char hex/,
    );
    expect(() => renderStandaloneHtml({ token: 'A'.repeat(64), appVersion: '0.1.0' })).toThrow(
      /64-char hex/,
    ); // uppercase is not [0-9a-f]
  });
});

describe('renderStandaloneHtml — preserves the upstream body', () => {
  const html = renderStandaloneHtml({ token: TOKEN, appVersion: '0.1.0' });

  it('starts with the doctype', () => {
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
  });

  it('keeps the real DOM app.js targets', () => {
    expect(html).toContain('<main id="content">');
    expect(html).toContain('<nav id="sidebar">');
    expect(html).toContain('id="ws-filter"');
    expect(html).toContain('id="harness-filter"');
  });

  it('links the upstream styles.css via the stub asWebviewUri', () => {
    expect(html).toContain('href="/dist/webview/styles.css"');
  });

  it('omits the burndown nav while FF_TOKEN_REPORTING_ENABLED is false', () => {
    expect(html).not.toContain('data-page="burndown"');
  });
});

afterEach(() => {
  vi.restoreAllMocks(); // restores the getDashboardHtml spy used by drift-guard tests
});

describe('renderStandaloneHtml — Transform 1: CSP + coach-token meta', () => {
  const html = renderStandaloneHtml({ token: TOKEN, appVersion: '0.1.0' });

  it('swaps in the standalone CSP and drops the VS Code CSP', () => {
    expect(html).toContain(
      "default-src 'self'; style-src 'self' 'unsafe-inline'; " +
        "script-src 'self'; img-src 'self' data:; font-src 'self'",
    );
    expect(html).not.toContain("default-src 'none'");
    expect(html).not.toContain('require-trusted-types-for');
    expect(html).not.toContain('nonce-'); // the CSP's 'nonce-<n>' source is gone
  });

  it('emits the coach-token meta tag with the token', () => {
    expect(html).toContain(`<meta name="coach-token" content="${TOKEN}">`);
  });

  it('throws if the CSP-meta anchor is missing (drift guard)', () => {
    // Feed a getDashboardHtml output with no Content-Security-Policy meta.
    vi.spyOn(panelHtml, 'getDashboardHtml').mockReturnValue(
      '<!DOCTYPE html><html><head><title>x</title></head><body></body></html>',
    );
    expect(() => renderStandaloneHtml({ token: TOKEN, appVersion: '0.1.0' })).toThrow(
      /expected exactly one CSP meta tag, found 0/,
    );
  });
});
