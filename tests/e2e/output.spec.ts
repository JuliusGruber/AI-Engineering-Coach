import { test, expect, Page } from '@playwright/test';

const HARNESS_URL = 'http://localhost:3999/tests/e2e/harness.html';

async function navigateToOutput(page: Page) {
  await page.goto(HARNESS_URL);
  await page.waitForFunction(() => {
    const content = document.getElementById('content');
    return content && content.innerHTML.length > 200 && !content.querySelector('.loading-spinner') && !content.querySelector('.error-boundary');
  }, { timeout: 10000 });
  await page.locator('[data-page="output"]').first().click();
  await page.waitForFunction(() => {
    const content = document.getElementById('content');
    return content && !content.querySelector('.loading-spinner');
  }, { timeout: 10000 });
}

test.describe('Output', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToOutput(page);
  });

  test('renders code production summary with AI LoC', async ({ page }) => {
    const content = await page.textContent('#content');
    // totalAiLoc: 14520 → formatted as 14,520 or 14.5K
    expect(content).toMatch(/14[.,]?5/);
  });

  test('shows gross and net AI LoC', async ({ page }) => {
    const content = await page.textContent('#content');
    expect(content).toContain('AI-Generated LoC');
    expect(content).toContain('Net AI LoC');
  });

  test('shows language breakdown chart', async ({ page }) => {
    // Production tab has language chart
    const content = await page.textContent('#content');
    expect(content).toContain('Language');
  });

  test('renders token usage tab with model totals', async ({ page }) => {
    // The Consumption / AI Credits tabs were consolidated into "Token Usage".
    const tabs = page.locator('#output-tabs .tab');
    const tokenUsageTab = tabs.filter({ hasText: /token usage/i });
    test.skip(await tokenUsageTab.count() === 0, 'Token usage is gated by FF_TOKEN_REPORTING_ENABLED');
    await tokenUsageTab.first().click();
    await page.waitForFunction(() => {
      const content = document.getElementById('content');
      return content && !content.querySelector('.loading-spinner');
    }, { timeout: 10000 });
    const content = await page.textContent('#content');
    // Model Token Breakdown table lists per-model rows.
    expect(content).toContain('gpt-4o');
  });

  test('shows token usage tab with token totals', async ({ page }) => {
    const tabs = page.locator('#output-tabs .tab');
    const tokenUsageTab = tabs.filter({ hasText: /token usage/i });
    test.skip(await tokenUsageTab.count() === 0, 'Token usage is gated by FF_TOKEN_REPORTING_ENABLED');
    await tokenUsageTab.first().click();
    await page.waitForFunction(() => {
      const content = document.getElementById('content');
      return content && !content.querySelector('.loading-spinner');
    }, { timeout: 10000 });
    const content = await page.textContent('#content');
    expect(content).toMatch(/Total Tokens|Model Token Breakdown/);
  });
});
