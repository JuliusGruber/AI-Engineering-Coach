import { defineConfig } from 'vitest/config';

// Dedicated config so the upstream `npm test` (root include: src/**) stays unit-only
// and build-free, while this suite forks the BUILT dist/standalone/cli.js. Forking real
// processes is serialized (fileParallelism: false) to avoid port/state contention, with
// long timeouts for boot + parse + shutdown.
export default defineConfig({
  test: {
    include: ['tests/standalone/integration/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
