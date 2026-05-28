# 07 — Build glue

Additive edits to `package.json` and `esbuild.mjs` to bundle and
publish the standalone fork without touching the existing extension
build. Strict compliance with the additive-only rule in
[00-overview](00-overview.md#additive-only-fork-discipline).

## Goal

After this spec is implemented:

- `npm run build` produces the existing extension dist **and** the
  standalone outputs under `dist/standalone/`: `cli.js`,
  `standalone-shim.js`, the three core Worker scripts (`parse-worker.js`,
  `warm-up-worker.js`, `cache-write-worker.js`), and the built-in
  `rules/`+`metrics/` markdown. (The workers and rule/metric data must sit
  under `dist/standalone/` because the CLI bundle resolves them relative to
  its runtime `__dirname` — see "esbuild.mjs additions" below.)
- `npm run serve` runs the CLI from source for local dev.
- `npm pack` produces a tarball that publishes correctly to
  `@JuliusGruber/ai-engineer-coach`.
- `git diff upstream/main` shows only additions in the two shared
  files; everything else lives under new paths.

## Files

| Path                              | Change kind | Notes                                                                 |
|-----------------------------------|-------------|-----------------------------------------------------------------------|
| `package.json`                    | Additive    | Add keys only; no edits to existing keys                              |
| `esbuild.mjs`                     | Additive    | Append two new build entries (CLI + shim) + a standalone-scoped `vscode` alias; do not modify existing ones |
| `bin/coach`                       | New         | Node shebang launcher (see [05-cli](05-cli.md))                       |
| `src/standalone/vscode-stub.ts`   | New         | Stub that the `vscode` alias resolves to                              |
| `.npmignore` or `package.json#files` | New/Edit | Whitelist publish payload                                             |

## package.json additions

The implementing agent inserts these top-level keys (or appends to
existing arrays/objects). No deletions, no edits to existing keys.

```jsonc
{
  // ... existing keys untouched ...

  "name": "@JuliusGruber/ai-engineer-coach",   // ALREADY-DEFINED key — see Decisions

  "bin": {
    "coach": "bin/coach"
  },

  "scripts": {
    // ... existing scripts untouched ...
    "serve": "node ./dist/standalone/cli.js",
    "dev:standalone": "node --watch ./dist/standalone/cli.js",
    "build:standalone": "node esbuild.mjs --target=standalone",
    "test:integration:standalone": "vitest run tests/standalone/integration",
    "test:playwright:standalone": "playwright test --config=tests/standalone/playwright/playwright.config.ts",
    "pack:check": "npm pack --dry-run"
  },

  "dependencies": {
    // ... existing deps untouched ...
    "express": "^4.21.0",
    "ws": "^8.18.0",
    "open": "^10.1.0"
  },

  "devDependencies": {
    // ... existing dev deps untouched ...
    "@playwright/test": "^1.49.0"
  },

  "files": [
    "dist/standalone/",
    "dist/webview/",
    "bin/",
    "LICENSE",
    "NOTICE",
    "README.md"
  ],

  "publishConfig": {
    "access": "public"
  }
}
```

## Decisions on package.json

| Decision                                          | Choice                                                                       | Why |
|---------------------------------------------------|------------------------------------------------------------------------------|-----|
| Rename `name` to scoped fork                      | Yes (`@JuliusGruber/ai-engineer-coach`)                                       | Required for npm publish; upstream `name` stays in upstream `package.json` after a future `git pull` if we resolve in favor of our fork name. **This is the one allowed `name` edit; treat as part of the fork identity, not as an upstream modification.** |
| Pin dep versions to caret                         | Yes (`^x`)                                                                    | Matches upstream style; semver-safe                              |
| Add `engines.node`                                | `"node": ">=20"`                                                              | Document the Node 20+ requirement; feasibility doc cites this    |
| `files` array vs `.npmignore`                     | `files` array                                                                 | Explicit allowlist; safer than blacklist                         |
| Include source maps in publish                    | No                                                                            | Smaller tarball; users debug via stack traces                    |
| Add `vscode` keyword changes                      | No                                                                            | Keep existing keywords for discoverability                       |
| Publish access                                    | `public`                                                                      | Required for free scoped publish                                 |

The `name` edit is a one-line ownership change rather than an upstream
modification. If the implementing agent finds the existing `name` is
already non-`@microsoft/`, leave the value alone and merely confirm
it's set to the desired scope.

## esbuild.mjs additions

Append a new build entry. Do not refactor existing entries.

```js
// At the bottom of esbuild.mjs, alongside existing build({...}) calls:

// 1) The CLI / server bundle (Node target).
await build({
  entryPoints: ['src/standalone/cli.ts'],
  outfile: 'dist/standalone/cli.js',
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  bundle: true,
  sourcemap: false,
  external: [
    // Native or peer deps that should resolve at runtime, not be bundled:
    'fsevents',
  ],
  alias: {
    // REQUIRED — not optional. The standalone bundle pulls top-level
    // `import * as vscode` through TWO chains: getRpcHandler -> panel-shared.ts:7,
    // and panel-rpc.ts:37 -> core/rule-compiler.ts. The HTML wrapper also reuses
    // getDashboardHtml, which calls vscode.Uri.joinPath. One global alias to the
    // stub covers all of it, so the bundle never requires a real 'vscode' at
    // runtime. Scope: this standalone build ONLY — the extension build above must
    // keep the real external 'vscode'.
    vscode: './src/standalone/vscode-stub.ts',
  },
  banner: {
    js: '#!/usr/bin/env node',     // optional; bin/coach already provides shebang
  },
  minify: false,                   // readability > size for a CLI of this scale
  logLevel: 'info',
});

// 2) The webview shim (browser target → served as /standalone-shim.js).
await build({
  entryPoints: ['src/standalone/webview-shim.ts'],
  outfile: 'dist/standalone/standalone-shim.js',
  platform: 'browser',
  target: 'es2020',
  format: 'iife',
  bundle: true,
  sourcemap: false,
  minify: false,
  logLevel: 'info',
});

// 3-5) The three core Worker scripts the CLI spawns by __dirname-relative path at
// runtime: parse-worker (parser.ts:638, child_process.fork, ON the standalone parse
// path via parse-bootstrap.ts), warm-up-worker (analyzer.ts:135), cache-write-worker
// (cache.ts:317). The CLI bundle's runtime __dirname is dist/standalone/, so the
// workers MUST live there — the extension's copies in dist/ are not on the standalone
// bundle's path. Mirror the existing extension worker entries (node/es2022/cjs,
// external:['vscode'] — the parse pipeline is vscode-free as a forked child, proven
// by the extension already forking dist/parse-worker.js) with sourcemap:false.
for (const name of ['parse-worker', 'warm-up-worker', 'cache-write-worker']) {
  await build({
    entryPoints: [`src/core/${name}.ts`],
    outfile: `dist/standalone/${name}.js`,
    platform: 'node',
    target: 'es2022',
    format: 'cjs',
    bundle: true,
    sourcemap: false,
    external: ['vscode'],
    logLevel: 'info',
  });
}

// Built-in rules + metrics: rule-loader.ts reads them from __dirname/{rules,metrics}.
// registerAllBuiltinRules/Metrics fire as a MODULE-LOAD side effect of
// detector-registry.ts, which is pulled in by BOTH `new Analyzer(...)` and the
// dispatch path (panel-rpc.ts), and the dashboard's getAntiPatterns depends on them.
// Copy the markdown into dist/standalone/ so the CLI bundle finds it and `files`
// ships it (the extension's own copies in dist/{rules,metrics} stay untouched).
for (const [srcDir, ext] of [['src/core/rules', '.md'], ['src/core/metrics', '.metric.md']]) {
  const destDir = path.join('dist/standalone', path.basename(srcDir));
  fs.mkdirSync(destDir, { recursive: true });
  for (const file of fs.readdirSync(srcDir).filter(f => f.endsWith(ext))) {
    fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
  }
}
```

`vscode-stub.ts` is a new fork file. It is **not** an empty module: the
HTML wrapper ([03-standalone-html](03-standalone-html.md)) reuses upstream
`getDashboardHtml`, which calls `vscode.Uri.joinPath(...)` at
`panel-html.ts:11-12`. That is the one `vscode` member actually invoked on
the standalone path; everything else (`panel-shared`'s `postResponse`/
`postError`, `rule-compiler`'s vscode usage) is imported but never called.
So the stub provides a minimal `Uri.joinPath` and nothing more:

```ts
// src/standalone/vscode-stub.ts
// Resolves the transitive `import * as vscode` pulled in by reused webview
// files — panel-shared.ts:7 and core/rule-compiler.ts (via panel-rpc.ts:37) —
// AND satisfies the one live call on the standalone path:
// getDashboardHtml -> vscode.Uri.joinPath (panel-html.ts:11).
export const Uri = {
  // The standalone's stub Webview (03-standalone-html) maps the result to
  // `/dist/webview/<file>`, so only the trailing path segment is load-bearing.
  joinPath: (_base: unknown, ...parts: string[]) => ({
    path: parts.join('/'),
    fsPath: parts.join('/'),
  }),
};
export default { Uri };
```

Notes for the implementing agent:

- `dist/webview/app.js` and `dist/webview/styles.css` are produced by
  the **existing** esbuild entry (untouched). The standalone server
  serves them as static files; no second *webview-app* build is needed.
- The shim (`dist/standalone/standalone-shim.js`) is a **separate, tiny**
  browser build (entry 2 above) — it is not part of the webview app
  bundle and not part of the Node CLI bundle.
- The three Worker bundles and the `rules/`+`metrics/` copy **must** land
  under `dist/standalone/` (not `dist/`): the CLI bundle's runtime
  `__dirname` is `dist/standalone/`, and the reused core resolves workers
  via `path.join(__dirname, '<name>.js')` and built-in rules/metrics via
  `__dirname/{rules,metrics}`. Omitting them makes `coach` crash on the
  first real parse (missing `parse-worker.js`, no in-process fallback) and
  renders the dashboard's anti-pattern/metric data empty. The `files`
  allowlist's `dist/standalone/` entry then ships them with no further
  change.
- If the upstream esbuild config uses a `--target=` CLI flag for build
  selection, the new `build:standalone` script must follow that
  convention. Inspect `esbuild.mjs` at impl time and adapt; do not
  invent a new pattern.

## Decisions on esbuild

| Decision                              | Choice                                  | Why |
|---------------------------------------|------------------------------------------|-----|
| CJS vs ESM output                     | CJS                                      | `bin/coach` uses `require(...)`; CJS avoids loader headaches across Node 20.x patch versions |
| Minify CLI                            | No                                       | Readable stack traces > bytes saved for a tool that runs once per session |
| Source maps                           | No                                       | Same reason; reduces tarball size |
| `vscode` resolution (standalone build) | **Alias to `vscode-stub.ts`**           | `panel-rpc` transitively pulls a top-level `import * as vscode` via `panel-shared.ts:7`. Relying on tree-shaking is fragile and breaks vitest; the alias makes the import resolve to a stub deterministically. Scoped to the standalone entry only — the extension build keeps real external `vscode`. |
| Shim build target                     | Separate `browser`/`iife` esbuild entry | The shim runs in the browser as `/standalone-shim.js`; it cannot share the Node CLI bundle |
| Worker scripts + built-in rule/metric data | Re-bundle the three `src/core` workers to `dist/standalone/` and copy `rules/`+`metrics/` there | The CLI bundle's `__dirname` is `dist/standalone/`; the reused core spawns workers (`parser.ts:638` etc.) and reads rule/metric markdown (`rule-loader.ts`, fired by `detector-registry.ts` on module load) relative to `__dirname`. Placing them under `dist/standalone/` satisfies both runtime resolution and the `files` allowlist; the workers keep `external:['vscode']` (vscode-free as forked children) |
| Watch mode for dev                    | `node --watch`                           | Avoid adding `tsx`/`tsup`/`nodemon` deps; Node 20+ ships `--watch` |

## bin/coach

```sh
#!/usr/bin/env node
require('../dist/standalone/cli.js').runCli(process.argv)
  .then((code) => process.exit(code))
  .catch((err) => { console.error(err); process.exit(1); });
```

Five lines (incl. catch). `npm` installs `bin` entries on POSIX as
symlinks (with executable bit set) and on Windows as `.cmd` shims;
no platform-specific work needed.

## Dependencies

- npm runtime: `express`, `ws`, `open` (added; see versions above)
- npm dev: `@playwright/test` (added by [08-testing](08-testing.md);
  declared here so the additive `devDependencies` diff is in one place)
- Build: existing esbuild setup. Vitest is already in upstream
  `package.json` and is not re-added.

## Acceptance criteria

1. `npm run build` (the existing script) followed by
   `npm run build:standalone` produces, under `dist/standalone/`, `cli.js`,
   `standalone-shim.js`, the three Worker scripts (`parse-worker.js`,
   `warm-up-worker.js`, `cache-write-worker.js`), and the `rules/`+`metrics/`
   markdown — and leaves all existing `dist/*` outputs (including the
   extension bundle and its `dist/{rules,metrics}` copies) unchanged.
2. `node dist/standalone/cli.js --version` prints the package version.
2a. `node -e "require('./dist/standalone/cli.js')"` (bare import, no
    `vscode` available) does **not** throw — proves the `vscode` alias
    neutralized the transitive `panel-shared` import in the bundle.
2b. The extension bundle still references `vscode` as an external/runtime
    require (the standalone alias did not leak into it).
3. `npm pack --dry-run` (`npm run pack:check`) lists exactly:
   - `dist/standalone/**` (CLI, shim, the three Worker scripts, and
     `rules/*.md` + `metrics/*.metric.md`)
   - `dist/webview/**`
   - `bin/coach`
   - `LICENSE`, `NOTICE`, `README.md`, `package.json`
   No other paths — in particular no `dist/extension.js`, no
   `dist/*-worker.js` at the `dist/` root, and no `src/`.
4. `git diff upstream/main -- src/` shows only additions under
   `src/standalone/`.
5. `git diff upstream/main -- package.json esbuild.mjs` shows additions
   only (no `-` lines that remove or change existing values; the
   `name` rename is the documented exception).
6. `npm install -g .` (from a packed tarball) installs `coach` and the
   command is available on PATH.
7. The CLI's runtime assets resolve from its bundle dir:
   `dist/standalone/parse-worker.js` (and the two sibling workers) plus
   `dist/standalone/{rules,metrics}/` exist beside `dist/standalone/cli.js`
   — the `__dirname` the bundled core forks/reads. The end-to-end
   fork-and-parse round-trip (and the rule-backed dashboard) is verified by
   [08-testing](08-testing.md)'s smoke layer.

## Test plan

| Test                                   | Mechanism                                                       |
|----------------------------------------|-----------------------------------------------------------------|
| Tarball contents                       | CI step: `npm pack`, untar to `/tmp/x`, assert manifest (incl. workers + `rules/` + `metrics/` under `dist/standalone/`) |
| `coach --version` after global install | CI step: install tarball into a clean container, exec `coach`   |
| Runtime-asset co-location              | CI step: assert `parse-worker.js` + `rules/` + `metrics/` sit beside `cli.js` under `dist/standalone/` |
| Upstream-diff guard                    | CI step: `git diff upstream/main --stat -- src/` → fails on any non-`src/standalone/` line |
| Build idempotency                      | CI step: run build twice, assert byte-identical `dist/standalone/cli.js` |

No unit tests for this spec; it is configuration.

## Standalone token-reporting override (bucket A)

The standalone build ships `FF_TOKEN_REPORTING_ENABLED = true` without editing the
shared `src/core/constants.ts`. Mechanism:

- `src/standalone/standalone-constants.ts` — `export *` from `core/constants` plus a
  local `export const FF_TOKEN_REPORTING_ENABLED = true` (ESM shadow).
- `makeConstantsRedirectPlugin()` in `esbuild.mjs` — an `onResolve` plugin that
  redirects any import resolving to the absolute `src/core/constants.ts` to the
  wrapper. It matches on the **resolved absolute path** (not the specifier, so every
  relative spelling is caught), skips the wrapper's own `export *` (recursion guard),
  and throws in `onEnd` if it made zero redirects (loud failure on an upstream rename).
- The plugin is attached to **two** builds: the standalone CLI bundle
  (`dist/standalone/cli.js`, server-side handlers) and a **new** standalone webview
  bundle `dist/standalone/webview/app.js` (browser/iife/es2022, `sourcemap:false`),
  built from the shared `src/webview/app.ts`. Both must agree on FF=true.
- The shared `dist/webview/app.js` and the published extension keep FF=false.
  `files: ["dist/standalone/"]` ships the new bundle automatically; the server serves
  it from `/dist/standalone/webview` and `standalone-html.ts` points its `<script>` there.
