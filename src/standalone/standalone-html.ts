// src/standalone/standalone-html.ts
// Wraps the unmodified upstream getDashboardHtml (panel-html.ts) for a plain
// browser. See docs-fork/specs/03-standalone-html.md. Transforms (CSP swap +
// external shim) are layered on in later tasks.
import { getDashboardHtml } from '../webview/panel-html'; // pulls panel-shared -> vscode (aliased to the stub)

export interface HtmlOptions {
  token: string; // 64-char hex; goes into the coach-token meta tag
  appVersion: string; // reserved for footer / about; not load-bearing in v1
}

function basename(p: string): string {
  return p.split('/').pop() ?? p;
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

  return getDashboardHtml(stubWebview as never, {} as never);
}
