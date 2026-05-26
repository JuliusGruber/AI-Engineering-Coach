import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Manual, report-only coverage scoped to src/standalone/ (the spec's 80%-line target
// is tracked, NOT CI-enforced in v1). No thresholds → it reports and exits 0. The
// vscode alias is duplicated here because standalone-html/dispatcher unit tests pull
// the transitive `import * as vscode` (panel-html.ts:6 / panel-shared.ts:7).
export default defineConfig({
  test: {
    include: ['src/standalone/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15_000,
    coverage: {
      enabled: true,
      provider: 'v8',
      include: ['src/standalone/**/*.ts'],
      exclude: ['src/standalone/**/*.test.ts'],
      reporter: ['text', 'text-summary'],
    },
  },
  resolve: {
    alias: {
      vscode: fileURLToPath(new URL('../../src/standalone/vscode-stub.ts', import.meta.url)),
    },
  },
});
