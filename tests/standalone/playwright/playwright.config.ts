import { defineConfig, devices } from '@playwright/test';

// This project is CommonJS (no "type":"module" in package.json), so Playwright transpiles
// configs/specs to CJS where `import.meta.url` is unavailable. Use __dirname + relative
// paths (Playwright resolves testDir/globalSetup/globalTeardown against the config dir),
// matching the upstream playwright.config.ts idiom.
export default defineConfig({
  testDir: __dirname,
  testMatch: '**/*.spec.ts',
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 30_000,
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], headless: true } }],
});
