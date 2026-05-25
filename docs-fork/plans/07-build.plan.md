# Build Glue (07-build) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `@JuliusGruber/ai-engineer-coach` build and publish by *additively* appending two standalone esbuild entries (the Node CLI bundle `dist/standalone/cli.js` and the browser shim `dist/standalone/standalone-shim.js`) to `esbuild.mjs`, and adding `bin`/`scripts`/`files`/`publishConfig`/`engines.node` (plus the one sanctioned `name` rename) to `package.json` — without modifying any existing extension build entry or `package.json` key.

**Architecture:** This spec produces **no runtime source** — it is build/config glue (`00-overview.md` LOC table: "~5 (config)"). The CLI bundle pulls a transitive top-level `import * as vscode` (via `./server` → `dispatcher` → `panel-rpc` → `panel-shared.ts:7`) and one live `vscode.Uri.joinPath` (via `getDashboardHtml`); a `vscode` → `src/standalone/vscode-stub.ts` **alias scoped to the CLI entry only** neutralizes both, while the untouched extension/worker entries keep `external: ['vscode']`. `bin/coach` `require()`s the bundle and calls `runCli`; an esbuild `footer` guarded by `require.main === module` lets `node dist/standalone/cli.js` self-execute (so `--version` prints) without double-invoking on the `bin/coach` path. Everything else this spec "introduces" — the `vscode-stub.ts` file, the `open`/`express`/`ws` deps, `@playwright/test`, and `bin/coach` itself — was already created by earlier specs (02-dispatcher, 01-server, 05-cli); 07-build *formalizes the build side* and treats those as idempotent check-and-skip.

**Tech Stack:** esbuild 0.28 (already in devDeps; `esbuild.build({...})` style as used by the existing `esbuild.mjs`), Node 20+ (CJS bundle target `node20`), npm 10 (`npm pack`/`files` allowlist for the publish payload). No new dependencies, no test framework usage (this spec has no unit tests — verification is build + manifest/diff assertions, mirroring the spec's CI-step "Test plan").

---

## Spec references

- Spec under implementation: `docs-fork/specs/07-build.md`
- Shared contract: `docs-fork/specs/00-overview.md` — relevant pieces:
  - **Additive-only fork discipline** — `esbuild.mjs` may gain *only* new entries + a CLI-scoped `vscode` alias; `package.json` may gain *only* `bin`, the standalone scripts, the three runtime deps (already present), the `files` array, and `publishConfig`. The **one** sanctioned modification anywhere is the `name` rename to the fork scope. Every `src/` change is a `+` under `src/standalone/`.
  - **Why the `vscode` alias is required (not optional)** — `panel-shared.ts:7` is a *top-level* `import * as vscode` that runs at module load; the CLI bundle would otherwise need a real `vscode` package at runtime. The alias maps it to the stub deterministically.
  - **"When these come into existence"** — `vscode-stub.ts`, the vitest alias, and `open` are bootstrapped by **02-dispatcher**; `express`/`ws` by **01-server**; `bin/coach` by **05-cli**. 07-build "formalizes the build-side (esbuild) alias and the publish wiring; it does not introduce the stub/alias/dep. Treat their creation as idempotent (check-and-skip if already present)."
  - **Security model / shim delivery** — the shim is served as an **external** `/standalone-shim.js` (CSP `script-src 'self'` forbids inline); the build emits it as a separate browser/iife bundle.

### Dependency note — this is the 7th plan in the queue

`07-build` is blocked by (and so executes after) **05-cli**, which transitively means **all** of 06/02/04/03/01/05 have run. Honor these settled artifacts verbatim — do **not** recreate them:

- **05-cli** (`05-cli.plan.md`): `src/standalone/cli.ts` exports `runCli(argv: string[]): Promise<number>` (named export; **no** self-exec on module load). `bin/coach` already exists with exactly:
  ```js
  #!/usr/bin/env node
  require('../dist/standalone/cli.js').runCli(process.argv)
    .then((code) => process.exit(code))
    .catch((err) => { console.error(err); process.exit(1); });
  ```
- **01-server** (`01-server.plan.md`): `src/standalone/server.ts` imports `express` and `ws`; both are added to `package.json#dependencies` (`express@^4.21.2`, `ws@^8.18.0`). The server serves `/standalone-shim.js` from `dist/standalone/standalone-shim.js` and `/dist/webview` statically — so the build must emit the shim there, and the **existing** webview entry already emits `dist/webview/{app.js,styles.css,sidebar.css}`.
- **04-webview-shim** (`04-webview-shim.plan.md`): the shim entry is `src/standalone/webview-shim.ts`, output `dist/standalone/standalone-shim.js` (browser/iife, loaded via `<script src="/standalone-shim.js">`).
- **02-dispatcher** (`02-dispatcher.plan.md`): `src/standalone/vscode-stub.ts` already exists with the canonical content (below); the vitest `resolve.alias` for `vscode` and the `open@^10.1.0` dep already exist.

Upstream facts verified in-repo (the build must adapt to these, not to the spec's idealized sketch):

- `package.json` (current): `"name": "ai-engineer-coach"`, `"main": "./dist/extension.js"`, `"engines": { "vscode": "^1.118.0" }`, `"engineStrict": true`, `"build": "node esbuild.mjs"`, `"watch": "node esbuild.mjs --watch"`, `"test": "vitest run"`. `@playwright/test@1.60.0` is **already** in `devDependencies`. There is **no** `bin`, `files`, or `publishConfig` key. `dependencies` already include (by the time this plan runs) `express`, `ws`, `open`.
- `esbuild.mjs` (current): uses `esbuild.build({...})` calls collected into `await Promise.all([...])` (line 71), then a separate `if (isWatch) { ... }` block. The **only** CLI flag is `--watch` (`isWatch = process.argv.includes('--watch')`, line 10); there is **no `--target=` selector**. Existing Node entries use `external: ['vscode']`; the webview entry is `platform: 'browser', format: 'iife'`.

### Deliberate deviations from the spec text (all noted inline; none change an observable contract)

1. **`build:standalone` = `node esbuild.mjs`, not `node esbuild.mjs --target=standalone`.** The spec's package.json sketch invents a `--target=standalone` flag, but `esbuild.mjs` has **no** target dispatch (only `--watch`), and the spec's own adaptation note says *"Inspect `esbuild.mjs` at impl time and adapt; do not invent a new pattern."* Adding a flag the script ignores would mislead. The two standalone entries are appended to the **unconditional** build pipeline (the additive rule forbids gating the existing extension entries behind a flag), so *any* invocation of `esbuild.mjs` emits them. This satisfies the spec **Goal** ("`npm run build` produces … `dist/standalone/cli.js`") *and* acceptance #1 ("`npm run build` followed by `npm run build:standalone` produces cli.js **and** standalone-shim.js"). Because `build:standalone` re-runs the full (deterministic) build, "leaves all existing `dist/*` outputs unchanged" is verified as **byte-identical** content (Task 4), not as "files untouched on disk".
2. **An esbuild `footer` makes the CLI bundle self-execute under `require.main === module`.** `cli.ts` only *exports* `runCli` (05-cli) — it does not call it at load. Without help, acceptance #2 (`node dist/standalone/cli.js --version` prints the version) would print nothing. The `footer` runs `runCli(process.argv)` **only** when the bundle is the entry module, so `bin/coach`'s `require('../dist/standalone/cli.js')` (acceptance 2a's bare-require path, and the real launcher path) does **not** trigger it. The spec's optional `banner: { js: '#!/usr/bin/env node' }` is **omitted** — `bin/coach` provides the shebang and `cli.js` is `require()`d, not exec'd directly in production.
3. **`bufferutil` and `utf-8-validate` join `fsevents` in the CLI entry's `external`.** `ws` (bundled into the CLI via `./server`) does `require('bufferutil')` / `require('utf-8-validate')` inside try/catch; these are `ws` *optionalDependencies* that may be absent on a given OS in the Node 20 CI matrix. esbuild resolves requires at build time and would **error** ("Could not resolve") if they are missing. Marking them external makes the build deterministic across macOS/Linux/Windows (acceptance #7); `ws`'s try/catch swallows their runtime absence. The spec lists only `fsevents`; this is the foreseeable adaptation the spec invites.
4. **`name` is set to `@JuliusGruber/ai-engineer-coach`.** The current value is the bare `ai-engineer-coach` — not the publish target. Per the spec Decisions table this is *"the one allowed `name` edit … part of the fork identity, not an upstream modification."* `npm publish` keys the package id off `name`, so acceptance #8 / the Goal require it.
5. **No unit tests; tasks are edit → verify-command → commit.** The spec states *"No unit tests for this spec; it is configuration."* Each task makes an additive edit, runs the exact acceptance/CI command, checks the expected output, and commits. This follows writing-plans' "exact commands with expected output" + "frequent commits" without a RED/GREEN cycle there is no code to drive.
6. **The true `npm install -g`-on-PATH check (acceptance #6) is verified as bin *wiring*, not a real global install.** Installing into the dev's global prefix is invasive and permission-fragile on Windows; the spec's own Test plan assigns the clean-container global install to CI ("install tarball into a clean container, exec `coach`") — i.e. 08-testing. Task 4 verifies the `bin` field maps `coach` → `bin/coach` and that `bin/coach` is in the pack manifest, which is exactly what makes the global install put `coach` on PATH.

## File Structure

| Path | Responsibility | Created/edited by |
|------|----------------|-------------------|
| `esbuild.mjs` | **Additive**: append a `Promise.all` of two `esbuild.build({...})` calls — the Node CLI bundle (with the CLI-scoped `vscode` alias + self-exec `footer`) and the browser shim. Existing entries untouched. | Task 2 |
| `package.json` | **Additive**: add `bin`, six `scripts`, `files`, `publishConfig`, `engines.node`; verify the three runtime deps + `@playwright/test` present. The **one** modification: `name` rename. | Task 3 |
| `bin/coach` | Idempotent: 05-cli created it. Verify present + content matches the canonical launcher; create only if missing. | Task 1 |
| `src/standalone/vscode-stub.ts` | Idempotent: 02-dispatcher created it. Verify present + content matches the canonical stub; never recreate. | Task 1 |

No new source files, no test files. `dist/` is build output (gitignored) and is never committed.

## Conventions to copy (already in the repo)

- esbuild entries use the **object-style `esbuild.build({...})`** call (not a `build()` helper) and are awaited via `Promise.all`, matching `esbuild.mjs:13-71`.
- npm scripts run from the repo root, so esbuild `alias`/`entryPoints` paths are repo-root-relative.
- Commit messages follow the repo's conventional style (`build(standalone): …`, `feat(standalone): …`) used by the sibling plans.
- Verification commands are written bash-style (`git diff … | grep …`, `node -e "…"`) for parity with `02-dispatcher.plan.md` / `05-cli.plan.md`; on Windows run them via the Bash tool / Git Bash. Hashing uses a Node one-liner so it is OS-independent.

### Preconditions

By topological order the following already exist and must **not** be recreated: `src/standalone/cli.ts` (exports `runCli`), `src/standalone/server.ts`, `src/standalone/webview-shim.ts`, `src/standalone/vscode-stub.ts`, `bin/coach`, the `express`/`ws`/`open` deps, the `vitest.config.mts` `vscode` alias, and `@playwright/test`. If `node_modules/` is empty, run `npm install` once. The baseline must be green — `npm test` passes and `npm run build` succeeds — before this plan's edits; a pre-existing failure is an escalation, not introduced here.

---

## Task 1: Preconditions — verify the idempotent foundation (no edits expected)

07-build's "new files" (`bin/coach`, `vscode-stub.ts`) and its three runtime deps were all created by earlier specs. This task confirms they are present and correct so the later tasks are pure build/publish wiring. It edits nothing unless a prerequisite is genuinely missing (which would mean an earlier spec did not run).

**Files:**
- Verify only: `bin/coach`, `src/standalone/vscode-stub.ts`, `package.json`

- [ ] **Step 1: Confirm the three runtime deps and `@playwright/test` are present**

Run:
```bash
node -e "const d=require('./package.json');const dep=d.dependencies||{},dev=d.devDependencies||{};const miss=['express','ws','open'].filter(k=>!dep[k]).concat(dev['@playwright/test']?[]:['@playwright/test(dev)']);console.log(miss.length?('MISSING: '+miss.join(', ')):'all present:',dep.express,dep.ws,dep.open,dev['@playwright/test']);"
```
Expected: `all present: ^4.21.2 ^8.18.0 ^10.1.0 1.60.0` (exact versions may differ but none is `undefined`). If anything prints `MISSING:`, an earlier spec (01-server for express/ws, 02-dispatcher for open) did not run — stop and resolve before continuing. (`@playwright/test` is upstream; if absent, `npm install -D @playwright/test@^1.49.0`.)

- [ ] **Step 2: Confirm `bin/coach` exists with the canonical launcher**

Run:
```bash
cat bin/coach
```
Expected — exactly (created by 05-cli):
```js
#!/usr/bin/env node
require('../dist/standalone/cli.js').runCli(process.argv)
  .then((code) => process.exit(code))
  .catch((err) => { console.error(err); process.exit(1); });
```
If `bin/coach` is missing (05-cli not run), create it with the four lines above. If present but different, do **not** rewrite it — reconcile with 05-cli first (the launcher contract is shared).

- [ ] **Step 3: Confirm `src/standalone/vscode-stub.ts` exists with the canonical stub**

Run:
```bash
cat src/standalone/vscode-stub.ts
```
Expected — the stub 02-dispatcher created (the esbuild alias in Task 2 resolves to this exact file):
```ts
// src/standalone/vscode-stub.ts
// Resolves the transitive `import * as vscode` pulled in by reused webview
// files — panel-shared.ts:7 (via getRpcHandler) — AND satisfies the one live
// call on the standalone path: getDashboardHtml -> vscode.Uri.joinPath
// (panel-html.ts:11), used later by 03-standalone-html.
export const Uri = {
  joinPath: (_base: unknown, ...parts: string[]) => ({
    path: parts.join('/'),
    fsPath: parts.join('/'),
  }),
};
export default { Uri };
```
If missing, an earlier spec did not run — stop. Do **not** recreate it here on top of an existing file.

- [ ] **Step 4: Confirm the baseline build and suite are green**

Run: `npm run build && npm test`
Expected: the build prints `Build complete.` and exits 0; the vitest suite passes. (At this point `dist/standalone/` does **not** yet contain `cli.js`/`standalone-shim.js` — Task 2 adds them.) If either fails on a clean checkout, that is a pre-existing issue to escalate.

- [ ] **Step 5: Commit (only if a prerequisite had to be created)**

If Steps 1–3 found everything present, there is nothing to commit — skip. If you had to create `bin/coach` (Step 2):
```bash
git add bin/coach
git commit -m "build(standalone): add bin/coach launcher (07-build precondition)"
```

---

## Task 2: `esbuild.mjs` — append the standalone CLI + shim build entries

The core deliverable. Append a `Promise.all` of two `esbuild.build({...})` calls right after the existing asset-copy section and **before** `console.log('Build complete.')`, so the existing entries are untouched and "Build complete." still means *everything* built. The CLI entry carries the CLI-scoped `vscode` alias and the self-exec `footer`; the shim entry is a separate browser bundle. Covers acceptance #1 (build emits both outputs), #2 (`--version`), #2a (bare require no-throw), #2b (extension keeps real `vscode`).

**Files:**
- Modify: `esbuild.mjs` (additive append, between the sidebar-CSS copy and the `Build complete.` log)

- [ ] **Step 1: Append the two standalone build entries**

In `esbuild.mjs`, find this existing line (currently `esbuild.mjs:114`):
```js
fs.copyFileSync('src/webview/styles-sidebar.css', path.join(webviewDist, 'sidebar.css'));
```
Insert the following block **immediately after** it (and immediately before the blank line + `console.log('Build complete.');`):
```js

// --- Standalone fork bundles (additive; see docs-fork/specs/07-build.md) ----------
// Appended WITHOUT gating the extension/worker entries above (additive-only fork
// rule), so `npm run build` AND `npm run build:standalone` both emit these. The
// `vscode` alias is scoped to the CLI entry ONLY; the extension/worker builds keep
// `external: ['vscode']`, so the alias never leaks into the published extension.
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
]);
```

Do **not** touch the `extensionBuild`/`workerBuild`/`parseWorkerBuild`/`cacheWriteWorkerBuild`/`webviewBuild` entries, the top `Promise.all` (line 71), or the `if (isWatch)` block.

- [ ] **Step 2: Build and confirm both standalone outputs appear**

Run:
```bash
npm run build && node -e "const f=require('fs');for (const p of ['dist/standalone/cli.js','dist/standalone/standalone-shim.js','dist/extension.js','dist/webview/app.js']) console.log(f.existsSync(p)?'OK '+p:'MISSING '+p);"
```
Expected: four `OK` lines (no `MISSING`). The build prints `Build complete.` and exits 0. (Acceptance #1: `npm run build` produces `dist/standalone/cli.js` **and** the shim, alongside the unchanged extension/webview outputs.)

- [ ] **Step 3: Verify `--version` prints the package version (acceptance #2)**

Run: `node dist/standalone/cli.js --version`
Expected: prints `0.1.0` (the current `package.json` version), exit 0. This proves the `footer`'s `require.main === module` self-exec works. If it prints nothing, the footer was not applied to the CLI entry.

- [ ] **Step 4: Verify a bare require does not throw — the `vscode` alias worked (acceptance #2a)**

Run: `node -e "require('./dist/standalone/cli.js'); console.log('loaded ok')"`
Expected: prints `loaded ok` (no stack trace, no `Cannot find module 'vscode'`). Because this is `node -e`, `require.main !== module`, so the footer does **not** run `runCli` — the test isolates "the bundle *loads*", proving the alias neutralized the transitive top-level `import * as vscode`. If it throws `Cannot find module 'vscode'`, the alias did not resolve — see Step 6.

- [ ] **Step 5: Verify the extension bundle still requires real `vscode` (acceptance #2b — no alias leak)**

Run:
```bash
grep -c 'require("vscode")' dist/extension.js
```
Expected: `1` or more (a non-zero count). The extension entry's `external: ['vscode']` compiles `import * as vscode` to `require("vscode")`; the standalone alias lives only in the CLI entry's options object and cannot reach this separate `esbuild.build` call. If the count is `0`, the alias leaked into the extension build — confirm you added `alias` only inside the **CLI** entry above, not anywhere shared.

- [ ] **Step 6 (only if Step 4 threw): make the alias path absolute**

esbuild resolves a relative `alias` target from the working directory; if your esbuild version reports it cannot resolve `./src/standalone/vscode-stub.ts`, replace the alias value with an absolute path. At the top of `esbuild.mjs` `path` is already imported, so change the alias line to:
```js
      vscode: path.resolve('src/standalone/vscode-stub.ts'),
```
Re-run Step 4. (Skip this step entirely if Step 4 already passed.)

- [ ] **Step 7: Commit**

```bash
git add esbuild.mjs
git commit -m "build(standalone): bundle cli.js and standalone-shim.js via esbuild"
```

---

## Task 3: `package.json` — publish wiring (`bin`, scripts, `files`, `publishConfig`, `engines.node`, `name`)

Adds the publish payload allowlist and the standalone scripts, sets the `engines.node` floor, and applies the one sanctioned `name` rename. Covers acceptance #3 (exact pack manifest) and the `serve`/`build:standalone` script existence.

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Rename `name` to the fork scope (the one sanctioned modification)**

Change line 2 of `package.json`:
```jsonc
  "name": "ai-engineer-coach",
```
to:
```jsonc
  "name": "@JuliusGruber/ai-engineer-coach",
```
(Per `07-build.md` Decisions: the single allowed `name` edit; `npm publish` keys the package id off it.)

- [ ] **Step 2: Add `node` to `engines`**

Change the existing `engines` block:
```jsonc
  "engines": {
    "vscode": "^1.118.0"
  },
```
to (additive — new key only):
```jsonc
  "engines": {
    "vscode": "^1.118.0",
    "node": ">=20"
  },
```

- [ ] **Step 3: Append the six standalone scripts**

Inside `"scripts"`, after the existing `"prepare": "husky"` line, add (additive — all new keys; mind the trailing comma after `husky`):
```jsonc
    "prepare": "husky",
    "serve": "node ./dist/standalone/cli.js",
    "dev:standalone": "node --watch ./dist/standalone/cli.js",
    "build:standalone": "node esbuild.mjs",
    "test:integration:standalone": "vitest run tests/standalone/integration",
    "test:playwright:standalone": "playwright test --config=tests/standalone/playwright/playwright.config.ts",
    "pack:check": "npm pack --dry-run"
```
Notes: `build:standalone` is `node esbuild.mjs` (deviation #1 — no `--target=` selector exists; the appended entries build on every invocation). The two `test:*:standalone` scripts reference `tests/standalone/**` paths that **08-testing** creates; they are inert until then but are declared here to keep the `package.json` diff in one spec (`07-build.md` Dependencies: "declared here so the additive … diff is in one place").

- [ ] **Step 4: Add the `bin`, `files`, and `publishConfig` top-level keys**

Add these three new top-level keys (additive — none exist today). Place `bin` next to `main`, and `files`/`publishConfig` at the end of the object (before the closing `}`):
```jsonc
  "bin": {
    "coach": "bin/coach"
  },
```
and, as the last two keys:
```jsonc
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
```
Do **not** add `express`/`ws`/`open` to `dependencies` or `@playwright/test` to `devDependencies` — Task 1 confirmed all four are already present (re-adding would either no-op or churn versions; leave existing values untouched per the additive rule).

- [ ] **Step 5: Confirm `package.json` is still valid JSON and the keys landed**

Run:
```bash
node -e "const d=require('./package.json');console.log(d.name, '| bin.coach='+d.bin.coach, '| node='+d.engines.node, '| access='+d.publishConfig.access, '| files='+d.files.length, '| build:standalone='+JSON.stringify(d.scripts['build:standalone']));"
```
Expected: `@JuliusGruber/ai-engineer-coach | bin.coach=bin/coach | node=>=20 | access=public | files=6 | build:standalone="node esbuild.mjs"`. A `SyntaxError` means a comma/brace slip — fix before continuing.

- [ ] **Step 6: Verify the pack manifest is exactly the allowlisted paths (acceptance #3)**

Ensure a fresh build exists, then check the dry-run manifest:
```bash
npm run build && npm pack --dry-run --json 2>/dev/null | node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const files=JSON.parse(s)[0].files.map(f=>f.path).sort();const okRoots=['dist/standalone/','dist/webview/','bin/coach','LICENSE','NOTICE','README.md','package.json'];const bad=files.filter(p=>!okRoots.some(r=>r.endsWith('/')?p.startsWith(r):p===r));const need=['bin/coach','dist/standalone/cli.js','dist/standalone/standalone-shim.js','LICENSE','NOTICE','README.md','package.json'].filter(p=>!files.includes(p));console.log('FILES:',files.join(', '));console.log(bad.length?('UNEXPECTED: '+bad.join(', ')):'no unexpected paths');console.log(need.length?('MISSING REQUIRED: '+need.join(', ')):'all required present');});"
```
Expected: the `FILES:` line lists only paths under `dist/standalone/`, `dist/webview/`, plus `bin/coach`, `LICENSE`, `NOTICE`, `README.md`, `package.json`; then `no unexpected paths` and `all required present`. Crucially **no `dist/extension.js`, no `src/`** (verified: the npm 10 `files` allowlist does not force-include the `main` file). If `UNEXPECTED:` lists anything, a `files` entry is too broad; if `MISSING REQUIRED:` fires, re-run the build (Task 2) so the standalone outputs exist.

- [ ] **Step 7: Commit**

```bash
git add package.json
git commit -m "build(standalone): add bin, publish files allowlist, and standalone scripts"
```

---

## Task 4: Verification — idempotency, "existing dist unchanged", additive-only diffs

Final gate. Confirms `build:standalone` is deterministic, does not alter existing `dist/*` content, that the fork diff against upstream is additions-only (the `name` rename excepted), and that the `bin` wiring satisfies the global-install acceptance.

**Files:** none (verification only).

- [ ] **Step 1: Build idempotency — `cli.js` is byte-identical across two builds (Test plan: "Build idempotency")**

Run:
```bash
npm run build >/dev/null 2>&1 && node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('dist/standalone/cli.js')).digest('hex'))" > /tmp/h1.txt && npm run build >/dev/null 2>&1 && node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('dist/standalone/cli.js')).digest('hex'))" > /tmp/h2.txt && diff /tmp/h1.txt /tmp/h2.txt && echo "IDENTICAL"
```
Expected: `IDENTICAL` (the two SHA-256 hashes match; `diff` is silent). If they differ, something non-deterministic crept into the CLI bundle — investigate before publishing.

- [ ] **Step 2: `build:standalone` leaves the extension bundle's content unchanged (acceptance #1)**

Run:
```bash
node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('dist/extension.js')).digest('hex'))" > /tmp/ext-before.txt && npm run build:standalone >/dev/null 2>&1 && node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('dist/extension.js')).digest('hex'))" > /tmp/ext-after.txt && diff /tmp/ext-before.txt /tmp/ext-after.txt && echo "EXTENSION UNCHANGED"
```
Expected: `EXTENSION UNCHANGED`. `build:standalone` re-runs the full deterministic build, so `dist/extension.js` is rewritten with byte-identical content (deviation #1: "unchanged" = identical content).

- [ ] **Step 3: Additive-only — `src/` shows only additions under `src/standalone/` (acceptance #4)**

Run:
```bash
git diff upstream/main -- src/ | grep -E '^[-+]' | grep -vE '^[-+]{3}'
```
Expected: every line is an addition (`+`) and every added line is inside `src/standalone/`. **No** deletions (`-`), no edits to files outside `src/standalone/`. (07-build adds no `src/` files itself; this confirms the cumulative fork state through this plan. If `upstream/main` is not configured: `git remote add upstream <url> && git fetch upstream`.)

- [ ] **Step 4: Additive-only — `package.json` / `esbuild.mjs` show additions only, except the `name` rename (acceptance #5)**

Run:
```bash
git diff upstream/main -- package.json esbuild.mjs | grep -E '^[-+]' | grep -vE '^[-+]{3}'
```
Expected: the only `-` line is the old `"name": "ai-engineer-coach",` (paired with the `+ "name": "@JuliusGruber/ai-engineer-coach",`); every other changed line is a `+` addition (the `engines.node` key, the six scripts, `bin`, `files`, `publishConfig`, and the two appended esbuild entries). No other removals or in-place edits of existing values. The single `name` `-/+` pair is the documented exception.

- [ ] **Step 5: Confirm the `bin` wiring that makes `coach` available on PATH (acceptance #6)**

Run:
```bash
node -e "const d=require('./package.json');const f=require('fs');console.log('bin.coach=',d.bin&&d.bin.coach, '| launcher exists:', f.existsSync('bin/coach'), '| shebang:', f.readFileSync('bin/coach','utf8').startsWith('#!/usr/bin/env node'));"
```
Expected: `bin.coach= bin/coach | launcher exists: true | shebang: true`. On `npm install -g`, npm creates the `coach` symlink/`.cmd` shim from this `bin` field + shebang, putting `coach` on PATH. (The end-to-end clean-container global install + `coach --version` is 08-testing's CI step — deviation #6.)

- [ ] **Step 6: Final commit (only if Steps 1–5 required a fix)**

If Steps 1–5 surfaced nothing to change, there is nothing to commit — this task is verification-only. If a fix to `esbuild.mjs` or `package.json` was needed:
```bash
git add esbuild.mjs package.json
git commit -m "build(standalone): finalize additive build/publish wiring"
```

---

## Self-Review

### Spec coverage (`07-build.md`)

| Spec item | Task | Verification / artifact |
|---|---|---|
| `package.json` additive keys (`bin`, scripts, deps, `files`, `publishConfig`, `engines.node`) | Task 3 (Task 1 confirms deps already present) | Step 5 key dump; Step 6 manifest |
| `name` rename to `@JuliusGruber/ai-engineer-coach` | Task 3 Step 1 | Step 5 dump (`@JuliusGruber/…`); Task 4 Step 4 (the one `-/+` pair) |
| `esbuild.mjs` two new entries (CLI + shim) + CLI-scoped `vscode` alias | Task 2 | Step 2 (both outputs exist) |
| `vscode-stub.ts` is the alias target (minimal `Uri.joinPath`) | Task 1 Step 3 (verify, idempotent) | content match |
| `bin/coach` launcher | Task 1 Step 2 (verify/create, idempotent) | Task 4 Step 5 |
| Acceptance #1 — build + build:standalone → cli.js + shim, existing dist unchanged | Tasks 2, 4 | Task 2 Step 2; Task 4 Steps 1–2 |
| Acceptance #2 — `node dist/standalone/cli.js --version` prints version | Task 2 Step 3 | footer self-exec |
| Acceptance #2a — bare `require` does not throw (alias neutralized transitive `vscode`) | Task 2 Step 4 | `node -e "require(...)"` |
| Acceptance #2b — extension bundle still externalizes `vscode` (no alias leak) | Task 2 Step 5 | `grep require("vscode") dist/extension.js` |
| Acceptance #3 — pack manifest exactly the allowlist, no others | Task 3 Step 6 | `npm pack --dry-run --json` parse |
| Acceptance #4 — `git diff upstream/main -- src/` additions under `src/standalone/` only | Task 4 Step 3 | diff/grep |
| Acceptance #5 — `package.json`/`esbuild.mjs` additions only (name excepted) | Task 4 Step 4 | diff/grep |
| Acceptance #6 — global install puts `coach` on PATH | Task 4 Step 5 (bin wiring) + 08-testing CI (true install) | bin/shebang check |
| Test plan: tarball contents | Task 3 Step 6 | manifest parse |
| Test plan: `coach --version` after install | Task 2 Step 3 (direct) + 08-testing CI | footer |
| Test plan: upstream-diff guard | Task 4 Steps 3–4 | diff/grep |
| Test plan: build idempotency | Task 4 Step 1 | byte-identical `cli.js` |

### Placeholder scan

No `TBD`/`TODO`/"handle edge cases"/"similar to Task N". Every edit step shows the exact text to insert and where; every verification step shows the exact command and expected output. The `tests/standalone/**` paths in the two `test:*:standalone` scripts are real future targets owned by 08-testing (flagged inline), not placeholders — the script strings are complete and correct as written.

### Type / name consistency

- The esbuild CLI entry's `outfile: 'dist/standalone/cli.js'` matches `bin/coach`'s `require('../dist/standalone/cli.js')` (05-cli) and the `serve`/`dev:standalone` scripts' `node ./dist/standalone/cli.js`.
- The shim entry's `entryPoints: ['src/standalone/webview-shim.ts']` → `outfile: 'dist/standalone/standalone-shim.js'` matches 04-webview-shim's source name and 01-server's `resolveShimPath()` (`dist/standalone/standalone-shim.js`).
- The alias target `'./src/standalone/vscode-stub.ts'` matches the file 02-dispatcher created and the vitest `resolve.alias` target — one stub, two build systems (esbuild + vitest), identical path.
- The footer calls `module.exports.runCli` — `cli.ts` exports `runCli` as a **named** export (05-cli), which in the CJS bundle is `module.exports.runCli`. `runCli(argv): Promise<number>` resolves the exit code the footer feeds to `process.exit`, exactly as `bin/coach` does.
- `files: ["dist/standalone/", "dist/webview/", "bin/", "LICENSE", "NOTICE", "README.md"]` — every literal path exists at repo root (`LICENSE`/`NOTICE`/`README.md` confirmed) or is produced by a build (`dist/standalone/**` by Task 2, `dist/webview/**` by the untouched webview entry, `bin/coach` by 05-cli).
