import { test, expect, type ConsoleMessage } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

// CommonJS project: use __dirname (no import.meta). globalSetup writes .runtime.json before
// the worker imports this spec, so this top-level read succeeds during a real test run.
const { origin, token } = JSON.parse(
  fs.readFileSync(path.join(__dirname, '.runtime.json'), 'utf8'),
) as { origin: string; token: string };

// The 12 real nav page ids. The shim's hash bridge (04-webview-shim Task 5) selects the page
// from `#<id>` after dataReady; navigateTo toggles `active` on the matching nav link (app.ts:466).
// The standalone bundle ships FF_TOKEN_REPORTING_ENABLED=true (esbuild constants redirect), so
// burndown's nav <li> IS emitted and navigateTo('burndown') is no longer normalized to dashboard.
const NAV = [
  'dashboard', 'timeline', 'image-gallery', 'output', 'burndown',
  'patterns', 'anti-patterns', 'skills', 'config-health', 'level-up',
  'data-explorer', 'rule-playground',
];

const pageUrl = (id: string): string => `${origin}/?t=${token}#${id}`;
// FF=true: every page (including burndown) owns its own active nav link.
const activeLink = (id: string): string => `.nav-links a[data-page="${id}"]`;

for (const id of NAV) {
  test(`#${id} renders the right page with zero console errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m: ConsoleMessage) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto(pageUrl(id), { waitUntil: 'load' });
    // The shim's hash bridge navigates after dataReady; the active nav link proves the
    // RIGHT page rendered (not a silent fall-back to dashboard if the hash were ignored).
    // This is the real per-page check acceptance #5 needs — `main#content > *` alone would
    // pass on dashboard 10 times. (auto-retrying assertion: waits for the class to appear.)
    await expect(page.locator(activeLink(id))).toHaveClass(/active/, { timeout: 15_000 });
    // ...and the page actually rendered content (degraded sections still emit nodes).
    await expect(page.locator('main#content')).toBeVisible();
    await expect.poll(() => page.locator('main#content > *').count(), { timeout: 15_000 })
      .toBeGreaterThan(0);

    expect(errors, `console errors on #${id}:\n${errors.join('\n')}`).toEqual([]);
  });
}

test('skills page shows the roadmap banner after a user-initiated createSkill', async ({ page }) => {
  await page.goto(pageUrl('skills'), { waitUntil: 'load' });
  await expect(page.locator('.nav-links a[data-page="skills"]')).toHaveClass(/active/, { timeout: 15_000 });
  // Drive a genuine banner-worthy method through the shim's outbound channel. The host
  // returns standalone-v1-disabled; the shim (createSkill ∈ BANNER_WORTHY) injects the banner.
  await page.evaluate(() => {
    const api = (window as unknown as { acquireVsCodeApi: () => { postMessage: (m: unknown) => void } }).acquireVsCodeApi();
    api.postMessage({ type: 'request', id: 'smoke-create-skill', method: 'createSkill', params: {} });
  });
  await expect(page.locator('#coach-roadmap-banner')).toBeVisible({ timeout: 10_000 });
});

test('dashboard does NOT show the roadmap banner on its proactive disabled calls', async ({ page }) => {
  await page.goto(pageUrl('dashboard'), { waitUntil: 'load' });
  await expect(page.locator('.nav-links a[data-page="dashboard"]')).toHaveClass(/active/, { timeout: 15_000 });
  await expect.poll(() => page.locator('main#content > *').count(), { timeout: 15_000 })
    .toBeGreaterThan(0);
  // Let the proactive triageSkills/discoverCatalog/triageCatalog calls round-trip (silent-disabled).
  await page.waitForTimeout(1_500);
  await expect(page.locator('#coach-roadmap-banner')).toHaveCount(0);
});

test('rule playground eval REPL returns a result for a sample expression', async ({ page }) => {
  await page.goto(pageUrl('rule-playground'), { waitUntil: 'load' });
  await expect(page.locator('.nav-links a[data-page="rule-playground"]')).toHaveClass(/active/, { timeout: 15_000 });
  await page.fill('#playground-expr', 'messageLength > 0');
  await page.click('#playground-run');
  // The results panel replaces its empty placeholder once evaluateExpression resolves.
  await expect(page.locator('#playground-results')).not.toContainText(
    'Write an expression and click Run', { timeout: 10_000 },
  );
});

test('output page shows the Token Usage tab (token reporting enabled in standalone)', async ({ page }) => {
  await page.goto(pageUrl('output'), { waitUntil: 'load' });
  await expect(page.locator('.nav-links a[data-page="output"]')).toHaveClass(/active/, { timeout: 15_000 });
  // The token-usage tab button is rendered only when FF_TOKEN_REPORTING_ENABLED is true.
  await expect(page.locator('button[data-tab="token-usage"]')).toBeVisible({ timeout: 10_000 });
});

test('burndown page renders end-to-end (override active, not the disabled banner)', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(pageUrl('burndown'), { waitUntil: 'load' });
  // burndown now owns its own active nav link (no redirect to dashboard).
  await expect(page.locator('.nav-links a[data-page="burndown"]')).toHaveClass(/active/, { timeout: 15_000 });
  await expect.poll(() => page.locator('main#content > *').count(), { timeout: 15_000 }).toBeGreaterThan(0);
  // Server returned real burndown data, so the FF=false gated notice is absent.
  await expect(page.locator('main#content')).not.toContainText('temporarily disabled');
  expect(errors, `console errors on #burndown:\n${errors.join('\n')}`).toEqual([]);
});

test('rule playground compiles a natural-language rule (degrades gracefully with no LLM key)', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(pageUrl('rule-playground'), { waitUntil: 'load' });
  await expect(page.locator('.nav-links a[data-page="rule-playground"]')).toHaveClass(/active/, { timeout: 15_000 });

  // Drive compileNlRule directly through the shim's outbound channel and confirm it resolves
  // (a non-error response). Offline it returns a heuristic template; it must never reject.
  const resolved = await page.evaluate(async () => {
    const api = (window as unknown as { acquireVsCodeApi: () => { postMessage: (m: unknown) => void } }).acquireVsCodeApi();
    return await new Promise<boolean>((resolve) => {
      const onMsg = (ev: MessageEvent) => {
        const f = ev.data as { type?: string; id?: string; data?: { error?: string; markdown?: string } };
        if (f.type === 'response' && f.id === 'smoke-compile-nl') {
          window.removeEventListener('message', onMsg);
          // Resolved with a scaffolded rule and no error => graceful NL-rule path works.
          resolve(typeof f.data?.markdown === 'string' && !f.data?.error);
        }
      };
      window.addEventListener('message', onMsg);
      api.postMessage({ type: 'request', id: 'smoke-compile-nl', method: 'compileNlRule', params: { prompt: 'flag short prompts' } });
      setTimeout(() => { window.removeEventListener('message', onMsg); resolve(false); }, 10_000);
    });
  });
  expect(resolved).toBe(true);
  expect(errors, `console errors on #rule-playground:\n${errors.join('\n')}`).toEqual([]);
});

test('rule editor generates a natural-language rule (generateRule degrades gracefully with no LLM key)', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  // generateRule's live UI entry is the "+ New Rule" modal on the anti-patterns page, reached via
  // the rule-editor route (app.ts:645 -> renderAntiPatterns). The page renders even though
  // getRuleEditor is disabled (shim RESOLVE_EMPTY_WHEN_DISABLED). generateRule has a template
  // fallback (panel-rpc.ts:1035), so offline it resolves with markdown and never rejects. We drive
  // it directly through the shim's outbound channel (page-agnostic) and assert the graceful path.
  await page.goto(pageUrl('rule-editor'), { waitUntil: 'load' });
  await expect.poll(() => page.locator('main#content > *').count(), { timeout: 15_000 }).toBeGreaterThan(0);

  const resolved = await page.evaluate(async () => {
    const api = (window as unknown as { acquireVsCodeApi: () => { postMessage: (m: unknown) => void } }).acquireVsCodeApi();
    return await new Promise<boolean>((resolve) => {
      const onMsg = (ev: MessageEvent) => {
        const f = ev.data as { type?: string; id?: string; data?: { error?: string; markdown?: string } };
        if (f.type === 'response' && f.id === 'smoke-generate-rule') {
          window.removeEventListener('message', onMsg);
          // Resolved with markdown and no error => graceful generateRule path works offline.
          resolve(typeof f.data?.markdown === 'string' && !f.data?.error);
        }
      };
      window.addEventListener('message', onMsg);
      api.postMessage({ type: 'request', id: 'smoke-generate-rule', method: 'generateRule', params: { prompt: 'flag short prompts' } });
      setTimeout(() => { window.removeEventListener('message', onMsg); resolve(false); }, 10_000);
    });
  });
  expect(resolved).toBe(true);
  expect(errors, `console errors on #rule-editor:\n${errors.join('\n')}`).toEqual([]);
});

test('learning center generates a quiz (service bridge + fake provider)', async ({ page }) => {
  await page.goto(pageUrl('level-up'), { waitUntil: 'load' });
  await expect(page.locator('.nav-links a[data-page="level-up"]')).toHaveClass(/active/, { timeout: 15_000 });

  const ok = await page.evaluate(async () => {
    const api = (window as unknown as { acquireVsCodeApi: () => { postMessage: (m: unknown) => void } }).acquireVsCodeApi();
    return await new Promise<boolean>((resolve) => {
      const onMsg = (ev: MessageEvent) => {
        const f = ev.data as { type?: string; id?: string; data?: { error?: string; questions?: unknown[] } };
        if (f.type === 'response' && f.id === 'smoke-quiz') {
          window.removeEventListener('message', onMsg);
          resolve(!f.data?.error && Array.isArray(f.data?.questions) && f.data.questions.length > 0);
        }
      };
      window.addEventListener('message', onMsg);
      api.postMessage({ type: 'request', id: 'smoke-quiz', method: 'generateLearningQuiz', params: { difficulty: 'easy', languages: ['ts'] } });
      setTimeout(() => { window.removeEventListener('message', onMsg); resolve(false); }, 15_000);
    });
  });
  expect(ok).toBe(true);
});

test('skill finder discovers + triages a catalog (service bridge + fake provider)', async ({ page }) => {
  await page.goto(pageUrl('skills'), { waitUntil: 'load' });
  await expect(page.locator('.nav-links a[data-page="skills"]')).toHaveClass(/active/, { timeout: 15_000 });

  const ok = await page.evaluate(async () => {
    const api = (window as unknown as { acquireVsCodeApi: () => { postMessage: (m: unknown) => void } }).acquireVsCodeApi();
    const call = (id: string, method: string, params: unknown) => new Promise<{ data?: { error?: string; items?: unknown[] } }>((resolve) => {
      const onMsg = (ev: MessageEvent) => {
        const f = ev.data as { type?: string; id?: string; data?: { error?: string; items?: unknown[] } };
        if (f.type === 'response' && f.id === id) { window.removeEventListener('message', onMsg); resolve(f); }
      };
      window.addEventListener('message', onMsg);
      api.postMessage({ type: 'request', id, method, params });
      setTimeout(() => { window.removeEventListener('message', onMsg); resolve({}); }, 15_000);
    });
    const cat = await call('smoke-triage', 'triageCatalog', { items: [{ id: 'demo-skill', title: 'Demo Skill', kind: 'skill', description: 'd', category: 'c' }] });
    return !cat.data?.error && Array.isArray(cat.data?.items) && cat.data.items.length > 0;
  });
  expect(ok).toBe(true);
});

test('context health review degrades gracefully (no crash) and renders', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(pageUrl('config-health'), { waitUntil: 'load' });
  await expect(page.locator('.nav-links a[data-page="config-health"]')).toHaveClass(/active/, { timeout: 15_000 });

  const settled = await page.evaluate(async () => {
    const api = (window as unknown as { acquireVsCodeApi: () => { postMessage: (m: unknown) => void } }).acquireVsCodeApi();
    return await new Promise<boolean>((resolve) => {
      const onMsg = (ev: MessageEvent) => {
        const f = ev.data as { type?: string; id?: string };
        if (f.type === 'response' && f.id === 'smoke-review') { window.removeEventListener('message', onMsg); resolve(true); }
      };
      window.addEventListener('message', onMsg);
      api.postMessage({ type: 'request', id: 'smoke-review', method: 'reviewContextFiles', params: { workspaceIds: ['does-not-exist'] } });
      setTimeout(() => { window.removeEventListener('message', onMsg); resolve(false); }, 15_000);
    });
  });
  expect(settled).toBe(true);
  await expect(page.locator('main#content')).toBeVisible();
  expect(errors, `console errors on #config-health:\n${errors.join('\n')}`).toEqual([]);
});

test('rule editor saves a rule (saveRule writes to the sandbox HOME)', async ({ page }) => {
  await page.goto(pageUrl('rule-editor'), { waitUntil: 'load' });
  await expect.poll(() => page.locator('main#content > *').count(), { timeout: 15_000 }).toBeGreaterThan(0);

  const RULE_MD = [
    '---', 'id: smoke-rule', 'name: smoke rule', 'group: prompt-quality', 'severity: low',
    'scope: requests', 'version: 1', 'tags: [custom]', 'thresholds:', '  maxLength: 30', '---', '',
    '# Description', 'smoke rule', '', '# Filter', 'messageLength > 0', '',
    '# Trigger', 'count > 0', '', '# When Triggered', '{{count}} of {{total}}.', '',
    '# How to Improve', 'n/a', '', '# Examples', '"{{messageText}}"',
  ].join('\n');

  const ok = await page.evaluate(async (markdown) => {
    const api = (window as unknown as { acquireVsCodeApi: () => { postMessage: (m: unknown) => void } }).acquireVsCodeApi();
    return await new Promise<boolean>((resolve) => {
      const onMsg = (ev: MessageEvent) => {
        const f = ev.data as { type?: string; id?: string; data?: { ok?: boolean; filePath?: string; error?: string } };
        if (f.type === 'response' && f.id === 'smoke-save-rule') {
          window.removeEventListener('message', onMsg);
          resolve(f.data?.ok === true && typeof f.data?.filePath === 'string' && !f.data?.error);
        }
      };
      window.addEventListener('message', onMsg);
      api.postMessage({ type: 'request', id: 'smoke-save-rule', method: 'saveRule', params: { markdown } });
      setTimeout(() => { window.removeEventListener('message', onMsg); resolve(false); }, 10_000);
    });
  }, RULE_MD);
  expect(ok).toBe(true);
});

test('skills installs a skill (installSkill writes to the sandbox HOME)', async ({ page }) => {
  await page.goto(pageUrl('skills'), { waitUntil: 'load' });
  await expect(page.locator('.nav-links a[data-page="skills"]')).toHaveClass(/active/, { timeout: 15_000 });

  const ok = await page.evaluate(async () => {
    const api = (window as unknown as { acquireVsCodeApi: () => { postMessage: (m: unknown) => void } }).acquireVsCodeApi();
    return await new Promise<boolean>((resolve) => {
      const onMsg = (ev: MessageEvent) => {
        const f = ev.data as { type?: string; id?: string; data?: { ok?: boolean; path?: string; error?: string } };
        if (f.type === 'response' && f.id === 'smoke-install-skill') {
          window.removeEventListener('message', onMsg);
          resolve(f.data?.ok === true && typeof f.data?.path === 'string' && !f.data?.error);
        }
      };
      window.addEventListener('message', onMsg);
      api.postMessage({ type: 'request', id: 'smoke-install-skill', method: 'installSkill', params: { filename: 'smoke-skill.md', content: '# Smoke' } });
      setTimeout(() => { window.removeEventListener('message', onMsg); resolve(false); }, 10_000);
    });
  });
  expect(ok).toBe(true);
});

test('level-up exports a summary (exportSummary writes to COACH_EXPORT_DIR)', async ({ page }) => {
  await page.goto(pageUrl('level-up'), { waitUntil: 'load' });
  await expect(page.locator('.nav-links a[data-page="level-up"]')).toHaveClass(/active/, { timeout: 15_000 });

  const folder = await page.evaluate(async () => {
    const api = (window as unknown as { acquireVsCodeApi: () => { postMessage: (m: unknown) => void } }).acquireVsCodeApi();
    return await new Promise<string | null>((resolve) => {
      const onMsg = (ev: MessageEvent) => {
        const f = ev.data as { type?: string; id?: string; data?: { ok?: boolean; folder?: string; error?: string } };
        if (f.type === 'response' && f.id === 'smoke-export') {
          window.removeEventListener('message', onMsg);
          resolve(f.data?.ok === true && !f.data?.error ? (f.data?.folder ?? null) : null);
        }
      };
      window.addEventListener('message', onMsg);
      api.postMessage({ type: 'request', id: 'smoke-export', method: 'exportSummary', params: {} });
      setTimeout(() => { window.removeEventListener('message', onMsg); resolve(null); }, 10_000);
    });
  });
  expect(folder).toContain('.coach-exports'); // server-chosen sandbox dir, never the repo cwd
});
