// src/standalone/standalone-constants.ts
// Standalone-only override of the shared feature flag. Re-exports every upstream
// core constant, then shadows FF_TOKEN_REPORTING_ENABLED with `true`. An explicit
// local export wins over the `export *` re-export for that one name (ESM rule).
//
// This module is NEVER imported by upstream code directly — esbuild's
// constants-redirect plugin (esbuild.mjs) swaps `core/constants` for this file
// ONLY in the standalone CLI bundle and the standalone webview bundle, so the
// published extension and the shared dist/webview/app.js keep FF=false.
export * from '../core/constants';
export const FF_TOKEN_REPORTING_ENABLED = true;
