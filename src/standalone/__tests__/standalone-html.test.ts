import { describe, expect, it } from 'vitest';
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
