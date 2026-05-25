# 07 — Build glue

Additive edits to `package.json` and `esbuild.mjs` to bundle and
publish the standalone fork without touching the existing extension
build. Strict compliance with the additive-only rule in
[00-overview](00-overview.md#additive-only-fork-discipline).

## Goal

After this spec is implemented:

- `npm run build` produces the existing extension dist **and**
  `dist/standalone/cli.js`.
- `npm run serve` runs the CLI from source for local dev.
- `npm pack` produces a tarball that publishes correctly to
  `@JuliusGruber/ai-engineer-coach`.
- `git diff upstream/main` shows only additions in the two shared
  files; everything else lives under new paths.

## Files

| Path                              | Change kind | Notes                                                                 |
|-----------------------------------|-------------|-----------------------------------------------------------------------|
| `package.json`                    | Additive    | Add keys only; no edits to existing keys                              |
| `esbuild.mjs`                     | Additive    | Append a new build entry; do not modify existing ones                 |
| `bin/coach`                       | New         | Node shebang launcher (see [05-cli](05-cli.md))                       |
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
  banner: {
    js: '#!/usr/bin/env node',     // optional; bin/coach already provides shebang
  },
  minify: false,                   // readability > size for a CLI of this scale
  logLevel: 'info',
});
```

Notes for the implementing agent:

- `dist/webview/app.js` and `dist/webview/styles.css` are produced by
  the **existing** esbuild entry (untouched). The standalone server
  serves them as static files; no second webview build is needed.
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
| External `vscode`                     | Not needed                               | Standalone code does not import `vscode`; if any transitive import sneaks in, esbuild's bundle resolution fails loudly (catches a bug) |
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
   `npm run build:standalone` produces `dist/standalone/cli.js` and
   leaves all existing `dist/*` outputs unchanged.
2. `node dist/standalone/cli.js --version` prints the package version.
3. `npm pack --dry-run` (`npm run pack:check`) lists exactly:
   - `dist/standalone/**`
   - `dist/webview/**`
   - `bin/coach`
   - `LICENSE`, `NOTICE`, `README.md`, `package.json`
   No other paths.
4. `git diff upstream/main -- src/` shows only additions under
   `src/standalone/`.
5. `git diff upstream/main -- package.json esbuild.mjs` shows additions
   only (no `-` lines that remove or change existing values; the
   `name` rename is the documented exception).
6. `npm install -g .` (from a packed tarball) installs `coach` and the
   command is available on PATH.

## Test plan

| Test                                   | Mechanism                                                       |
|----------------------------------------|-----------------------------------------------------------------|
| Tarball contents                       | CI step: `npm pack`, untar to `/tmp/x`, assert manifest         |
| `coach --version` after global install | CI step: install tarball into a clean container, exec `coach`   |
| Upstream-diff guard                    | CI step: `git diff upstream/main --stat -- src/` → fails on any non-`src/standalone/` line |
| Build idempotency                      | CI step: run build twice, assert byte-identical `dist/standalone/cli.js` |

No unit tests for this spec; it is configuration.
