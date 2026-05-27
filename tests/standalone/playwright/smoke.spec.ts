import { test, expect, type ConsoleMessage } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

// CommonJS project: use __dirname (no import.meta). globalSetup writes .runtime.json before
// the worker imports this spec, so this top-level read succeeds during a real test run.
const { origin, token } = JSON.parse(
  fs.readFileSync(path.join(__dirname, '.runtime.json'), 'utf8'),
) as { origin: string; token: string };

// The 10 real nav page ids. The shim's hash bridge (04-webview-shim Task 5) selects the
// page from `#<id>` after dataReady; navigateTo toggles `active` on the matching nav link
// (app.ts:466). burndown's nav <li> is not emitted while FF_TOKEN_REPORTING_ENABLED is
// false (panel-html.ts:34) and navigateTo('burndown') normalizes to 'dashboard'
// (app.ts:26-29), so its active link is dashboard.
const NAV = [
  'dashboard', 'timeline', 'image-gallery', 'output', 'burndown',
  'patterns', 'anti-patterns', 'skills', 'config-health', 'level-up',
  'data-explorer', 'rule-playground',
];

const pageUrl = (id: string): string => `${origin}/?t=${token}#${id}`;
// The nav link expected to be `active` once the page rendered (burndown → dashboard).
const activeId = (id: string): string => (id === 'burndown' ? 'dashboard' : id);
const activeLink = (id: string): string => `.nav-links a[data-page="${activeId(id)}"]`;

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
