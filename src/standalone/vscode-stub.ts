// src/standalone/vscode-stub.ts
// Resolves the transitive `import * as vscode` pulled in by reused webview
// files — panel-shared.ts:7 (via getRpcHandler) — AND satisfies the one live
// call on the standalone path: getDashboardHtml -> vscode.Uri.joinPath
// (panel-html.ts:11), used later by 03-standalone-html.
export const Uri = {
  joinPath: (_base: unknown, ...parts: string[]) => ({
    path: parts.join('/'),
    fsPath: parts.join('/'),
  }),
};
export default { Uri };
