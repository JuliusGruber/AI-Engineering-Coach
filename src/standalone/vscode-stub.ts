// src/standalone/vscode-stub.ts
// Resolves the transitive `import * as vscode` pulled in by reused webview files
// (panel-shared.ts:7 via getRpcHandler) and the dynamic `require('vscode')` in
// core/rule-compiler.ts. Provides Uri.joinPath (getDashboardHtml -> panel-html.ts:11)
// AND the `lm` surface that panel-llm.ts + rule-compiler.ts consume (bucket D).
import { detectProvider, type ProviderMessage, type SendOptions } from './llm-provider';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const Uri = {
  // installSkill:615 / installCatalogItem:651 build absolute targets via Uri.file(`${HOME}/...`),
  // where HOME on Windows carries backslashes → a mixed-separator input. Mirror real VS Code:
  // fsPath is platform-native (path.normalize → backslashes on Windows) and path stays
  // forward-slash. The old pure pass-through leaked the forward slashes into fsPath, so the
  // installSkill response reported `C:\...coach-sw/.agents/...` and service-writes.test.ts
  // (which expects path.join's native separators) failed on Windows only.
  file: (p: string) => ({ fsPath: path.normalize(p), path: p.replace(/\\/g, '/') }),
  // Honor the base ONLY when present. getDashboardHtml (panel-html.ts:11) passes an empty {}
  // extensionUri → b === '' → filter(Boolean) drops it → identical to the old impl (snapshot
  // stays byte-identical). exportSummaryFiles:47 passes a real folder → must NOT be dropped.
  joinPath: (base: { fsPath?: string; path?: string } | undefined, ...parts: string[]) => {
    const b = base?.fsPath ?? base?.path ?? '';
    const joined = [b, ...parts].filter(Boolean).join('/');
    return { path: joined, fsPath: joined };
  },
};

// --- vscode.workspace / window / env write surface (bucket B) -------------------
// Consumed by panel-request-service.ts (installSkill/installCatalogItem) and
// summary-export-vscode.ts (exportSummaryFiles) via `import * as vscode`. See
// docs-fork/superpowers/spec/2026-05-29-standalone-parity-bucket-b-design.md § A.

export const workspace = {
  // getRuleEditor:742 reads `?.[0]?.uri.fsPath` → undefined (personal+builtin layers only);
  // exportSummaryFiles:33 reads `?.[0]?.uri` → defaultUri = undefined. Both short-circuit cleanly.
  workspaceFolders: undefined as readonly unknown[] | undefined,
  fs: {
    // Mirrors VS Code's workspace.fs.createDirectory: create the directory and all
    // missing parents. Upstream's path-hardening (af35d49) calls this explicitly
    // before writeFile (installSkill/installCatalogItem); without it the stub throws
    // "createDirectory is not a function".
    async createDirectory(uri: { fsPath: string }): Promise<void> {
      await fs.promises.mkdir(uri.fsPath, { recursive: true });
    },
    // Replicates VS Code's auto-parent-create: installCatalogItem writes nested
    // ~/.agents/<sub>/<slug>/, installSkill writes ~/.agents/skills/. `data` arrives as a
    // Buffer/Uint8Array (Buffer.from(...)), which fs.writeFile accepts directly.
    async writeFile(uri: { fsPath: string }, data: Uint8Array): Promise<void> {
      await fs.promises.mkdir(path.dirname(uri.fsPath), { recursive: true });
      await fs.promises.writeFile(uri.fsPath, data);
    },
  },
};

export const window = {
  // No interactive folder picker in standalone: always return the configured export dir, so
  // exportSummaryFiles never hits its `cancelled` branch (:45). The default lands under the
  // user's home (sibling to ~/.ai-engineer-coach/rules/) so a one-click export never pollutes
  // the repo `coach` was launched in; COACH_EXPORT_DIR overrides it.
  async showOpenDialog(_opts?: unknown): Promise<Array<{ fsPath: string; path: string }>> {
    const dir = process.env.COACH_EXPORT_DIR || path.join(os.homedir(), '.ai-engineer-coach', 'exports');
    return [{ fsPath: dir, path: dir }];
  },
  // No button → exportSummaryFiles:64 `if (action === 'Open Folder')` never fires.
  async showInformationMessage(_message?: string, ..._items: string[]): Promise<string | undefined> {
    return undefined;
  },
};

export const env = {
  // Never reached (showInformationMessage returns undefined); provided for safety/future use.
  async openExternal(_target: unknown): Promise<boolean> {
    return true;
  },
};

// Both consumers below are unreachable in standalone — createSkill is intercepted by
// webview-shim.ts (BANNER_WORTHY) before handleCreateSkill runs, and getSdlcGitHubData is
// excluded from v1-service-allowed.ts — but bundling them as `undefined` raises esbuild's
// import-is-undefined warning and would TypeError if a future page ever reached them.
// Reject instead: both call sites already handle rejection (panel-request-service.ts:303
// posts 'Failed to open Copilot Chat'; getGitHubAccessToken's catch returns undefined).
export const commands = {
  executeCommand(_command: string, ..._args: unknown[]): Promise<never> {
    return Promise.reject(new Error('VS Code commands are not available in standalone.'));
  },
};

export const authentication = {
  getSession(_providerId: string, _scopes?: readonly string[], _opts?: unknown): Promise<never> {
    return Promise.reject(new Error('VS Code authentication is not available in standalone.'));
  },
};

// --- vscode.lm surface (bucket D) ----------------------------------------------
// See docs-fork/superpowers/spec/2026-05-27-standalone-parity-bucket-d-design.md § A.

// LanguageModelTextPart — mirrors vscode.LanguageModelTextPart. panel-llm.ts's redactMessages()
// (upstream LLM-egress hardening, d00f84b) both constructs `new vscode.LanguageModelTextPart(...)`
// and does `part instanceof vscode.LanguageModelTextPart`; without this class each throws and every
// callLlm() dies before reaching the provider. `.value` carries the (post-redaction) text.
export class LanguageModelTextPart {
  constructor(public readonly value: string) {}
}

// LanguageModelChatMessage — VS Code models `.content` as an ARRAY of parts (a LanguageModelTextPart
// here), not a bare string; redactMessages() relies on that (it `.map()`s content, then rebuilds via
// `new LanguageModelChatMessage(role, parts, name)`). The User/Assistant factories wrap a string in
// one text part; sendRequest() flattens the parts back into the single string the provider layer
// (llm-provider.ts ProviderMessage) consumes.
export class LanguageModelChatMessage {
  constructor(
    public role: 'user' | 'assistant',
    public content: LanguageModelTextPart[],
    public name?: string,
  ) {}
  static User(content: string): LanguageModelChatMessage {
    return new LanguageModelChatMessage('user', [new LanguageModelTextPart(content)]);
  }
  static Assistant(content: string): LanguageModelChatMessage {
    return new LanguageModelChatMessage('assistant', [new LanguageModelTextPart(content)]);
  }
}

// Flatten a chat message's text parts into the single string the provider payload carries.
function toProviderMessages(messages: LanguageModelChatMessage[]): ProviderMessage[] {
  return messages.map((m) => ({ role: m.role, content: m.content.map((p) => p.value).join('') }));
}

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
    messages: LanguageModelChatMessage[],
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
      return { text: provider.send(toProviderMessages(messages), opts, controller.signal) };
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

export default { Uri, lm, workspace, window, env, commands, authentication, LanguageModelChatMessage, LanguageModelTextPart, CancellationTokenSource, CancellationError };
