// src/standalone/standalone-native.ts
import open from 'open';
import type { DispatchResult, NativeHandler } from './dispatcher';
import { readModelBudgets, writeModelBudgets } from './model-budget-store';

// Defensive bound on a single persisted record — far above any realistic model count.
const MAX_BUDGET_KEYS = 200;

export const STANDALONE_NATIVE: Record<string, NativeHandler> = {
  // page-peers.ts:336 — open a web link in the user's browser.
  openExternal: async (params): Promise<DispatchResult> => {
    const url = (params as { url?: unknown } | undefined)?.url;
    if (typeof url !== 'string') {
      return { ok: false, error: { code: 'bad-request', method: 'openExternal', message: 'missing url' } };
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, error: { code: 'bad-request', method: 'openExternal', message: 'invalid url' } };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      // Block file: / vscode: / custom-scheme handlers — `open` shells out to the OS.
      return { ok: false, error: { code: 'bad-request', method: 'openExternal', message: 'only http(s) urls allowed' } };
    }
    await open(parsed.href); // open@10 auto-detects URLs; the http(s) scheme is already validated above
    return { ok: true, data: { ok: true } };
  },
  // page-burndown.ts:95 — persist per-model token budgets (upstream: globalState, panel.ts:342).
  saveModelBudgets: async (params): Promise<DispatchResult> => {
    const budgets = (params as { budgets?: unknown } | undefined)?.budgets;
    if (typeof budgets !== 'object' || budgets === null || Array.isArray(budgets)) {
      return { ok: false, error: { code: 'bad-request', method: 'saveModelBudgets', message: 'missing budgets' } };
    }
    // Mirror the webview's own `if (v > 0)` filter (page-burndown.ts:88-90):
    // zero/negative/NaN/Infinity/non-number values never reach disk.
    const sanitized: Record<string, number> = {};
    for (const [k, v] of Object.entries(budgets as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
        if (Object.keys(sanitized).length >= MAX_BUDGET_KEYS) break;
        sanitized[k] = v;
      }
    }
    writeModelBudgets(sanitized);
    return { ok: true, data: { ok: true } };
  },
  // page-burndown.ts:103 — load persisted budgets; resolves to the bare record. Params ignored.
  loadModelBudgets: async (): Promise<DispatchResult> => {
    return { ok: true, data: readModelBudgets() };
  },
};
