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

export async function bootstrapParse(
  onProgress: ProgressFn,
): Promise<{ analyzer: Analyzer; parseResult: ParseResult }> {
  onProgress({ phase: 0, detail: 'Discovering log directories', pct: 0 });

  // findLogsDirs() only covers VS Code Copilot + Xcode. External harnesses
  // (Claude/Codex/OpenCode) are discovered *inside* the worker via their own
  // find*Dirs(), independent of `dirs` -- so always run the worker. Gating on
  // dirs.length left Copilot-less machines (e.g. Claude-only) showing nothing.
  const dirs = findLogsDirs();
  const parseResult = await parseAllLogsViaWorker(dirs, (p) => onProgress(p));

  const analyzer = new Analyzer(parseResult.sessions, parseResult.editLocIndex, parseResult.workspaces);
  return { analyzer, parseResult };
}
