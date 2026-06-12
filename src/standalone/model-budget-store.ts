// src/standalone/model-budget-store.ts — standalone replacement for the upstream
// globalState Memento that backs saveModelBudgets/loadModelBudgets (panel.ts:342).
// Modeled on state.ts: versioned wrapper, atomic 0o600 write, resilient read.
import * as fs from 'fs';
import * as path from 'path';
import { atomicWriteJson, stateDir } from './state';

const MODEL_BUDGETS_FILE = 'model-budgets.json';
const SCHEMA_VERSION = 1;

interface ModelBudgetsFile {
  version: number;
  budgets: Record<string, number>;
}

function modelBudgetsFile(): string {
  return path.join(stateDir(), MODEL_BUDGETS_FILE);
}

export function writeModelBudgets(budgets: Record<string, number>): void {
  atomicWriteJson(modelBudgetsFile(), { version: SCHEMA_VERSION, budgets });
}

/** Never throws — every failure path degrades to {}. */
export function readModelBudgets(): Record<string, number> {
  const file = modelBudgetsFile();
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<ModelBudgetsFile>;
    if (parsed?.version !== SCHEMA_VERSION) {
      console.warn(
        `[coach] unknown model-budgets.json schema version ${parsed?.version}; ignoring`,
      );
      return {};
    }
    const budgets = parsed.budgets;
    if (typeof budgets !== 'object' || budgets === null || Array.isArray(budgets)) return {};
    return budgets as Record<string, number>;
  } catch {
    // Corrupt JSON (or unreadable file): quarantine so the next save starts clean.
    try {
      const broken = `${file}.broken-${Date.now()}`;
      fs.renameSync(file, broken);
      console.warn(`[coach] corrupt model-budgets.json; moved to ${broken}`);
    } catch { /* quarantine is best-effort; still degrade to {} */ }
    return {};
  }
}
