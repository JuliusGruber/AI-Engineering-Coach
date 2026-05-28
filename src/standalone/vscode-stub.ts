// src/standalone/vscode-stub.ts
// Resolves the transitive `import * as vscode` pulled in by reused webview files
// (panel-shared.ts:7 via getRpcHandler) and the dynamic `require('vscode')` in
// core/rule-compiler.ts. Provides Uri.joinPath (getDashboardHtml -> panel-html.ts:11)
// AND the `lm` surface that panel-llm.ts + rule-compiler.ts consume (bucket D).
import { detectProvider, type ProviderMessage, type SendOptions } from './llm-provider';

export const Uri = {
  joinPath: (_base: unknown, ...parts: string[]) => ({
    path: parts.join('/'),
    fsPath: parts.join('/'),
  }),
};

// --- vscode.lm surface (bucket D) ----------------------------------------------
// See docs-fork/superpowers/spec/2026-05-27-standalone-parity-bucket-d-design.md § A.

export const LanguageModelChatMessage = {
  User: (content: string): ProviderMessage => ({ role: 'user', content }),
  Assistant: (content: string): ProviderMessage => ({ role: 'assistant', content }),
};

export class CancellationError extends Error {
  constructor() {
    super('Canceled');
    this.name = 'CancellationError';
  }
}

interface CancellationListener {
  dispose(): void;
}

class StubCancellationToken {
  isCancellationRequested = false;
  private readonly callbacks: Array<() => void> = [];
  // The wire that lets sendRequest's AbortController abort an in-flight fetch when
  // panel-llm.ts calls cts.cancel() (also fired by the 90s withTimeout). Polling
  // isCancellationRequested cannot interrupt a pending `await fetch`.
  onCancellationRequested(cb: () => void): CancellationListener {
    this.callbacks.push(cb);
    return { dispose() {} };
  }
  _fire(): void {
    if (this.isCancellationRequested) return;
    this.isCancellationRequested = true;
    for (const cb of this.callbacks) cb();
  }
}

export class CancellationTokenSource {
  readonly token = new StubCancellationToken();
  cancel(): void {
    this.token._fire();
  }
  dispose(): void {}
}

interface StubModel {
  sendRequest(
    messages: ProviderMessage[],
    options?: { modelOptions?: Record<string, unknown> },
    token?: { onCancellationRequested(cb: () => void): CancellationListener },
  ): { text: AsyncIterable<string> };
}

function makeModel(provider: NonNullable<ReturnType<typeof detectProvider>>): StubModel {
  return {
    sendRequest(messages, options, token) {
      const controller = new AbortController();
      // `token` is optional — rule-compiler.ts calls sendRequest(messages, {}) with none.
      token?.onCancellationRequested(() => controller.abort());
      const opts: SendOptions = { modelOptions: options?.modelOptions };
      // provider.send is a lazy async generator: the fetch fires on first iteration.
      return { text: provider.send(messages, opts, controller.signal) };
    },
  };
}

export const lm = {
  // The selector (incl. family) is intentionally IGNORED — see design § A. Returns one
  // model when a provider is configured, else [] (panel-llm.ts:321 then throws its
  // descriptive "No language model available" error; rule-compiler.ts:87 falls back to
  // its heuristic template).
  async selectChatModels(_selector?: { family?: string }): Promise<StubModel[]> {
    const provider = detectProvider();
    return provider ? [makeModel(provider)] : [];
  },
};

export default { Uri, lm, LanguageModelChatMessage, CancellationTokenSource, CancellationError };
