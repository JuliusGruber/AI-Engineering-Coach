// src/standalone/request-service-bridge.ts
// Bridges the dropped PanelRequestService into the standalone dispatcher (bucket D § B).
// A FRESH PanelRequestService + capturing fake Webview is built per call — not a singleton —
// because event frames carry no id (so a singleton could not route an id-less reviewProgress
// event to the right caller) and getAnalyzer/getParseResult are fixed at construction (so
// per-call construction captures the live call's ctx). The service uses exactly one Webview
// member: postMessage(frame).
import type * as vscode from 'vscode';
import { PanelRequestService } from '../webview/panel-request-service';
import type { RequestMessage } from '../webview/panel-shared';
import type { DispatchContext, DispatchResult } from './dispatcher';
import { rewriteLlmUnavailable } from './llm-unavailable';

let _seq = 0;
function nextId(): string {
  return `svc-${Date.now()}-${_seq++}`;
}

interface ResponseFrame {
  type?: string;
  id?: string;
  method?: string;
  data?: { error?: unknown } & Record<string, unknown>;
}

export function dispatchServiceMethod(
  method: string,
  params: unknown,
  ctx: DispatchContext,
): Promise<DispatchResult> {
  return new Promise<DispatchResult>((resolve) => {
    try {
      const id = nextId();
      const captureWebview = {
        postMessage: (frame: ResponseFrame): void => {
          if (frame.type === 'event') {
            // Forward the event frame verbatim; the response frame still follows, so do NOT resolve.
            ctx.emitEvent?.(frame as unknown as Record<string, unknown>);
            return;
          }
          const data = frame.data ?? {};
          if (data && typeof data === 'object' && data.error) {
            // Rewrite the upstream "No language model available … Copilot" message to the
            // standalone hint when there's no key (grilling decisions 2/3/6); no-op otherwise.
            resolve(rewriteLlmUnavailable({ ok: false, error: { code: 'handler-error', method, message: String(data.error) } }));
          } else {
            resolve({ ok: true, data });
          }
        },
      };

      const service = new PanelRequestService(
        captureWebview as unknown as vscode.Webview,
        () => ctx.analyzer,
        () => ctx.parseResult,
      );

      const handled = service.tryHandle({ type: 'request', id, method, params } as RequestMessage);
      if (!handled) {
        // Behind the allowlist this should not happen; resolve defensively.
        resolve({ ok: false, error: { code: 'unknown-method', method } });
      }
    } catch (err) {
      // Construction/dispatch must never reject the dispatcher's promise.
      resolve(rewriteLlmUnavailable({ ok: false, error: { code: 'handler-error', method, message: err instanceof Error ? err.message : String(err) } }));
    }
  });
}
