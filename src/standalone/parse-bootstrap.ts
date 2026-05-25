// src/standalone/parse-bootstrap.ts
// Standalone parse entry. DUPLICATES the worker-pool + Analyzer construction from
// src/webview/panel.ts:205-224 (loadData) -- copied, not imported, because panel.ts
// pulls `vscode`. A future upstream "shared bootstrap" refactor can collapse the two.
// Both halves (findLogsDirs, parseAllLogsViaWorker) are vscode-free core functions.
// See docs-fork/specs/05-cli.md.
import { findLogsDirs, parseAllLogsViaWorker, type LoadProgress } from '../core/parser';
import { Analyzer } from '../core/analyzer';
import type { ParseResult } from '../core/cache';

type ProgressFn = (p: LoadProgress) => void;

function emptyResult(): ParseResult {
  return {
    workspaces: new Map(),
    sessions: [],
    editLocIndex: new Map(),
    sessionSourceIndex: new Map(),
  };
}

export async function bootstrapParse(
  onProgress: ProgressFn,
): Promise<{ analyzer: Analyzer; parseResult: ParseResult }> {
  onProgress({ phase: 0, detail: 'Discovering log directories', pct: 0 });

  const dirs = findLogsDirs();
  const parseResult = dirs.length === 0 ? emptyResult() : await parseAllLogsViaWorker(dirs, (p) => onProgress(p));

  const analyzer = new Analyzer(parseResult.sessions, parseResult.editLocIndex, parseResult.workspaces);
  return { analyzer, parseResult };
}
