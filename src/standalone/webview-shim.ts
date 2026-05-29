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

// Curated set: only these disabled methods trigger the roadmap banner. Everything else
// disabled is silent. After buckets D + B, only createSkill remains degraded (it opens VS
// Code chat — no standalone equivalent). installSkill/installCatalogItem (bucket B) are now
// bridged and getRuleEditor (bucket B) is allowlisted, so the dispatcher never returns
// standalone-v1-disabled for them and their banner branch is unreachable — removed for hygiene.
export const BANNER_WORTHY: ReadonlySet<string> = new Set(['createSkill']);

// Disabled methods a page awaits as PRIMARY render data with no per-call fallback would need
// neutralizing to an empty frame so rpc() resolves instead of crashing the page render.
// getRuleEditor was the sole member; bucket B allowlists it, so the dispatcher no longer
// disables it and this branch is unreachable. Emptied for hygiene (mechanism kept inert).
export const RESOLVE_EMPTY_WHEN_DISABLED: ReadonlySet<string> = new Set<string>();

export function installShim(): void {
  const token =
    document.querySelector('meta[name="coach-token"]')?.getAttribute('content') ?? '';

  const outbox: string[] = [];
  let ws: WebSocket | null = null;
  let attempt = 0;

  // Deep-link serialization state (see forwardDataReady). pendingRpc counts in-flight RPC
  // requests (every outbound {type:'request'} gets exactly one inbound {type:'response'},
  // success/error/disabled alike), so the shim — the sole RPC channel — knows when the
  // default render's data fetches have settled.
  let pendingRpc = 0;
  let pendingDeepLink = false;
  let quiescenceCheckQueued = false;

  // app.ts has no hash router — it navigates only via the document-delegated click on
  // [data-page] links (app.ts:451-461) and defaults to 'dashboard'. We cannot edit
  // app.ts (additive-only), so to honor deep-link URLs (#skills, #rule-editor, …) we
  // synthesize a [data-page] element and click it, reusing that delegation. This reaches
  // every route, incl. the deep-link-only ones with no nav link and burndown (→dashboard).
  //
  // We use <span> rather than <a> because jsdom resolves an href-less anchor's click to
  // "current URL without fragment" and navigates, clearing location.hash. That would fire
  // a second hashchange with an empty hash and — more dangerously — strip the deep-link
  // hash before forwardDataReady's `if (location.hash)` test, silently disabling the
  // entire quiescence-then-navigate path. <span> has no default click behavior.
  function navFromHash(): void {
    const id = location.hash.slice(1);
    if (!id) return;
    const el = document.createElement('span');
    el.dataset.page = id;
    document.body.appendChild(el);
    el.click();
    el.remove();
  }

  // Apply the deep-link hash once the default render has settled. Checked on a macrotask:
  // any RPC chained off a just-resolved one is issued in the preceding microtask (it's
  // `await rpc(...)`, e.g. renderDashboard → loadDashSkills), so it has already bumped
  // pendingRpc before this runs. pendingRpc===0 here therefore means "no more data writes
  // are coming" — the default render is genuinely done.
  function checkQuiescence(): void {
    quiescenceCheckQueued = false;
    if (!pendingDeepLink) return;
    if (pendingRpc > 0) return; // still loading; the next drain-to-zero re-queues this check
    pendingDeepLink = false;
    navFromHash();
  }

  function queueQuiescenceCheck(): void {
    if (quiescenceCheckQueued) return;
    quiescenceCheckQueued = true;
    setTimeout(checkQuiescence, 0);
  }

  // Forward the dataReady frame to app.ts, then apply the URL hash deep-link — but only AFTER
  // the default render's RPCs quiesce. app.ts has no hash router; its onDataReady (queued via
  // the postMessage below) ends with navigateTo(currentPage), which defaults to 'dashboard'.
  // We honour deep-link URLs by synthesizing a [data-page] click (navFromHash), but that is a
  // SECOND page render. Two page renders into the same #content overlap destructively: the
  // default render's late RPCs resolve during the deep-link page's await and rewrite #content,
  // null-derefing the deep-link page's post-await DOM wiring (renderOutput's
  // getElementById('outputRange')! → withErrorBoundary) and corrupting the shared Chart.js
  // registry (shared.ts charts[] / c.canvas.id). Navigating first instead only makes BOTH
  // renders the same page id — still two overlapping renders, still corrupting (verified). The
  // robust fix is to serialize: let the default render finish, THEN navigate, so the deep-link
  // render is the sole in-flight render. The shim is the only RPC channel, so RPC quiescence is
  // the "default render done" signal (its data writes are all RPC-driven). This is warm-server
  // only — cold loads happen to avoid the timing overlap — but the serialization is unconditional.
  function forwardDataReady(frame: unknown): void {
    window.postMessage(frame, '*');
    if (location.hash) {
      pendingDeepLink = true;
      queueQuiescenceCheck();
    }
  }

  // Warm-server race guard: the server pushes dataReady on connect (server.ts:182). If it
  // arrives while app.js (the next classic <script>) is still fetching/executing, app.ts has
  // not yet installed its window 'message' listener (shared.ts:57) or its [data-page] click
  // delegation (app.ts:451), so an immediate forward is dropped and the page never renders or
  // navigates (the smoke-suite race). Deliver only once app.js has executed: immediately when
  // the document is already past parsing (readyState !== 'loading' ⇒ DOMContentLoaded has
  // fired ⇒ all non-deferred scripts ran), else on DOMContentLoaded. Delivering exactly once
  // avoids a double onDataReady; re-delivery would be idempotent anyway (server.ts:181).
  function deliverDataReady(frame: unknown): void {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => forwardDataReady(frame), { once: true });
    } else {
      forwardDataReady(frame);
    }
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
      // Count the response against its in-flight request (success/error/disabled alike) so the
      // deep-link serializer (forwardDataReady) learns when the default render's RPCs settle.
      if (f.type === 'response') {
        if (pendingRpc > 0) pendingRpc--;
        if (pendingDeepLink && pendingRpc === 0) queueQuiescenceCheck();
      }
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
      // dataReady is delivered through the warm-server race guard (may defer to
      // DOMContentLoaded); all other frames forward immediately. The page handles
      // data.error + onDataReady on receipt.
      if (f.type === 'dataReady') {
        deliverDataReady(frame);
        return;
      }
      window.postMessage(frame, '*');
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
      // Track outbound RPC requests for the deep-link serializer (forwardDataReady): each
      // request gets exactly one response, decremented in the inbound handler above.
      if ((msg as { type?: string })?.type === 'request') pendingRpc++;
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
