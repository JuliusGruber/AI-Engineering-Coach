// src/standalone/standalone-html.ts
// Wraps the unmodified upstream getDashboardHtml (panel-html.ts) for a plain
// browser: swaps the VS Code CSP for the standalone CSP and injects the
// coach-token meta. See docs-fork/specs/03-standalone-html.md.
import { getDashboardHtml } from '../webview/panel-html'; // pulls panel-shared -> vscode (aliased to the stub)

export interface HtmlOptions {
  token: string; // 64-char hex; goes into the coach-token meta tag
  appVersion: string; // reserved for footer / about; not load-bearing in v1
}

const STANDALONE_CSP_META =
  `<meta http-equiv="Content-Security-Policy" ` +
  `content="default-src 'self'; style-src 'self' 'unsafe-inline'; ` +
  `script-src 'self'; img-src 'self' data:; font-src 'self'">`;

const tokenMeta = (token: string): string =>
  `<meta name="coach-token" content="${token}">`;

function basename(p: string): string {
  return p.split('/').pop() ?? p;
}

// Replace exactly one occurrence of `pattern`, or throw. Converts an upstream
// panel-html.ts reformat into a build/test failure instead of a half-transformed,
// silently-blank page. Function-form replacement avoids `$`-sequence interpretation.
function replaceOnce(html: string, pattern: RegExp, replacement: string, label: string): string {
  const count = (html.match(new RegExp(pattern, 'g')) ?? []).length;
  if (count !== 1) {
    throw new Error(`coach: expected exactly one ${label}, found ${count}`);
  }
  return html.replace(pattern, () => replacement);
}

export function renderStandaloneHtml(opts: HtmlOptions): string {
  if (!/^[0-9a-f]{64}$/.test(opts.token)) {
    throw new Error('renderStandaloneHtml: token must be 64-char hex');
  }

  // Stub webview: asWebviewUri -> /dist/webview/<file>; cspSource -> 'self'.
  // vscode.Uri.joinPath (called inside getDashboardHtml) is provided by the
  // vscode-stub and returns { path, fsPath } whose trailing segment we keep.
  const stubWebview = {
    asWebviewUri: (u: { path?: string; fsPath?: string }) =>
      `/dist/webview/${basename(u.path ?? u.fsPath ?? String(u))}`,
    cspSource: "'self'",
  };

  let html = getDashboardHtml(stubWebview as never, {} as never);

  // Transform 1: replace the VS Code CSP <meta> with the standalone CSP, and inject
  // the coach-token meta immediately after it. (The CSP content has no '>' char, so
  // [^>]* stops at the tag's closing '>'.)
  html = replaceOnce(
    html,
    /<meta http-equiv="Content-Security-Policy"[^>]*>/,
    `${STANDALONE_CSP_META}\n${tokenMeta(opts.token)}`,
    'CSP meta tag',
  );

  return html;
}
