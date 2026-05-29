// src/standalone/llm-unavailable.ts
// With no provider key the stub's selectChatModels returns [] and panel-llm.ts:321 throws
// "No language model available. Make sure GitHub Copilot is installed and signed in." — wrong for
// standalone. Rewrite ANY error carrying that upstream substring to a standalone hint. Keying on
// the STRING (decision 3), not detectProvider()===null, leaves no-LLM methods like discoverCatalog
// untouched. Two entry points because the error surfaces differently:
//   • Service methods throw -> the bridge maps it to DispatchResult.error.message => rewriteLlmUnavailable
//   • explainOccurrence CATCHES its own throw (panel-rpc.ts:939) and returns { error } as DATA,
//     so the dispatcher wraps { ok:true, data:{ ok:false, error } }              => rewriteLlmUnavailableInData
import type { DispatchResult } from './dispatcher';

export const LLM_UNAVAILABLE_HINT =
  'Set ANTHROPIC_API_KEY or OPENAI_API_KEY to enable AI features.';

const UPSTREAM_MARKER = 'No language model available';

/** Rewrite a DispatchResult handler-error whose message carries the upstream marker. */
export function rewriteLlmUnavailable(result: DispatchResult): DispatchResult {
  if (result.ok) return result;
  if (typeof result.error.message === 'string' && result.error.message.includes(UPSTREAM_MARKER)) {
    return { ok: false, error: { ...result.error, message: LLM_UNAVAILABLE_HINT } };
  }
  return result;
}

/** Rewrite a registry handler's returned `data` when it carries a string `error` with the marker. */
export function rewriteLlmUnavailableInData(data: unknown): unknown {
  if (data && typeof data === 'object' && 'error' in data) {
    const err = (data as { error?: unknown }).error;
    if (typeof err === 'string' && err.includes(UPSTREAM_MARKER)) {
      return { ...(data as Record<string, unknown>), error: LLM_UNAVAILABLE_HINT };
    }
  }
  return data;
}
