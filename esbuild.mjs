/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

const isWatch = process.argv.includes('--watch');

// Bundle the extension host
const extensionBuild = esbuild.build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  target: 'es2022',
  format: 'cjs',
  outfile: 'dist/extension.js',
  sourcemap: true,
  external: ['vscode'],
});

// Bundle the warm-up worker (runs off the extension host thread)
const workerBuild = esbuild.build({
  entryPoints: ['src/core/warm-up-worker.ts'],
  bundle: true,
  platform: 'node',
  target: 'es2022',
  format: 'cjs',
  outfile: 'dist/warm-up-worker.js',
  sourcemap: true,
  external: ['vscode'],
});

// Bundle the parse worker (runs the full parse pipeline off the extension host thread)
const parseWorkerBuild = esbuild.build({
  entryPoints: ['src/core/parse-worker.ts'],
  bundle: true,
  platform: 'node',
  target: 'es2022',
  format: 'cjs',
  outfile: 'dist/parse-worker.js',
  sourcemap: true,
  external: ['vscode'],
});

// Bundle the cache write worker (writes cache data to disk off the main thread)
const cacheWriteWorkerBuild = esbuild.build({
  entryPoints: ['src/core/cache-write-worker.ts'],
  bundle: true,
  platform: 'node',
  target: 'es2022',
  format: 'cjs',
  outfile: 'dist/cache-write-worker.js',
  sourcemap: true,
  external: ['vscode'],
});

// Bundle the webview script
const webviewBuild = esbuild.build({
  entryPoints: ['src/webview/app.ts'],
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'iife',
  outfile: 'dist/webview/app.js',
  sourcemap: true,
});

await Promise.all([extensionBuild, workerBuild, parseWorkerBuild, cacheWriteWorkerBuild, webviewBuild]);

// Copy static webview assets
const webviewDist = 'dist/webview';
fs.mkdirSync(webviewDist, { recursive: true });

// Copy rule markdown files to dist/rules/
const rulesSrc = 'src/core/rules';
const rulesDist = 'dist/rules';
fs.mkdirSync(rulesDist, { recursive: true });
if (fs.existsSync(rulesSrc)) {
  for (const file of fs.readdirSync(rulesSrc).filter(f => f.endsWith('.md'))) {
    fs.copyFileSync(path.join(rulesSrc, file), path.join(rulesDist, file));
  }
}

// Copy metric definition files to dist/metrics/
const metricsSrc = 'src/core/metrics';
const metricsDist = 'dist/metrics';
fs.mkdirSync(metricsDist, { recursive: true });
if (fs.existsSync(metricsSrc)) {
  for (const file of fs.readdirSync(metricsSrc).filter(f => f.endsWith('.metric.md'))) {
    fs.copyFileSync(path.join(metricsSrc, file), path.join(metricsDist, file));
  }
}

const cssSources = [
  'src/webview/styles.css',
  'src/webview/styles-pages.css',
  'src/webview/styles-skills.css',
  'src/webview/styles-learning.css',
];

function bundleCss() {
  const bundledCss = cssSources
    .map(source => fs.readFileSync(source, 'utf-8').trimEnd())
    .join('\n\n');
  fs.writeFileSync(path.join(webviewDist, 'styles.css'), `${bundledCss}\n`);
}

bundleCss();

// Copy sidebar CSS separately (sidebar is its own webview)
fs.copyFileSync('src/webview/styles-sidebar.css', path.join(webviewDist, 'sidebar.css'));

// --- Standalone fork bundles (additive; see docs-fork/specs/07-build.md) ----------
// Appended WITHOUT gating the extension/worker entries above (additive-only fork
// rule), so `npm run build` AND `npm run build:standalone` both emit these. The
// `vscode` alias is scoped to the CLI entry ONLY; the extension/worker builds keep
// `external: ['vscode']`, so the alias never leaks into the published extension.
//
// The CLI bundle is dist/standalone/cli.js, so its runtime __dirname is
// dist/standalone/. The reused core spawns three Worker scripts by __dirname-relative
// path (parser.ts:638 parse-worker via child_process.fork on the standalone parse
// path; analyzer.ts:135 warm-up-worker; cache.ts:317 cache-write-worker) and reads
// built-in rules/metrics from __dirname/{rules,metrics} (rule-loader.ts, fired by
// detector-registry.ts:14-15 on module load). The extension copies those to dist/
// (its own __dirname); the standalone bundle needs them under dist/standalone/. So we
// ALSO build the three workers here and copy rules+metrics below; files:
// ["dist/standalone/"] then ships them and the bundle's __dirname resolves them.
await Promise.all([
  // 1) CLI / server bundle (Node). bin/coach require()s this and calls runCli();
  //    the footer self-executes it only when run directly (`node dist/standalone/cli.js`).
  esbuild.build({
    entryPoints: ['src/standalone/cli.ts'],
    outfile: 'dist/standalone/cli.js',
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    bundle: true,
    sourcemap: false,
    // fsevents: macOS-only optional native dep; bufferutil/utf-8-validate: ws
    // optional native deps. All are require()d in try/catch and may be absent on a
    // given OS — keep them external so the bundle is deterministic across the matrix.
    external: ['fsevents', 'bufferutil', 'utf-8-validate'],
    alias: {
      // Reused upstream webview modules pull a top-level `import * as vscode`
      // (panel-shared.ts:7) and call vscode.Uri.joinPath (panel-html.ts:11). Map it
      // to the stub so the bundle never require()s a real 'vscode' at runtime.
      vscode: './src/standalone/vscode-stub.ts',
    },
    // cli.ts only EXPORTS runCli; this runs it when the bundle is the entry module,
    // so `node dist/standalone/cli.js --version` works. bin/coach require()s the
    // bundle (require.main !== module), so it is NOT double-invoked there.
    footer: {
      js: 'if (require.main === module) { module.exports.runCli(process.argv).then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); }); }',
    },
    // esbuild empties `import.meta` in cjs output, but cli.ts/server.ts and the bundled
    // ESM-only `open` package all read import.meta.url at runtime. Define it to the
    // bundle's own file URL (require/__filename exist in the cjs output) so all three
    // resolve to dist/standalone/cli.js; without this, open throws fileURLToPath(undefined)
    // at module load and `--version`/package.json resolution fail.
    banner: { js: "const importMetaUrl = require('url').pathToFileURL(__filename).href;" },
    define: { 'import.meta.url': 'importMetaUrl' },
    minify: false,
    logLevel: 'info',
  }),
  // 2) Browser shim served as /standalone-shim.js (defines acquireVsCodeApi).
  esbuild.build({
    entryPoints: ['src/standalone/webview-shim.ts'],
    outfile: 'dist/standalone/standalone-shim.js',
    platform: 'browser',
    target: 'es2020',
    format: 'iife',
    bundle: true,
    sourcemap: false,
    minify: false,
    logLevel: 'info',
  }),
  // 3-5) The three core Worker scripts the CLI bundle spawns by __dirname-relative
  // path at runtime. Same options as the extension's worker entries (esbuild.mjs:25-58)
  // — node/es2022/cjs, external:['vscode'] (the parse pipeline is vscode-free as a
  // forked child, proven by the extension already forking dist/parse-worker.js) — but
  // emitted under dist/standalone/ (the CLI bundle's __dirname) with sourcemap:false.
  esbuild.build({
    entryPoints: ['src/core/parse-worker.ts'],
    outfile: 'dist/standalone/parse-worker.js',
    platform: 'node',
    target: 'es2022',
    format: 'cjs',
    bundle: true,
    sourcemap: false,
    external: ['vscode'],
    logLevel: 'info',
  }),
  esbuild.build({
    entryPoints: ['src/core/warm-up-worker.ts'],
    outfile: 'dist/standalone/warm-up-worker.js',
    platform: 'node',
    target: 'es2022',
    format: 'cjs',
    bundle: true,
    sourcemap: false,
    external: ['vscode'],
    logLevel: 'info',
  }),
  esbuild.build({
    entryPoints: ['src/core/cache-write-worker.ts'],
    outfile: 'dist/standalone/cache-write-worker.js',
    platform: 'node',
    target: 'es2022',
    format: 'cjs',
    bundle: true,
    sourcemap: false,
    external: ['vscode'],
    logLevel: 'info',
  }),
]);

// Built-in rules + metrics: rule-loader.ts reads them from __dirname/{rules,metrics}.
// The extension copies to dist/{rules,metrics} (above, esbuild.mjs:77-95); mirror the
// copy into dist/standalone/ so the CLI bundle (whose __dirname is dist/standalone)
// finds them and files:["dist/standalone/"] publishes them. Same copy idiom as above.
const standaloneAssetCopies = [
  { srcDir: 'src/core/rules', destDir: 'dist/standalone/rules', ext: '.md' },
  { srcDir: 'src/core/metrics', destDir: 'dist/standalone/metrics', ext: '.metric.md' },
];
for (const { srcDir, destDir, ext } of standaloneAssetCopies) {
  fs.mkdirSync(destDir, { recursive: true });
  if (fs.existsSync(srcDir)) {
    for (const file of fs.readdirSync(srcDir).filter(f => f.endsWith(ext))) {
      fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
    }
  }
}

console.log('Build complete.');

if (isWatch) {
  const ctx1 = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    platform: 'node',
    target: 'es2022',
    format: 'cjs',
    outfile: 'dist/extension.js',
    sourcemap: true,
    external: ['vscode'],
  });
  const ctx2 = await esbuild.context({
    entryPoints: ['src/core/warm-up-worker.ts'],
    bundle: true,
    platform: 'node',
    target: 'es2022',
    format: 'cjs',
    outfile: 'dist/warm-up-worker.js',
    sourcemap: true,
    external: ['vscode'],
  });
  const ctx3 = await esbuild.context({
    entryPoints: ['src/core/parse-worker.ts'],
    bundle: true,
    platform: 'node',
    target: 'es2022',
    format: 'cjs',
    outfile: 'dist/parse-worker.js',
    sourcemap: true,
    external: ['vscode'],
  });
  const ctx5 = await esbuild.context({
    entryPoints: ['src/core/cache-write-worker.ts'],
    bundle: true,
    platform: 'node',
    target: 'es2022',
    format: 'cjs',
    outfile: 'dist/cache-write-worker.js',
    sourcemap: true,
    external: ['vscode'],
  });
  const ctx4 = await esbuild.context({
    entryPoints: ['src/webview/app.ts'],
    bundle: true,
    platform: 'browser',
    target: 'es2022',
    format: 'iife',
    outfile: 'dist/webview/app.js',
    sourcemap: true,
  });
  await Promise.all([ctx1.watch(), ctx2.watch(), ctx3.watch(), ctx4.watch(), ctx5.watch()]);
  for (const source of cssSources) {
    fs.watch(source, () => {
      try {
        bundleCss();
        console.log(`CSS rebuilt (${source} changed)`);
      } catch (err) {
        console.error('CSS rebuild failed:', err);
      }
    });
  }
  console.log('Watching for changes...');
}
