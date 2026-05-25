/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/webview/**',
        'src/extension.ts',
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 60,
        statements: 70,
      },
      reporter: ['text', 'text-summary'],
    },
  },
  resolve: {
    // Reused upstream webview modules pull a top-level `import * as vscode`
    // (panel-shared.ts:7). Map it to the standalone stub so tests importing the
    // real panel-rpc resolve. Mirrors the esbuild alias in 07-build.
    alias: {
      vscode: fileURLToPath(new URL('./src/standalone/vscode-stub.ts', import.meta.url)),
    },
  },
});
