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

// Disabled methods a page awaits as PRIMARY render data with no per-call fallback. A
// disabled response makes rpc() (shared.ts) reject, and these rejections are NOT caught at
// the call site, so they crash the whole page render into withErrorBoundary instead of
// degrading. getRuleEditor is awaited in renderAntiPatterns' bare Promise.all
// (page-antipatterns.ts) and is the rule-editor route's sole data source. For these the
// shim forwards an empty-data frame so rpc() resolves and the page degrades gracefully.
// The other BANNER_WORTHY methods are user-action calls guarded by their own try/catch and
// MUST keep rejecting — resolving them to empty would fake a successful action.
export const RESOLVE_EMPTY_WHEN_DISABLED: ReadonlySet<string> = new Set(['getRuleEditor']);

export function installShim(): void {
  const token =
    document.querySelector('meta[name="coach-token"]')?.getAttribute('content') ?? '';

  const outbox: string[] = [];
  let ws: WebSocket | null = null;
  let attempt = 0;

  // app.ts has no hash router — it navigates only via the document-delegated click on
  // [data-page] links (app.ts:451-461) and defaults to 'dashboard'. We cannot edit
  // app.ts (additive-only), so to honor deep-link URLs (#skills, #rule-editor, …) we
  // synthesize a [data-page] element and click it, reusing that delegation. This reaches
  // every route, incl. the deep-link-only ones with no nav link and burndown (→dashboard).
  function navFromHash(): void {
    const id = location.hash.slice(1);
    if (!id) return;
    const el = document.createElement('a');
    el.dataset.page = id;
    el.style.display = 'none';
    document.body.appendChild(el);
    el.click();
    el.remove();
  }

  function showRoadmapBanner(): void {
    const ID = 'coach-roadmap-banner';
    let banner = document.getElementById(ID);
    if (!banner) {
      banner = document.createElement('div');
      banner.id = ID;
      // Inline style: CSP allows style-src 'unsafe-inline' (see 00-overview).
      banner.setAttribute(
        'style',
        'position:fixed;bottom:0;left:0;right:0;z-index:99999;display:flex;' +
          'justify-content:space-between;align-items:center;gap:12px;' +
          'padding:12px 16px;background:#1e1e1e;color:#fff;' +
          'font:13px/1.4 sans-serif;border-top:1px solid #444;',
      );
      const text = document.createElement('span');
      text.textContent =
        'This feature is coming to standalone in v2. Today it lives in the VS Code extension.';
      const close = document.createElement('button');
      close.textContent = '×'; // multiplication sign as the dismiss glyph
      close.setAttribute('aria-label', 'Dismiss');
      close.setAttribute(
        'style',
        'background:none;border:none;color:#fff;font-size:18px;cursor:pointer;',
      );
      const el = banner;
      close.addEventListener('click', () => el.remove());
      banner.append(text, close);
      document.body.appendChild(banner);
    }
    banner.dataset.ts = String(Date.now()); // idempotent: refresh timestamp, never stack
  }

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
      // Banner + degradation decisions live here — the shim is the only place that sees
      // every frame.
      const f = frame as { type?: string; id?: unknown; data?: { code?: string; method?: string } };
      if (f.data?.code === 'standalone-v1-disabled') {
        const method = f.data.method ?? '';
        if (BANNER_WORTHY.has(method)) showRoadmapBanner();
        if (RESOLVE_EMPTY_WHEN_DISABLED.has(method)) {
          // Forward empty data (no error) so rpc() resolves instead of rejecting; the page's
          // `ruleData.rules || []` guards then render a degraded view rather than throwing.
          window.postMessage({ type: f.type, id: f.id, data: {} }, '*');
          return;
        }
      }
      window.postMessage(frame, '*'); // always forward; page handles data.error + onDataReady
      if (f.type === 'dataReady') {
        // app.ts has no hash router and onDataReady (just queued via postMessage above)
        // resets to 'dashboard'; re-apply the URL hash on the next task so a deep-link wins.
        // setTimeout(0) runs after the posted-message task in every major browser.
        if (location.hash) setTimeout(navFromHash, 0);
        // Startup race: the shim opens the WS (connect(), below) before app.js executes, and
        // the server pushes dataReady on connect whenever data is already present — a warm
        // reload, a second tab, or every test after globalSetup's seed parse. A dataReady
        // posted before app.ts attaches its `message` listener (app.ts:444) is dropped and the
        // page never renders. onDataReady is idempotent (server.ts), so while the document is
        // still loading, re-deliver once on `load` — by then app.ts is listening.
        if (document.readyState !== 'complete') {
          window.addEventListener('load', () => {
            window.postMessage(frame, '*');
            if (location.hash) setTimeout(navFromHash, 0);
          }, { once: true });
        }
      }
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

  window.addEventListener('hashchange', navFromHash);

  if (/^[0-9a-f]{64}$/.test(token)) connect();
  else console.warn('[coach] missing/invalid coach-token meta; RPC disabled');
}

// Self-execute only in the browser bundle. Under vitest the module runs on Node
// (process defined), so the import stays inert and tests drive installShim()
// directly. esbuild's browser target leaves `typeof process` intact and injects
// no `process` global, so this is true in the shipped bundle.
if (typeof process === 'undefined') installShim();
