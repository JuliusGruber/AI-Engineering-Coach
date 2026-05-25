# Build Glue (07-build) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `@JuliusGruber/ai-engineer-coach` build and publish by *additively* appending five standalone esbuild entries to `esbuild.mjs` — the Node CLI bundle `dist/standalone/cli.js`, the browser shim `dist/standalone/standalone-shim.js`, and the three core Worker scripts the CLI spawns by `__dirname`-relative path at runtime (`dist/standalone/{parse-worker,warm-up-worker,cache-write-worker}.js`) — plus copying the built-in `rules/`+`metrics/` markdown into `dist/standalone/`, and adding `bin`/`scripts`/`files`/`publishConfig`/`engines.node` (plus the one sanctioned `name` rename) to `package.json` — without modifying any existing extension build entry or `package.json` key.

**Architecture:** This spec produces **no runtime source** — it is build/config glue (`00-overview.md` LOC table: "~5 (config)"). The CLI bundle pulls a transitive top-level `import * as vscode` (via `./server` → `dispatcher` → `panel-rpc` → `panel-shared.ts:7`) and one live `vscode.Uri.joinPath` (via `getDashboardHtml`); a `vscode` → `src/standalone/vscode-stub.ts` **alias scoped to the CLI entry only** neutralizes both, while the untouched extension/worker entries keep `external: ['vscode']`. `bin/coach` `require()`s the bundle and calls `runCli`; an esbuild `footer` guarded by `require.main === module` lets `node dist/standalone/cli.js` self-execute (so `--version` prints) without double-invoking on the `bin/coach` path.

The CLI bundle lives at `dist/standalone/cli.js`, so at runtime its CJS `__dirname` is `dist/standalone/`. The **reused core** resolves several assets relative to `__dirname`: it spawns three Worker scripts — `parse-worker.js` (`parser.ts:638`, `child_process.fork`, on the standalone parse path via `parse-bootstrap.ts`), `warm-up-worker.js` (`analyzer.ts:135`), `cache-write-worker.js` (`cache.ts:317`) — and reads built-in **rules** (`rule-loader.ts:64`, `__dirname/rules`) and **metrics** (`rule-loader.ts:222`, `__dirname/metrics`). Those `registerAllBuiltin*` calls fire as **module-load side effects** of `detector-registry.ts:14-15`, which is pulled in by *both* `new Analyzer(...)` (analyzer-patterns → detector-registry) and the dispatch path (`panel-rpc.ts:23`). The existing extension copies workers to `dist/*.js` and rules/metrics to `dist/{rules,metrics}` (its own `__dirname` is `dist/`), but the standalone bundle looks under `dist/standalone/`. So 07-build **additionally** emits the three workers and copies rules+metrics into `dist/standalone/`; `files: ["dist/standalone/"]` then ships them and the bundle's `__dirname` resolves them — in dev *and* in the published tarball. Without this, `coach` hard-crashes on the first real parse (missing `dist/standalone/parse-worker.js`) and the dashboard's anti-pattern scores (`page-dashboard.ts:194` `getAntiPatterns`) come back empty (no built-in rules registered). Everything else this spec "introduces" — the `vscode-stub.ts` file, the `open`/`express`/`ws` deps, `@playwright/test`, and `bin/coach` itself — was already created by earlier specs (02-dispatcher, 01-server, 05-cli); 07-build *formalizes the build side* and treats those as idempotent check-and-skip.

**Tech Stack:** esbuild 0.28 (already in devDeps; `esbuild.build({...})` style as used by the existing `esbuild.mjs`), Node 20+ (CJS bundle target `node20`; worker entries mirror the extension's `es2022`/`node`/`cjs`/`external:['vscode']` config), npm 10 (`npm pack`/`files` allowlist for the publish payload). No new dependencies, no test framework usage (this spec has no unit tests — verification is build + manifest/diff assertions, mirroring the spec's CI-step "Test plan").

---

## Spec references

- Spec under implementation: `docs-fork/specs/07-build.md`
- Shared contract: `docs-fork/specs/00-overview.md` — relevant pieces:
  - **Additive-only fork discipline** — `esbuild.mjs` may gain *only* new entries + a CLI-scoped `vscode` alias; `package.json` may gain *only* `bin`, the standalone scripts, the three runtime deps (already present), the `files` array, and `publishConfig`. The **one** sanctioned modification anywhere is the `name` rename to the fork scope. Every `src/` change is a `+` under `src/standalone/`.
  - **Why the `vscode` alias is required (not optional)** — `panel-shared.ts:7` is a *top-level* `import * as vscode` that runs at module load; the CLI bundle would otherwise need a real `vscode` package at runtime. The alias maps it to the stub deterministically.
  - **"When these come into existence"** — `vscode-stub.ts`, the vitest alias, and `open` are bootstrapped by **02-dispatcher**; `express`/`ws` by **01-server**; `bin/coach` by **05-cli**. 07-build "formalizes the build-side (esbuild) alias and the publish wiring; it does not introduce the stub/alias/dep. Treat their creation as idempotent (check-and-skip if already present)."
  - **Security model / shim delivery** — the shim is served as an **external** `/standalone-shim.js` (CSP `script-src 'self'` forbids inline); the build emits it as a separate browser/iife bundle.
  - **Acceptance #1 / #3** — `coach` boots and "dashboard renders end-to-end" with "real data" on every visible analytics page. The dashboard calls `getAntiPatterns` (built-in rules) and the parse path spawns `parse-worker.js`; both depend on the `dist/standalone/` asset placement this plan adds (see deviation #7).

### Dependency note — this is the 7th plan in the queue

`07-build` is blocked by (and so executes after) **05-cli**, which transitively means **all** of 06/02/04/03/01/05 have run. Honor these settled artifacts verbatim — do **not** recreate them:

- **05-cli** (`05-cli.plan.md`): `src/standalone/cli.ts` exports `runCli(argv: string[]): Promise<number>` (named export; **no** self-exec on module load). `bin/coach` already exists with exactly:
  ```js
  #!/usr/bin/env node
  require('../dist/standalone/cli.js').runCli(process.argv)
    .then((code) => process.exit(code))
    .catch((err) => { console.error(err); process.exit(1); });
  ```
  `parse-bootstrap.ts` (05-cli) calls `parseAllLogsViaWorker(dirs)` whenever `findLogsDirs()` is non-empty (the real-user case) — i.e. the standalone boot **forks `dist/standalone/parse-worker.js`**. There is no in-process fallback (`parser.ts:735-743` retries only memory errors), so a missing worker rejects `bootstrapParse` → `runCli` → `bin/coach` exit 1, leaving the open browser stuck on the loading shell. This plan therefore must emit that worker (Task 2).
- **01-server** (`01-server.plan.md`): `src/standalone/server.ts` imports `express` and `ws`; both are added to `package.json#dependencies` (`express@^4.21.2`, `ws@^8.18.0`). The server serves `/standalone-shim.js` from `dist/standalone/standalone-shim.js` and `/dist/webview` statically (from `resolveProjectRoot()/dist/webview`, where `resolveProjectRoot` is `import.meta.url` → `../..` = package root) — so the build must emit the shim there, and the **existing** webview entry already emits `dist/webview/{app.js,styles.css,sidebar.css}`. Note the asymmetry: the server resolves `dist/webview` from the **package root** via `import.meta.url`, while the core resolves the workers/rules/metrics from `__dirname` = `dist/standalone`. Both are satisfied under this plan (webview at `dist/webview/`, the rest under `dist/standalone/`).
- **04-webview-shim** (`04-webview-shim.plan.md`): the shim entry is `src/standalone/webview-shim.ts`, output `dist/standalone/standalone-shim.js` (browser/iife, loaded via `<script src="/standalone-shim.js">`).
- **02-dispatcher** (`02-dispatcher.plan.md`): `src/standalone/vscode-stub.ts` already exists with the canonical content (below); the vitest `resolve.alias` for `vscode` and the `open@^10.1.0` dep already exist.

Upstream facts verified in-repo (the build must adapt to these, not to the spec's idealized sketch):

- `package.json` (current): `"name": "ai-engineer-coach"`, `"main": "./dist/extension.js"`, `"engines": { "vscode": "^1.118.0" }`, `"engineStrict": true`, `"build": "node esbuild.mjs"`, `"watch": "node esbuild.mjs --watch"`, `"test": "vitest run"`. `@playwright/test@1.60.0` is **already** in `devDependencies`. There is **no** `bin`, `files`, or `publishConfig` key. `dependencies` already include (by the time this plan runs) `express`, `ws`, `open`.
- `esbuild.mjs` (current): uses `esbuild.build({...})` calls collected into `await Promise.all([...])` (line 71), then the asset-copy section (rules → `dist/rules`, metrics → `dist/metrics`, css, sidebar.css), then a separate `if (isWatch) { ... }` block. The **only** CLI flag is `--watch` (`isWatch = process.argv.includes('--watch')`, line 10); there is **no `--target=` selector**. Existing Node entries (extension + three workers) use `external: ['vscode']`, `platform: 'node'`, `format: 'cjs'`, `target: 'es2022'`; the webview entry is `platform: 'browser', format: 'iife'`. `fs` and `path` are imported at the top (lines 7-8).
- The three worker entry sources exist and build today: `src/core/parse-worker.ts`, `src/core/warm-up-worker.ts`, `src/core/cache-write-worker.ts` (esbuild.mjs:25-58). The parse pipeline they bundle is **vscode-free at runtime** — proven, because the extension already `fork`s `dist/parse-worker.js` as a plain child process (no `vscode` module available there), so `external: ['vscode']` is never actually `require()`d.
- Built-in rule/metric sources: `src/core/rules/*.md` and `src/core/metrics/*.metric.md` (copied to `dist/rules`/`dist/metrics` by esbuild.mjs:77-95 for the extension).

### Deliberate deviations from the spec text (all noted inline; none change an observable contract)

1. **`build:standalone` = `node esbuild.mjs`, not `node esbuild.mjs --target=standalone`.** The spec's package.json sketch invents a `--target=standalone` flag, but `esbuild.mjs` has **no** target dispatch (only `--watch`), and the spec's own adaptation note says *"Inspect `esbuild.mjs` at impl time and adapt; do not invent a new pattern."* Adding a flag the script ignores would mislead. The standalone entries are appended to the **unconditional** build pipeline (the additive rule forbids gating the existing extension entries behind a flag), so *any* invocation of `esbuild.mjs` emits them. This satisfies the spec **Goal** ("`npm run build` produces … `dist/standalone/cli.js`") *and* acceptance #1 ("`npm run build` followed by `npm run build:standalone` produces cli.js **and** standalone-shim.js"). Because `build:standalone` re-runs the full (deterministic) build, "leaves all existing `dist/*` outputs unchanged" is verified as **byte-identical** content (Task 4), not as "files untouched on disk".
2. **An esbuild `footer` makes the CLI bundle self-execute under `require.main === module`.** `cli.ts` only *exports* `runCli` (05-cli) — it does not call it at load. Without help, acceptance #2 (`node dist/standalone/cli.js --version` prints the version) would print nothing. The `footer` runs `runCli(process.argv)` **only** when the bundle is the entry module, so `bin/coach`'s `require('../dist/standalone/cli.js')` (acceptance 2a's bare-require path, and the real launcher path) does **not** trigger it. The spec's optional `banner: { js: '#!/usr/bin/env node' }` is **omitted** — `bin/coach` provides the shebang and `cli.js` is `require()`d, not exec'd directly in production.
3. **`bufferutil` and `utf-8-validate` join `fsevents` in the CLI entry's `external`.** `ws` (bundled into the CLI via `./server`) does `require('bufferutil')` / `require('utf-8-validate')` inside try/catch; these are `ws` *optionalDependencies* that may be absent on a given OS in the Node 20 CI matrix. esbuild resolves requires at build time and would **error** ("Could not resolve") if they are missing. Marking them external makes the build deterministic across macOS/Linux/Windows (acceptance #7); `ws`'s try/catch swallows their runtime absence. The spec lists only `fsevents`; this is the foreseeable adaptation the spec invites. (The three worker entries do **not** bundle `ws`, so they keep just `external: ['vscode']`, exactly like the extension's worker entries.)
4. **`name` is set to `@JuliusGruber/ai-engineer-coach`.** The current value is the bare `ai-engineer-coach` — not the publish target. Per the spec Decisions table this is *"the one allowed `name` edit … part of the fork identity, not an upstream modification."* `npm publish` keys the package id off `name`, so acceptance #8 / the Goal require it.
5. **No unit tests; tasks are edit → verify-command → commit.** The spec states *"No unit tests for this spec; it is configuration."* Each task makes an additive edit, runs the exact acceptance/CI command, checks the expected output, and commits. This follows writing-plans' "exact commands with expected output" + "frequent commits" without a RED/GREEN cycle there is no code to drive.
6. **The true `npm install -g`-on-PATH check (acceptance #6) is verified as bin *wiring*, not a real global install.** Installing into the dev's global prefix is invasive and permission-fragile on Windows; the spec's own Test plan assigns the clean-container global install to CI ("install tarball into a clean container, exec `coach`") — i.e. 08-testing. Task 4 verifies the `bin` field maps `coach` → `bin/coach` and that `bin/coach` is in the pack manifest, which is exactly what makes the global install put `coach` on PATH.
7. **07-build emits three Worker bundles and copies rules/metrics into `dist/standalone/` (beyond the spec's "two entries").** The spec sketch appends only the CLI + shim entries and a `files` allowlist with no `dist/rules`/`dist/metrics`/worker paths. But the standalone CLI bundle's runtime `__dirname` is `dist/standalone/`, and the reused core resolves `parse-worker.js`/`warm-up-worker.js`/`cache-write-worker.js` (via `path.join(__dirname, …)`) and `__dirname/rules` + `__dirname/metrics` from there. The extension's copies land in `dist/` (its `__dirname`), so the standalone bundle would not find them: the parse path would hard-crash and the dashboard's anti-pattern/metric data would be empty (acceptance #1/#3). 07-build is the spec that owns both the esbuild output layout and the `files` allowlist, so the fix lives here: emit the three workers and copy rules+metrics under `dist/standalone/`. The spec's manifest enumeration is **"`dist/standalone/**`"** (a recursive glob), so these new paths are already inside the allowed set — acceptance #3 stays self-consistent and `files: ["dist/standalone/"]` is unchanged. The worker entries mirror the proven extension worker config (`platform:'node'`, `target:'es2022'`, `format:'cjs'`, `external:['vscode']`) with `sourcemap:false` for the publish payload. (Decided with the plan author; the end-to-end parse round-trip remains 08-testing's smoke step.)

## File Structure

| Path | Responsibility | Created/edited by |
|------|----------------|-------------------|
| `esbuild.mjs` | **Additive**: append a `Promise.all` of five `esbuild.build({...})` calls — the Node CLI bundle (CLI-scoped `vscode` alias + self-exec `footer`), the browser shim, and the three core Worker bundles emitted to `dist/standalone/` — then copy `src/core/rules/*.md` → `dist/standalone/rules/` and `src/core/metrics/*.metric.md` → `dist/standalone/metrics/`. Existing entries + the existing `dist/{rules,metrics}` copies untouched. | Task 2 |
| `package.json` | **Additive**: add `bin`, six `scripts`, `files`, `publishConfig`, `engines.node`; verify the three runtime deps + `@playwright/test` present. The **one** modification: `name` rename. | Task 3 |
| `bin/coach` | Idempotent: 05-cli created it. Verify present + content matches the canonical launcher; create only if missing. | Task 1 |
| `src/standalone/vscode-stub.ts` | Idempotent: 02-dispatcher created it. Verify present + content matches the canonical stub; never recreate. | Task 1 |

No new source files, no test files. `dist/` is build output (gitignored) and is never committed.

## Conventions to copy (already in the repo)

- esbuild entries use the **object-style `esbuild.build({...})`** call (not a `build()` helper) and are awaited via `Promise.all`, matching `esbuild.mjs:13-71`. The asset-copy idiom (`fs.mkdirSync(dir, { recursive: true })` + `fs.readdirSync(src).filter(...).forEach(copyFileSync)`) matches `esbuild.mjs:77-95`.
- npm scripts run from the repo root, so esbuild `alias`/`entryPoints`/copy paths are repo-root-relative.
- Worker esbuild entries mirror the existing extension worker entries (`esbuild.mjs:25-58`): `platform:'node'`, `target:'es2022'`, `format:'cjs'`, `bundle:true`, `external:['vscode']` — the only standalone changes are the `outfile` (under `dist/standalone/`) and `sourcemap:false`.
- Commit messages follow the repo's conventional style (`build(standalone): …`, `feat(standalone): …`) used by the sibling plans.
- Verification commands are written bash-style (`git diff … | grep …`, `node -e "…"`) for parity with `02-dispatcher.plan.md` / `05-cli.plan.md`; on Windows run them via the Bash tool / Git Bash. Hashing uses a Node one-liner so it is OS-independent.

### Preconditions

By topological order the following already exist and must **not** be recreated: `src/standalone/cli.ts` (exports `runCli`), `src/standalone/server.ts`, `src/standalone/webview-shim.ts`, `src/standalone/vscode-stub.ts`, `bin/coach`, the `express`/`ws`/`open` deps, the `vitest.config.mts` `vscode` alias, and `@playwright/test`. The three worker sources (`src/core/{parse-worker,warm-up-worker,cache-write-worker}.ts`) and the rule/metric sources (`src/core/rules/*.md`, `src/core/metrics/*.metric.md`) are upstream and already build/copy for the extension. If `node_modules/` is empty, run `npm install` once. The baseline must be green — `npm test` passes and `npm run build` succeeds — before this plan's edits; a pre-existing failure is an escalation, not introduced here.

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

- [ ] **Step 4: Confirm the worker + rule/metric sources exist (07-build copies them, never authors them)**

Run:
```bash
node -e "const f=require('fs');const w=['src/core/parse-worker.ts','src/core/warm-up-worker.ts','src/core/cache-write-worker.ts'].filter(p=>!f.existsSync(p));const r=f.existsSync('src/core/rules')?f.readdirSync('src/core/rules').filter(x=>x.endsWith('.md')).length:0;const m=f.existsSync('src/core/metrics')?f.readdirSync('src/core/metrics').filter(x=>x.endsWith('.metric.md')).length:0;console.log(w.length?('MISSING WORKERS: '+w.join(', ')):'workers present');console.log('rules='+r,'metrics='+m);"
```
Expected: `workers present` and `rules=<n>` / `metrics=<n>` both `> 0`. These are upstream sources; if any is missing, the checkout is broken (escalate) — 07-build does not create them.

- [ ] **Step 5: Confirm the baseline build and suite are green**

Run: `npm run build && npm test`
Expected: the build prints `Build complete.` and exits 0; the vitest suite passes. (At this point `dist/standalone/` does **not** yet contain the standalone outputs — Task 2 adds them.) If either fails on a clean checkout, that is a pre-existing issue to escalate.

- [ ] **Step 6: Commit (only if a prerequisite had to be created)**

If Steps 1–4 found everything present, there is nothing to commit — skip. If you had to create `bin/coach` (Step 2):
```bash
git add bin/coach
git commit -m "build(standalone): add bin/coach launcher (07-build precondition)"
```

---

## Task 2: `esbuild.mjs` — append the standalone CLI, shim, and Worker bundles + copy rules/metrics

The core deliverable. Append a `Promise.all` of five `esbuild.build({...})` calls right after the existing asset-copy section and **before** `console.log('Build complete.')`, then a small rules/metrics copy loop — so the existing entries are untouched and "Build complete." still means *everything* built. The CLI entry carries the CLI-scoped `vscode` alias and the self-exec `footer`; the shim entry is a separate browser bundle; the three worker entries are emitted under `dist/standalone/` (the CLI bundle's runtime `__dirname`) so the reused core can spawn them; the rules/metrics copy puts the built-in markdown where `rule-loader.ts` reads it. Covers acceptance #1 (build emits both named outputs), #2 (`--version`), #2a (bare require no-throw), #2b (extension keeps real `vscode`), and the runtime-asset placement deviation #7 depends on (acceptance #1/#3).

**Files:**
- Modify: `esbuild.mjs` (additive append, between the sidebar-CSS copy and the `Build complete.` log)

- [ ] **Step 1: Append the standalone build entries and the rules/metrics copy**

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
```

Do **not** touch the `extensionBuild`/`workerBuild`/`parseWorkerBuild`/`cacheWriteWorkerBuild`/`webviewBuild` entries, the top `Promise.all` (line 71), the existing `dist/rules`/`dist/metrics` copy section, or the `if (isWatch)` block.

- [ ] **Step 2: Build and confirm every standalone output appears**

Run:
```bash
npm run build && node -e "const f=require('fs');for (const p of ['dist/standalone/cli.js','dist/standalone/standalone-shim.js','dist/standalone/parse-worker.js','dist/standalone/warm-up-worker.js','dist/standalone/cache-write-worker.js','dist/extension.js','dist/webview/app.js']) console.log(f.existsSync(p)?'OK '+p:'MISSING '+p);const r=f.existsSync('dist/standalone/rules')?f.readdirSync('dist/standalone/rules').filter(x=>x.endsWith('.md')).length:0;const m=f.existsSync('dist/standalone/metrics')?f.readdirSync('dist/standalone/metrics').filter(x=>x.endsWith('.metric.md')).length:0;console.log(r>0?('OK dist/standalone/rules ('+r+')'):'MISSING dist/standalone/rules');console.log(m>0?('OK dist/standalone/metrics ('+m+')'):'MISSING dist/standalone/metrics');"
```
Expected: seven `OK` file lines (no `MISSING`), plus `OK dist/standalone/rules (n)` and `OK dist/standalone/metrics (n)` with `n > 0`. The build prints `Build complete.` and exits 0. (Acceptance #1 + deviation #7: `npm run build` produces the CLI, shim, the three co-located workers, and the rule/metric data, alongside the unchanged extension/webview outputs.)

- [ ] **Step 3: Verify `--version` prints the package version (acceptance #2)**

Run: `node dist/standalone/cli.js --version`
Expected: prints `0.1.0` (the current `package.json` version), exit 0. This proves the `footer`'s `require.main === module` self-exec works. If it prints nothing, the footer was not applied to the CLI entry.

- [ ] **Step 4: Verify a bare require does not throw — the `vscode` alias worked (acceptance #2a)**

Run: `node -e "require('./dist/standalone/cli.js'); console.log('loaded ok')"`
Expected: prints `loaded ok` (no stack trace, no `Cannot find module 'vscode'`). Because this is `node -e`, `require.main !== module`, so the footer does **not** run `runCli` — the test isolates "the bundle *loads*", proving the alias neutralized the transitive top-level `import * as vscode`. (It also loads `detector-registry`, which reads `dist/standalone/rules`/`metrics`; with Step 1's copy present this is silent.) If it throws `Cannot find module 'vscode'`, the alias did not resolve — see Step 7.

- [ ] **Step 5: Verify the parse worker is co-located with the CLI bundle (the `__dirname` contract)**

Run:
```bash
node -e "const f=require('fs'),p=require('path');const d=p.dirname(p.resolve('dist/standalone/cli.js'));for (const w of ['parse-worker.js','warm-up-worker.js','cache-write-worker.js']) console.log(f.existsSync(p.join(d,w))?'OK '+w+' beside cli.js':'MISSING '+w);"
```
Expected: three `OK … beside cli.js` lines. This is exactly the resolution `parser.ts:638` (`path.join(__dirname,'parse-worker.js')`) and the two `new Worker(...)` calls perform at runtime; co-location is what stops `coach` from crashing when it forks the parse worker. (The full fork-and-parse round-trip is 08-testing's smoke step — deviation #7.)

- [ ] **Step 6: Verify the extension bundle still requires real `vscode` (acceptance #2b — no alias leak)**

Run:
```bash
grep -c 'require("vscode")' dist/extension.js
```
Expected: `1` or more (a non-zero count). The extension entry's `external: ['vscode']` compiles `import * as vscode` to `require("vscode")`; the standalone alias lives only in the CLI entry's options object and cannot reach this separate `esbuild.build` call. If the count is `0`, the alias leaked into the extension build — confirm you added `alias` only inside the **CLI** entry above, not anywhere shared.

- [ ] **Step 7 (only if Step 4 threw `Cannot find module 'vscode'`): make the alias path absolute**

esbuild resolves a relative `alias` target from the working directory; if your esbuild version reports it cannot resolve `./src/standalone/vscode-stub.ts`, replace the alias value with an absolute path. At the top of `esbuild.mjs` `path` is already imported, so change the alias line to:
```js
      vscode: path.resolve('src/standalone/vscode-stub.ts'),
```
Re-run Step 4. (Skip this step entirely if Step 4 already passed.)

- [ ] **Step 8: Commit**

```bash
git add esbuild.mjs
git commit -m "build(standalone): bundle cli, shim, workers, and copy rules/metrics"
```

---

## Task 3: `package.json` — publish wiring (`bin`, scripts, `files`, `publishConfig`, `engines.node`, `name`)

Adds the publish payload allowlist and the standalone scripts, sets the `engines.node` floor, and applies the one sanctioned `name` rename. Covers acceptance #3 (exact pack manifest — now including the co-located workers and rule/metric data, all under `dist/standalone/`) and the `serve`/`build:standalone` script existence.

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
`dist/standalone/` (recursive) is what publishes the CLI, the shim, the three co-located workers, and `dist/standalone/{rules,metrics}/` — all emitted by Task 2. Do **not** add `dist/rules`/`dist/metrics` (those are the extension's copies, not shipped) or enumerate the workers separately. Do **not** add `express`/`ws`/`open` to `dependencies` or `@playwright/test` to `devDependencies` — Task 1 confirmed all four are already present (re-adding would either no-op or churn versions; leave existing values untouched per the additive rule).

- [ ] **Step 5: Confirm `package.json` is still valid JSON and the keys landed**

Run:
```bash
node -e "const d=require('./package.json');console.log(d.name, '| bin.coach='+d.bin.coach, '| node='+d.engines.node, '| access='+d.publishConfig.access, '| files='+d.files.length, '| build:standalone='+JSON.stringify(d.scripts['build:standalone']));"
```
Expected: `@JuliusGruber/ai-engineer-coach | bin.coach=bin/coach | node=>=20 | access=public | files=6 | build:standalone="node esbuild.mjs"`. A `SyntaxError` means a comma/brace slip — fix before continuing.

- [ ] **Step 6: Verify the pack manifest is exactly the allowlisted paths, including the runtime assets (acceptance #3)**

Ensure a fresh build exists, then check the dry-run manifest:
```bash
npm run build && npm pack --dry-run --json 2>/dev/null | node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const files=JSON.parse(s)[0].files.map(f=>f.path).sort();const okRoots=['dist/standalone/','dist/webview/','bin/coach','LICENSE','NOTICE','README.md','package.json'];const bad=files.filter(p=>!okRoots.some(r=>r.endsWith('/')?p.startsWith(r):p===r));const need=['bin/coach','dist/standalone/cli.js','dist/standalone/standalone-shim.js','dist/standalone/parse-worker.js','dist/standalone/warm-up-worker.js','dist/standalone/cache-write-worker.js','LICENSE','NOTICE','README.md','package.json'].filter(p=>!files.includes(p));const hasRules=files.some(p=>p.startsWith('dist/standalone/rules/')&&p.endsWith('.md'));const hasMetrics=files.some(p=>p.startsWith('dist/standalone/metrics/')&&p.endsWith('.metric.md'));console.log('FILES:',files.join(', '));console.log(bad.length?('UNEXPECTED: '+bad.join(', ')):'no unexpected paths');console.log(need.length?('MISSING REQUIRED: '+need.join(', ')):'all required present');console.log(hasRules&&hasMetrics?'rules+metrics shipped':('MISSING DATA: rules='+hasRules+' metrics='+hasMetrics));});"
```
Expected: the `FILES:` line lists only paths under `dist/standalone/` (CLI, shim, the three workers, `rules/*.md`, `metrics/*.metric.md`) and `dist/webview/`, plus `bin/coach`, `LICENSE`, `NOTICE`, `README.md`, `package.json`; then `no unexpected paths`, `all required present`, and `rules+metrics shipped`. Crucially **no `dist/extension.js`, no `dist/parse-worker.js` at the `dist/` root, no `src/`** (verified: the npm 10 `files` allowlist does not force-include the `main` file). If `UNEXPECTED:` lists anything, a `files` entry is too broad; if `MISSING REQUIRED:`/`MISSING DATA:` fires, re-run the build (Task 2) so the standalone outputs exist.

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
Expected: `EXTENSION UNCHANGED`. `build:standalone` re-runs the full deterministic build, so `dist/extension.js` is rewritten with byte-identical content (deviation #1: "unchanged" = identical content). The new standalone worker/rules/metrics outputs are emitted to `dist/standalone/` and do not touch the extension's `dist/{extension.js,parse-worker.js,rules,metrics}`.

- [ ] **Step 3: Additive-only — `src/` shows only additions under `src/standalone/` (acceptance #4)**

Run:
```bash
git diff upstream/main -- src/ | grep -E '^[-+]' | grep -vE '^[-+]{3}'
```
Expected: every line is an addition (`+`) and every added line is inside `src/standalone/`. **No** deletions (`-`), no edits to files outside `src/standalone/`. (07-build adds no `src/` files itself — the worker/rule/metric *sources* it bundles are upstream and untouched; this confirms the cumulative fork state through this plan. If `upstream/main` is not configured: `git remote add upstream <url> && git fetch upstream`.)

- [ ] **Step 4: Additive-only — `package.json` / `esbuild.mjs` show additions only, except the `name` rename (acceptance #5)**

Run:
```bash
git diff upstream/main -- package.json esbuild.mjs | grep -E '^[-+]' | grep -vE '^[-+]{3}'
```
Expected: the only `-` line is the old `"name": "ai-engineer-coach",` (paired with the `+ "name": "@JuliusGruber/ai-engineer-coach",`); every other changed line is a `+` addition (the `engines.node` key, the six scripts, `bin`, `files`, `publishConfig`, and the appended esbuild block — five entries + the rules/metrics copy loop). No other removals or in-place edits of existing values. The single `name` `-/+` pair is the documented exception.

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
| `esbuild.mjs` two new entries (CLI + shim) + CLI-scoped `vscode` alias | Task 2 | Step 2 (both named outputs exist) |
| `esbuild.mjs` three Worker entries + rules/metrics copy under `dist/standalone/` (deviation #7) | Task 2 | Step 2 (workers + rule/metric counts); Step 5 (`__dirname` co-location) |
| `vscode-stub.ts` is the alias target (minimal `Uri.joinPath`) | Task 1 Step 3 (verify, idempotent) | content match |
| `bin/coach` launcher | Task 1 Step 2 (verify/create, idempotent) | Task 4 Step 5 |
| Acceptance #1 — build + build:standalone → cli.js + shim, existing dist unchanged | Tasks 2, 4 | Task 2 Step 2; Task 4 Steps 1–2 |
| Acceptance #1/#3 — runtime assets (parse worker, built-in rules/metrics) resolvable so the dashboard renders real data | Task 2 (deviation #7) | Step 2 (assets present); Step 5 (co-located with cli.js); functional parse → 08-testing |
| Acceptance #2 — `node dist/standalone/cli.js --version` prints version | Task 2 Step 3 | footer self-exec |
| Acceptance #2a — bare `require` does not throw (alias neutralized transitive `vscode`) | Task 2 Step 4 | `node -e "require(...)"` |
| Acceptance #2b — extension bundle still externalizes `vscode` (no alias leak) | Task 2 Step 6 | `grep require("vscode") dist/extension.js` |
| Acceptance #3 — pack manifest exactly the allowlist (incl. workers + rules/metrics under `dist/standalone/`), no others | Task 3 Step 6 | `npm pack --dry-run --json` parse |
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
- The three worker `outfile`s (`dist/standalone/{parse-worker,warm-up-worker,cache-write-worker}.js`) match the runtime spawn paths `path.join(__dirname, '<name>.js')` in `parser.ts:638` / `analyzer.ts:135` / `cache.ts:317`, because the CLI bundle's CJS `__dirname` is `dist/standalone/`. The rule/metric copy targets (`dist/standalone/{rules,metrics}`) match `rule-loader.ts`'s `path.join(__dirname, 'rules'|'metrics')`.
- The alias target `'./src/standalone/vscode-stub.ts'` matches the file 02-dispatcher created and the vitest `resolve.alias` target — one stub, two build systems (esbuild + vitest), identical path. The worker entries deliberately do **not** alias `vscode` (they mirror the extension's `external: ['vscode']`, proven runnable as forked children).
- The footer calls `module.exports.runCli` — `cli.ts` exports `runCli` as a **named** export (05-cli), which in the CJS bundle is `module.exports.runCli`. `runCli(argv): Promise<number>` resolves the exit code the footer feeds to `process.exit`, exactly as `bin/coach` does.
- `files: ["dist/standalone/", "dist/webview/", "bin/", "LICENSE", "NOTICE", "README.md"]` — every literal path exists at repo root (`LICENSE`/`NOTICE`/`README.md` confirmed) or is produced by a build (`dist/standalone/**` — CLI, shim, workers, rules, metrics — by Task 2; `dist/webview/**` by the untouched webview entry; `bin/coach` by 05-cli).
