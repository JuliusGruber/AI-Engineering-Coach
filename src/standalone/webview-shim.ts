// src/standalone/webview-shim.ts
// Browser-side polyfill. esbuild bundles this as a browser-target entrypoint to
// dist/standalone/standalone-shim.js (docs-fork/specs/07-build.md), loaded via
// <script src="/standalone-shim.js"> BEFORE app.js so acquireVsCodeApi exists
// when the unmodified webview bundle (shared.ts:9) calls it at module load.

declare global {
  // `var` (not let/const) so the assignment below augments globalThis under strict.
  // eslint-disable-next-line no-var
  var acquireVsCodeApi: () => {
    postMessage(msg: unknown): void;
    getState(): unknown;
    setState(s: unknown): void;
  };
}

// Curated set: only these disabled methods trigger the roadmap banner. Everything
// else disabled is silent (see docs-fork/specs/00-overview.md "Disabled-method UX").
export const BANNER_WORTHY: ReadonlySet<string> = new Set([
  'createSkill', 'generateSkillContent', 'generateLearningQuiz',
  'generateLearningResources', 'generateCodeComparison',
  'generateDidYouKnow', 'installSkill', 'installCatalogItem',
  'triageCatalog', 'getRuleEditor',
]);

export function installShim(): void {
  const token =
    document.querySelector('meta[name="coach-token"]')?.getAttribute('content') ?? '';

  const outbox: string[] = [];
  let ws: WebSocket | null = null;
  let attempt = 0;

  function connect(): void {
    ws = new WebSocket(`ws://${location.host}/rpc?t=${token}`);
    ws.addEventListener('open', () => {
      attempt = 0;
      while (outbox.length) ws!.send(outbox.shift()!);
    });
    ws.addEventListener('message', (ev) => {
      let frame: unknown;
      try {
        frame = JSON.parse(ev.data);
      } catch (e) {
        console.warn('[coach] bad frame', e);
        return;
      }
      window.postMessage(frame, '*'); // always forward; page handles data.error
    });
    ws.addEventListener('close', () => {
      ws = null;
      attempt += 1;
      if (attempt >= 5) window.dispatchEvent(new Event('coach:disconnected'));
      setTimeout(connect, Math.min(250 * 2 ** attempt, 30000));
    });
    ws.addEventListener('error', (e) => console.warn('[coach] ws error', e));
  }

  // Synchronous polyfill registration — before connect(), so app.js always loads
  // even when the token is missing (failure mode is RPC timeouts, not a blank page).
  globalThis.acquireVsCodeApi = () => ({
    postMessage: (msg: unknown) => {
      const frame = JSON.stringify(msg);
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(frame);
      else {
        if (outbox.length >= 100) outbox.shift(); // cap: drop oldest
        outbox.push(frame);
      }
    },
    getState: () => {
      try {
        return JSON.parse(localStorage.getItem('coach-state') || 'null');
      } catch {
        return null;
      }
    },
    setState: (s: unknown) => localStorage.setItem('coach-state', JSON.stringify(s)),
  });

  if (/^[0-9a-f]{64}$/.test(token)) connect();
  else console.warn('[coach] missing/invalid coach-token meta; RPC disabled');
}

// Self-execute only in the browser bundle. Under vitest the module runs on Node
// (process defined), so the import stays inert and tests drive installShim()
// directly. esbuild's browser target leaves `typeof process` intact and injects
// no `process` global, so this is true in the shipped bundle.
if (typeof process === 'undefined') installShim();
