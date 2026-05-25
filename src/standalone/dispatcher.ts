// src/standalone/dispatcher.ts
import { getRpcHandler } from '../webview/panel-rpc'; // pulls panel-shared -> vscode (aliased to stub)
import { V1_ALLOWED } from './v1-allowed';
import type { Analyzer } from '../core/analyzer';
import type { ParseResult } from '../core/cache';

export interface DispatchContext {
  // Optional: the server serves before the parse finishes (serve-then-parse).
  // A registry method dispatched while these are still undefined returns a
  // handler-error ("data not ready").
  analyzer?: Analyzer;
  parseResult?: ParseResult;
}

// Internal discriminated union. The SERVER (01-server) maps `{ ok:false, error }`
// to the webview wire shape `{ type:'response', id, data: { error, code, method } }`.
// This union never reaches the socket verbatim.
export type DispatchResult =
  | { ok: true; data: unknown }
  | { ok: false; error: { code: string; method?: string; message?: string } };

// Standalone-native methods bypass the upstream registry entirely.
export type NativeHandler = (params: unknown) => Promise<DispatchResult>;

export async function dispatch(
  method: string,
  params: unknown,
  ctx: DispatchContext,
): Promise<DispatchResult> {
  // Tier 1 (native table) is prepended in Task 5.

  // Tier 2: allowlist gate. Expected path (webview may hit a disabled method
  // proactively); no log line.
  if (!V1_ALLOWED.has(method)) {
    return { ok: false, error: { code: 'standalone-v1-disabled', method } };
  }

  // Tier 3a: data-ready guard (serve-then-parse).
  if (!ctx.analyzer || !ctx.parseResult) {
    return { ok: false, error: { code: 'handler-error', method, message: 'data not ready' } };
  }

  // Tier 3b: upstream registry lookup + invocation.
  const handler = getRpcHandler(method);
  if (!handler) {
    console.error(`[coach] unknown method: ${method}`);
    return { ok: false, error: { code: 'unknown-method', method } };
  }
  try {
    const data = await handler(ctx.analyzer, ctx.parseResult, params as Record<string, unknown>);
    return { ok: true, data: data ?? null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[coach] handler-error in ${method}:`, err);
    return { ok: false, error: { code: 'handler-error', method, message } };
  }
}
