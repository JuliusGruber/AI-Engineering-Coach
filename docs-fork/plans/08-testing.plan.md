# Testing (08-testing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the four-layer verification stack for the standalone fork — a one-time per-page RPC audit, a `renderStandaloneHtml` whole-output snapshot + a manual `coverage:standalone` script (Layer 1), multi-process integration tests that `fork()` the **built** `dist/standalone/cli.js` (Layer 2), a Playwright Chromium smoke test that loads all 10 nav pages console-clean and pins the curated-banner behavior (Layer 3), and a GitHub Actions matrix that runs all of the above on Linux/macOS/Windows on Node 20 (Layer 4).

**Architecture:** This spec produces **test infrastructure**, not runtime source. Unit tests already live per-module under `src/standalone/__tests__/` (specs 01–06); this spec adds **one** new unit file (the HTML snapshot) and otherwise formalizes the shared `vscode` vitest alias (already created by 02-dispatcher — idempotent check-only). Integration and Playwright tests live under a new fork-only `tests/standalone/` tree because they are slower and exercise the built binary across process boundaries. The integration suite runs under its **own** vitest config (`tests/standalone/integration/vitest.config.ts`) referenced explicitly with `--config`, so the upstream `npm test` (= `vitest run`, root `include: ['src/**/*.test.ts']`) stays unit-only and build-free while `npm run test:integration:standalone` runs the forking suite. The Playwright layer boots one CLI child in `globalSetup` against a synthetic `$HOME`, writes its URL+token to a runtime file, drives Chromium against each page, and tears the child down in `globalTeardown`.

**Tech Stack:** vitest 4.1.6 (already in devDeps; `environment: 'node'`), `@playwright/test@1.60.0` (**already** in upstream `devDependencies` — confirmed in `package.json`), Node 20 globals (`fetch`, `child_process.fork`, `crypto`), the `ws` client (runtime dep added by 01-server), and the `open`/`express`/`ws` deps already present. No new dependencies. The fixture generator and integration tests are pure Node (no `vscode` pull); the one new unit test imports `renderStandaloneHtml` (→ `panel-html` → transitive `vscode`), resolved by the root vitest `vscode` alias from 02-dispatcher.

---

## Spec references

- Spec under implementation: `docs-fork/specs/08-testing.md`
- Shared contract: `docs-fork/specs/00-overview.md` — relevant pieces:
  - **RPC contract / error shape** — disabled responses are `{ type:'response', id, data:{ error, code:'standalone-v1-disabled', method } }`; bad JSON is `{ type:'response', id:null, data:{ error:'invalid json', code:'bad-request' } }`. Integration tests assert these exact shapes.
  - **Disabled-method UX (banner vs silent)** — the dashboard fires `triageSkills`/`discoverCatalog`/`triageCatalog` (silent) on load; `createSkill` on the skills page is banner-worthy. The Playwright layer pins both (banner **absent** on `#dashboard`, **present** on `#skills` after `createSkill`).
  - **Security model** — `127.0.0.1` bind, 64-hex token on every request; the smoke test always navigates with `?t=<token>` and connects WS with `?t=`.
  - **Additive-only fork discipline** — every `+` under `src/` lives in `src/standalone/`; `tests/standalone/` and `.github/workflows/standalone.yml` are fork-only new paths (like `docs-fork/`); `package.json` gains only additions (vs `upstream/main`). Verified in the final task.
  - **"When these come into existence"** — `vscode-stub.ts`, the vitest `resolve.alias`, and the `open` dep are bootstrapped by 02-dispatcher; **08-testing formalizes the CI matrix and treats the alias/stub/dep as idempotent** (check-and-skip).

### Dependency note — this is the 8th (final) plan in the queue

`08-testing` is blocked by **07-build** (it `fork()`s the built `dist/standalone/cli.js`), which transitively means all of 06/02/04/03/01/05/07 have run. Honor these settled artifacts verbatim — every contract below is consumed, not redefined:

- **05-cli / 07-build** — the built CLI is `dist/standalone/cli.js`. Its esbuild `footer` self-executes `runCli(process.argv)` **only** when `require.main === module` (i.e. `node dist/standalone/cli.js` or `fork(...)` — but **not** `require()`), so:
  - `fork('dist/standalone/cli.js', ['--no-open', ...])` runs the CLI; flags are read from `process.argv.slice(2)`.
  - `require('dist/standalone/cli.js')` in a bare `node -e` **loads without running** (`require.main !== module`) and must not throw (the `vscode`-alias regression guard, mirroring 07-build AC 2a).
  - Exit codes: `0` (success/help/version/reuse), `2` (bad flag), `130` (SIGINT). The launcher prints to **stderr**: `coach running at http://127.0.0.1:<port>/?t=<64hex>` on a fresh boot, `coach already running at <url>` on single-instance reuse.
  - Flags consumed by tests: `--no-open`, `--port <n>`, `--rotate-token`.
- **01-server** (`server.ts`): `GET /health` (no auth) → `{ ok:true, app:'ai-engineer-coach', version:<string>, pid:<number> }`. WS at `/rpc?t=<token>`; bad token → close code **4001**. Disabled/native/dataReady/progress frames exactly as in 00-overview. Single-instance state at `~/.ai-engineer-coach/server-state.json`, cleared on shutdown. Port-retry range **7331..7340**, then a fatal error whose message contains `--port`.
- **03-standalone-html** (`standalone-html.ts`): `renderStandaloneHtml({ token, appVersion }): string` is deterministic for a fixed token (the per-call nonce is stripped) — so it snapshots cleanly. It already carries the `replaceOnce` drift guards (CSP-meta and app.js-script anchors) in `standalone-html.test.ts`; this spec **adds** a whole-output snapshot on top (the nav/CSS drift guard from the spec Decisions table).
- **04-webview-shim** (`webview-shim.ts`): defines `globalThis.acquireVsCodeApi`; on an inbound `standalone-v1-disabled` frame whose `method ∈ BANNER_WORTHY` it injects `#coach-roadmap-banner`. `BANNER_WORTHY` is the curated 10-method set (incl. `createSkill`; excl. proactive `triageSkills`). Smoke test drives a `createSkill` request through `acquireVsCodeApi().postMessage`. The shim also provides the **hash → page navigation bridge** (04-webview-shim Task 5): loading `…/?t=<token>#<id>` selects page `<id>` once `dataReady` arrives, and `navigateTo` toggles `active` on `.nav-links a[data-page="<id>"]` (`app.ts:466`) so the active link reflects the current page — the smoke spec relies on **both** (hash to navigate, active-link class to verify the right page rendered rather than a silent fall-back to `dashboard`). The reused upstream `app.ts` has no hash router of its own, so this bridge is what makes the per-page navigation work; `burndown` normalizes to `dashboard` (`app.ts:26-29`).
- **02-dispatcher** (`v1-allowed.ts` / `dispatcher.ts`): the "exactly 40" assertion lives in `v1-allowed.test.ts` (08-testing does **not** duplicate it). `saveRule ∉ V1_ALLOWED` → disabled; `openExternal ∈ STANDALONE_NATIVE` → runs before the data-ready guard.
- **06-state** (`state.ts`): `server-state.json` under `os.homedir()/.ai-engineer-coach/`. Tests redirect it by setting the child's `HOME` (POSIX) / `USERPROFILE` (Windows) env to a tmpdir — Node's `os.homedir()` honors those.

Upstream parser facts (verified in-repo, used by the fixture generator):
- `findLogsDirs()` (`src/core/parser.ts:101`) scans home-relative roots, including **Claude Code** at `~/.claude/projects` (`parser-claude.ts:313-318`), purely by directory existence (no content sniffing).
- Claude on-disk layout: `~/.claude/projects/<encoded-project-path>/<sessionId>.jsonl`; the file is **JSONL** (one JSON object per line). A session needs ≥1 `{type:'user', timestamp, sessionId, message:{role:'user', content:[{type:'text', text}]}}` line and ≥1 `{type:'assistant', timestamp, sessionId, message:{role:'assistant', model, content:[...], usage:{input_tokens, output_tokens}}}` line to produce a `Session` with a `SessionRequest` (`parser-claude.ts:141,207,251`).
- Image gallery needs **no** image files on disk — `getImageGallery` reads image counts from already-parsed sessions (`analyzer-images.ts:114`); a page with zero images renders an empty state.

### Deliberate deviations from the spec text (all noted inline; each is justified, none weakens an acceptance criterion)

1. **`test:integration:standalone` is `vitest run --config tests/standalone/integration/vitest.config.ts`, not 07-build's provisional `vitest run tests/standalone/integration`.** **Empirically verified** (vitest 4.1.6, this repo): with the root `include: ['src/**/*.test.ts']`, the bare positional form prints `No test files found, exiting with code 1` (vitest filters the *collected* set, and files under `tests/` are never collected). The root config cannot be broadened to cover `tests/**` without `npm test` (the upstream `vitest run` key, which must **not** be modified) also running the forking integration suite. The fix is a dedicated integration config referenced with `--config` — which collects and runs the suite (verified). 07-build itself flagged these scripts as *"inert until [08-testing] … 08-testing creates [the paths]"*, so finalizing the script value is 08-testing's job. Against `upstream/main` this is still a pure addition (upstream has no such script), so additive-only holds.
2. **One committed fixture *generator* (`seed-home.mjs`) with timestamps relative to `Date.now()`, instead of static `.jsonl` files.** The spec's Decisions table prefers "hand-curated committed fixtures," but static dates would fall outside the date-windowed pages (last-7-days views) whenever CI runs later, leaving pages empty and the smoke test brittle. A committed, deterministic generator that writes the last 7 days at setup time keeps every page populated regardless of run date — "repeatable" in spirit, and far smaller than committing dozens of dated JSONL files (well under the 2 MB budget).
3. **Single-harness (Claude) fixture, not "3 harnesses".** The smoke acceptance is *render + zero console errors* (graceful degradation), which a rich Claude-only fixture (2 projects × 7 days × 3 turns, varied models/tools) satisfies for all 10 nav pages. The VS Code / Xcode / Copilot-CLI on-disk schemas differ per harness and would balloon the generator; multi-harness fixtures are a v1.1 enrichment. The harness-comparison/breakdown pages render with one harness (a single series). Noted so a reviewer expecting three harnesses understands the scope choice.
4. **`native openExternal works before dataReady` is Linux-only**, gated `it.runIf(process.platform === 'linux')`, with a fake `xdg-open` prepended to `PATH` so no real browser launches. In a forked real process the dispatcher's `open` cannot be `vi.mock`'d; on macOS/Windows the opener is not reliably PATH-shadowable (`/usr/bin/open`, the `start` cmd builtin), risking a real browser tab or a headless rejection. The native tier's *behavior* is already cross-platform unit-tested in 02-dispatcher (`open` mocked); this integration test adds only the "reachable over a real WS before dataReady" dimension, which Linux covers deterministically.
5. **`cli responds to SIGINT with code 130` is POSIX-only** (`it.skipIf(process.platform === 'win32')`). Windows cannot deliver a POSIX `SIGINT` to a forked child such that the child's `process.on('SIGINT')` fires; `child.kill('SIGINT')` there terminates without the 130 handler. The shutdown handler's logic (130, `clearServerState`) is unit-tested cross-platform in 05-cli by invoking the registered handler directly. The integration suite still runs on Windows for the path-separator/file-mode coverage the spec wants.
6. **`port collision … then fails` pre-binds all 10 ports (7331..7340), not "two".** The spec table says "Pre-bind two probe servers," but `listenWithRetry` only fails once **all** of `7331..7340` are taken (01-server). Binding two would let the CLI succeed on a free port. Binding the full range is the only deterministic way to force the exit-1 path; the test releases all 10 probes in teardown.
7. **`cli with --no-open` is asserted positively (boots + serves), not by observing `open` was not called.** "open not invoked" is unobservable from outside a forked process; it is the 05-cli unit test's assertion (mocked `open`). The integration test confirms `--no-open` does not break boot and the server is reachable — the cross-process half of the contract.
8. **`coverage:standalone` uses a dedicated report-only config** (`tests/standalone/coverage.config.ts`), not the root config's CLI overrides. The root coverage config enforces 70% thresholds scoped to `src/core/**`; reusing it for `src/standalone/**` would either inherit the wrong scope or fail on the unrelated core thresholds (verified: `--coverage.include='src/standalone/**'` still trips the root 70% gate). A separate config with **no** thresholds reports `src/standalone/` line coverage so the implementer can eyeball the spec's 80% target. Manual only — not wired into CI (matches the spec).
9. **The Layer 0 audit is a one-time analysis task producing `tests/standalone/PAGE-RPC-AUDIT.md`**, not test code. It is a gated guard (the spec: "one-time, gated"), executed with concrete grep commands and a fixed decision rule; its conclusion (all 10 nav pages degrade gracefully; `BANNER_WORTHY` reconciles to 04's set) is the spec's grilling outcome.
10. **The smoke test navigates by URL hash through a shim-provided bridge, and asserts the active nav link to verify the page rendered.** The reused upstream `app.ts` has **no** hash router — it navigates only via a document-delegated click on `[data-page]` links and always defaults to `dashboard` (`app.ts:38,451-461`), and additive-only discipline forbids editing it. So the hash → page navigation the spec assumes (`#skills`, `#dashboard`, …; spec `08-testing.md:136-145`, acceptance #4 "reachable by hash URL") is provided by the shim's bridge, which this grill added to **04-webview-shim** (Task 5): it synthesizes a `[data-page]` element and clicks it, applying the hash on `hashchange` and once `dataReady` arrives. The smoke spec therefore (a) keeps hash navigation and (b) asserts `navigateTo`'s `active` class on the matching nav link (`app.ts:466`) — without that assertion a `main#content > *` check would false-green on `dashboard` for every page, leaving acceptance #5 with no real check. `burndown` maps to `dashboard` (`app.ts:26-29`; its nav `<li>` is not emitted while the flag is false, `panel-html.ts:34`). **Cross-plan note:** this reopened the already-grilled `04-webview-shim.plan.md`; that plan now owns the bridge contract 08 consumes.

## File Structure

| Path | Responsibility | Created/edited by |
|------|----------------|-------------------|
| `tests/standalone/PAGE-RPC-AUDIT.md` | Layer 0: per-nav-page RPC classification + graceful-degradation confirmation + `BANNER_WORTHY` reconciliation. | Task 1 |
| `src/standalone/__tests__/standalone-html.snapshot.test.ts` | Layer 1: one whole-output snapshot of `renderStandaloneHtml` (nav/CSP/CSS/script-order drift guard). | Task 2 |
| `src/standalone/__tests__/__snapshots__/standalone-html.snapshot.test.ts.snap` | Generated snapshot (committed). | Task 2 |
| `tests/standalone/coverage.config.ts` | Layer 1: report-only coverage config scoped to `src/standalone/`. | Task 2 |
| `tests/standalone/integration/vitest.config.ts` | Layer 2: dedicated vitest config (collects `tests/standalone/integration/**`, sequential, long timeouts). | Task 3 |
| `tests/standalone/integration/helpers.ts` | Layer 2: `bootCli`/`stopCli`/`wsConnect`/`wsRequest`/`wsWaitFor`/`makeTmpHome`. | Task 3 |
| `tests/standalone/integration/cli-boot.test.ts` | Layer 2: bare-require, health, loading-shell, dataReady, url-print, `--port`, `--no-open`. | Tasks 3–4 |
| `tests/standalone/integration/cli-rpc-lifecycle.test.ts` | Layer 2: disabled method, native `openExternal`, single-instance reuse, SIGINT→130, port-collision. | Task 5 |
| `tests/standalone/fixtures/seed-home.mjs` | Layer 3: synthetic Claude session-log generator (relative dates). | Task 6 |
| `tests/standalone/playwright/playwright.config.ts` | Layer 3: Playwright config (Chromium, global setup/teardown, serial). | Task 7 |
| `tests/standalone/playwright/global-setup.ts` | Layer 3: seed `$HOME`, fork CLI, capture URL+token → `.runtime.json`. | Task 7 |
| `tests/standalone/playwright/global-teardown.ts` | Layer 3: stop CLI, remove tmp home + runtime file. | Task 7 |
| `tests/standalone/playwright/smoke.spec.ts` | Layer 3: 10-page console-clean loop + banner present/absent guards. | Task 8 |
| `.github/workflows/standalone.yml` | Layer 4: CI matrix (Ubuntu/macOS/Windows, Node 20). | Task 9 |
| `package.json` | Additive: correct `test:integration:standalone`; add `coverage:standalone`. | Task 3 (script), Task 2 (coverage) |

`src/standalone/__tests__/` exists from earlier plans; the new snapshot file matches the root vitest `include: ['src/**/*.test.ts']` and runs under `npm test`. `tests/` and `.github/workflows/` do not exist yet; the first file path in each creates them.

## Conventions to copy (already in the repo)

- vitest imports come from `'vitest'`: `import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';`
- Full unit suite: `npm test` (= `vitest run`). Single file: `npx vitest run <path>`.
- Temp dirs: `fs.mkdtempSync(path.join(os.tmpdir(), 'prefix-'))` + `fs.rmSync(dir, { recursive:true, force:true })` in teardown (as in `src/core/cache.test.ts`).
- Strict TS, named exports only, kebab-case filenames, comments only where the *why* is non-obvious.
- Verification commands are bash-style (`git diff … | grep …`); on Windows run them via the Bash tool / Git Bash.

### Preconditions

If `node_modules/` is empty, run `npm ci` once. By topological order **all** standalone source modules (`state`, `dispatcher`, `v1-allowed`, `standalone-native`, `vscode-stub`, `webview-shim`, `standalone-html`, `auth`, `image-route`, `server`, `flags`, `parse-bootstrap`, `cli`), `bin/coach`, the `express`/`ws`/`open` deps, the vitest `vscode` alias, and the esbuild standalone entries already exist and must **not** be recreated. The baseline must be green — `npm test` passes and `npm run build` succeeds — before this plan's edits; a pre-existing failure is an escalation, not introduced here. The integration and Playwright layers require a fresh `npm run build` (they exercise `dist/standalone/cli.js`).

---

## Task 1: Layer 0 — one-time per-page RPC audit (`PAGE-RPC-AUDIT.md`)

The gated guard that pins page behavior to evidence before the Playwright list is trusted. There is **no hidden nav to derive** — the standalone reuses the upstream nav verbatim (03-standalone-html); the audit **confirms every nav page degrades gracefully** and **reconciles** the discovered banner-worthy methods against 04's `BANNER_WORTHY`. This task writes an analysis document, not test code (deviation #9).

**Files:**
- Create: `tests/standalone/PAGE-RPC-AUDIT.md`

- [ ] **Step 1: Enumerate the RPC calls each nav page issues**

Run (lists every `rpc('…')` / `rpcAllSettled([…])` call site, grouped by page file):
```bash
grep -rnoE "rpc(AllSettled)?\(([^)]*)" src/webview/page-*.ts | sort
```
Expected: a list of `src/webview/page-<id>.ts:<line>: rpc('<method>'…` rows. Keep the raw output — it is the audit's evidence.

- [ ] **Step 2: Classify each method into one of four buckets**

For each method found in Step 1, classify against the authoritative sets:
- **registry-allowlisted** — in `V1_ALLOWED` (`src/standalone/v1-allowed.ts`, 40 methods) → works.
- **native** — in `STANDALONE_NATIVE` (`src/standalone/standalone-native.ts`; `openExternal` only in v1) → works.
- **banner-worthy** — in `BANNER_WORTHY` (`src/standalone/webview-shim.ts`, 10 methods) → disabled **+ banner**.
- **silent-disabled** — none of the above, guarded by the page's own `.catch(() => null)` → disabled, no banner.

Cross-check the sets:
```bash
grep -oE "'[a-zA-Z]+'" src/standalone/v1-allowed.ts | tr -d "'" | sort -u   # the 40 allowlisted
grep -oE "'[a-zA-Z]+'" src/standalone/webview-shim.ts | sed -n '/createSkill/,/getRuleEditor/p'  # BANNER_WORTHY block
```

- [ ] **Step 3: Apply the decision rule (halt-and-escalate guard)**

For each of the **10 real nav page ids** — `dashboard`, `timeline`, `image-gallery`, `output`, `burndown`, `patterns`, `anti-patterns`, `skills`, `config-health`, `level-up` — and the deep-link-only routes `rule-editor`, `rule-playground`, `data-explorer`, confirm the page still **renders** with its silent-disabled sections degraded (e.g. `level-up`'s `getSdlcToolAnalysis` badge hides; `skills`'s `triage*` suggestions collapse). 

**Decision rule:** if any nav page renders **broken** (not merely degraded) when its *primary* data source is disabled, **halt and escalate to the maintainer** — do not silently drop a nav entry (dropping one now requires editing the reused upstream body). The spec grilling established the expected outcome: **all 10 nav pages degrade gracefully**; `burndown` is gated off by `FF_TOKEN_REPORTING_ENABLED` and redirects to `dashboard` (`app.ts:27`).

- [ ] **Step 4: Write the audit document**

Create `tests/standalone/PAGE-RPC-AUDIT.md` with: (a) the date and the git SHA audited (`git rev-parse --short HEAD`), (b) a table of `page id | method | bucket | renders? (degraded/works)` filled from Steps 1–3, (c) the explicit conclusion "all 10 nav pages degrade gracefully — no nav entry dropped," and (d) the reconciliation line: the set of discovered banner-worthy methods equals `BANNER_WORTHY` (the 10 in `webview-shim.ts`): `createSkill`, `generateSkillContent`, `generateLearningQuiz`, `generateLearningResources`, `generateCodeComparison`, `generateDidYouKnow`, `installSkill`, `installCatalogItem`, `triageCatalog`, `getRuleEditor`. Note any discovered banner-worthy method **not** in the set as a `BANNER_WORTHY` gap to fix in 04 (expected: none). Copy this table into the PR description.

- [ ] **Step 5: Commit**

```bash
git add tests/standalone/PAGE-RPC-AUDIT.md
git commit -m "test(standalone): add one-time per-page RPC degradation audit"
```

---

## Task 2: Layer 1 — `renderStandaloneHtml` snapshot + manual coverage script

Adds the one whole-output HTML snapshot (the spec Decisions row "One snapshot for `renderStandaloneHtml({...})`") and the report-only `coverage:standalone` script. The snapshot runs under `npm test` and complements 03's `replaceOnce` drift guards by also pinning nav markup and CSS link drift. First confirm the shared `vscode` alias is present (idempotent — 02-dispatcher created it).

**Files:**
- Verify only: `vitest.config.mts` (the `vscode` alias must already exist)
- Create: `src/standalone/__tests__/standalone-html.snapshot.test.ts`
- Create (generated): `src/standalone/__tests__/__snapshots__/standalone-html.snapshot.test.ts.snap`
- Create: `tests/standalone/coverage.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Confirm the vitest `vscode` alias exists (no edit expected)**

Run:
```bash
grep -n "vscode-stub" vitest.config.mts
```
Expected: a line mapping `vscode` to `./src/standalone/vscode-stub.ts` (added by 02-dispatcher). If absent, an earlier spec did not run — stop and restore it (the snapshot test imports `renderStandaloneHtml` → `panel-html` → transitive `vscode`, which fails to resolve without the alias). Do **not** recreate it on top of an existing block.

- [ ] **Step 2: Write the snapshot test**

Create `src/standalone/__tests__/standalone-html.snapshot.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { renderStandaloneHtml } from '../standalone-html';

// One whole-output snapshot. `renderStandaloneHtml` strips the per-call nonce, so a
// fixed token yields byte-identical output — this pins the entire served document
// (nav entries, CSP, CSS links, script order) against accidental upstream drift that
// the structural assertions in standalone-html.test.ts don't individually cover.
// appVersion is not interpolated into the body (03-standalone-html), so any value works.
describe('renderStandaloneHtml snapshot', () => {
  it('matches the committed standalone HTML snapshot', () => {
    const html = renderStandaloneHtml({ token: 'a'.repeat(64), appVersion: '0.0.0-test' });
    expect(html).toMatchSnapshot();
  });
});
```

- [ ] **Step 3: Generate and inspect the snapshot**

Run: `npx vitest run src/standalone/__tests__/standalone-html.snapshot.test.ts`
Expected: PASS — `1 passed`, and a new `__snapshots__/standalone-html.snapshot.test.ts.snap` is **written** (first run records it). Open the `.snap` and sanity-check it: it must contain `<!DOCTYPE html>`, the standalone CSP (`script-src 'self'`), `<meta name="coach-token" content="aaaa…">`, `<script src="/standalone-shim.js">` **before** `<script src="/dist/webview/app.js">`, `href="/dist/webview/styles.css"`, and **no** `data-page="burndown"`. If any of those is wrong, the bug is in `standalone-html.ts` (03), not here — stop and reconcile.

- [ ] **Step 4: Re-run to confirm the snapshot is stable (deterministic)**

Run: `npx vitest run src/standalone/__tests__/standalone-html.snapshot.test.ts`
Expected: PASS with the snapshot **matched** (not written/updated) — proves determinism. If it reports "1 obsolete" or wants to update, the output is non-deterministic — investigate (a leaked nonce would mean 03's transforms regressed).

- [ ] **Step 5: Add the report-only standalone coverage config**

Create `tests/standalone/coverage.config.ts`:
```ts
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
```

- [ ] **Step 6: Add the `coverage:standalone` script**

In `package.json` `"scripts"`, after `"pack:check"` (added by 07-build), add (additive — new key; mind the trailing comma on the line before):
```jsonc
    "pack:check": "npm pack --dry-run",
    "coverage:standalone": "vitest run --config tests/standalone/coverage.config.ts"
```

- [ ] **Step 7: Run the manual coverage script**

Run: `npm run coverage:standalone`
Expected: the standalone unit suite runs (state/dispatcher/v1-allowed/standalone-native/webview-shim/standalone-html/auth/image-route/server/flags/parse-bootstrap/cli + the new snapshot) and a coverage table scoped to `src/standalone/**` prints; **exit 0** (no thresholds). Note the `% Lines` for `src/standalone/` — the spec's tracking target is **80%**. This is informational; do not gate on it.

- [ ] **Step 8: Commit**

```bash
git add src/standalone/__tests__/standalone-html.snapshot.test.ts src/standalone/__tests__/__snapshots__/standalone-html.snapshot.test.ts.snap tests/standalone/coverage.config.ts package.json
git commit -m "test(standalone): add renderStandaloneHtml snapshot and coverage:standalone script"
```

---

## Task 3: Layer 2 — integration config, helpers, and the corrected script (with the bare-require guard test)

Stands up the forking integration suite's foundation: its own vitest config (so `npm test` stays unit-only — deviation #1), the shared `helpers.ts`, the corrected `test:integration:standalone` script, and the first, simplest test (`require()` the bundle in bare node without `vscode`). This task proves the wiring end-to-end before the heavier lifecycle tests.

**Files:**
- Modify: `package.json`
- Create: `tests/standalone/integration/vitest.config.ts`
- Create: `tests/standalone/integration/helpers.ts`
- Create: `tests/standalone/integration/cli-boot.test.ts`

- [ ] **Step 1: Ensure a fresh build exists**

Run: `npm run build`
Expected: `Build complete.`, exit 0, and `dist/standalone/cli.js` + `dist/standalone/standalone-shim.js` present. The integration tests `fork()`/`require()` this bundle; without it they cannot run.

- [ ] **Step 2: Correct the `test:integration:standalone` script**

In `package.json` `"scripts"`, change 07-build's provisional value:
```jsonc
    "test:integration:standalone": "vitest run tests/standalone/integration",
```
to (deviation #1 — the bare positional finds no files under the `src/**`-only root `include`; a dedicated config is required):
```jsonc
    "test:integration:standalone": "vitest run --config tests/standalone/integration/vitest.config.ts",
```

- [ ] **Step 3: Create the integration vitest config**

Create `tests/standalone/integration/vitest.config.ts`:
```ts
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
```

- [ ] **Step 4: Create the shared helpers**

Create `tests/standalone/integration/helpers.ts`:
```ts
import { fork, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

// Resolved from this file's URL → repo-root/dist/standalone/cli.js.
export const CLI = path.resolve(
  fileURLToPath(new URL('../../../dist/standalone/cli.js', import.meta.url)),
);

export function makeTmpHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'coach-it-'));
}

export interface Booted {
  child: ChildProcess;
  url: string;
  token: string;
  port: number;
  reused: boolean;
  stderr: () => string;
}

// Matches both "coach running at <url>" and "coach already running at <url>".
const URL_RE = /coach (already )?running at (http:\/\/127\.0\.0\.1:(\d+)\/\?t=([0-9a-f]{64}))/;

// Fork the built CLI with HOME/USERPROFILE pointed at an isolated tmp home so
// os.homedir() (used by state + the parser) resolves there. Resolves once the URL
// line is seen on stderr; rejects on early exit or timeout (with captured stderr).
export function bootCli(home: string, args: string[] = [], timeoutMs = 20_000): Promise<Booted> {
  const child = fork(CLI, ['--no-open', ...args], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let buf = '';
  let done = false;
  return new Promise<Booted>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      child.kill('SIGKILL');
      reject(new Error(`bootCli timed out (${timeoutMs}ms). stderr:\n${buf}`));
    }, timeoutMs);
    const tryResolve = (): boolean => {
      const m = buf.match(URL_RE);
      if (m && !done) {
        done = true;
        clearTimeout(timer);
        resolve({ child, url: m[2], token: m[4], port: Number(m[3]), reused: Boolean(m[1]), stderr: () => buf });
      }
      return Boolean(m);
    };
    child.stderr!.on('data', (b: Buffer) => { buf += b.toString(); tryResolve(); });
    child.on('exit', (code) => {
      if (done) return;
      if (!tryResolve()) {
        done = true;
        clearTimeout(timer);
        reject(new Error(`cli exited (code ${code}) before printing a URL. stderr:\n${buf}`));
      }
    });
  });
}

// SIGINT the child and await its exit; SIGKILL after 5 s as a backstop. Returns the code.
export async function stopCli(b: Booted): Promise<number | null> {
  if (b.child.exitCode !== null) return b.child.exitCode;
  const exited = new Promise<number | null>((resolve) => b.child.once('exit', (c) => resolve(c)));
  b.child.kill('SIGINT');
  return Promise.race([
    exited,
    new Promise<number | null>((resolve) =>
      setTimeout(() => { b.child.kill('SIGKILL'); resolve(null); }, 5_000),
    ),
  ]);
}

export function wsConnect(b: Booted): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${b.port}/rpc?t=${b.token}`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

export function wsRequest(
  ws: WebSocket,
  method: string,
  params?: unknown,
  id = 'it-1',
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const onMsg = (raw: Buffer): void => {
      const f = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (f.type === 'response' && f.id === id) { ws.off('message', onMsg); resolve(f); }
    };
    ws.on('message', onMsg);
    ws.once('error', reject);
    ws.send(JSON.stringify({ type: 'request', id, method, params }));
  });
}

export function wsWaitFor(ws: WebSocket, type: string, timeoutMs = 15_000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.off('message', onMsg); reject(new Error(`no ${type} frame in ${timeoutMs}ms`)); }, timeoutMs);
    const onMsg = (raw: Buffer): void => {
      const f = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (f.type === type) { clearTimeout(timer); ws.off('message', onMsg); resolve(f); }
    };
    ws.on('message', onMsg);
  });
}
```

- [ ] **Step 5: Write the first integration test (bare-require guard)**

Create `tests/standalone/integration/cli-boot.test.ts`:
```ts
import { execFileSync } from 'node:child_process';
import * as os from 'node:os';
import { describe, expect, it } from 'vitest';
import { CLI } from './helpers';

describe('cli bundle', () => {
  it('require()s in a bare node process without vscode (07-build AC 2a)', () => {
    // require.main !== module here, so the footer does NOT run runCli — this isolates
    // "the bundle LOADS", proving the esbuild vscode alias neutralized the transitive
    // top-level `import * as vscode`. cwd=tmpdir so no stray node_modules/vscode resolves.
    const out = execFileSync(
      process.execPath,
      ['-e', `require(${JSON.stringify(CLI)}); process.stdout.write('loaded');`],
      { encoding: 'utf8', cwd: os.tmpdir() },
    );
    expect(out).toContain('loaded');
  });
});
```

- [ ] **Step 6: Run the integration suite to verify wiring + the first test**

Run: `npm run test:integration:standalone`
Expected: PASS — `Test Files 1 passed`, `Tests 1 passed`. If you instead see `No test files found`, the `--config` flag or its path is wrong (re-check Step 2/3). If `require(...)` throws `Cannot find module 'vscode'`, the esbuild CLI-entry alias regressed in 07-build — stop and fix there.

- [ ] **Step 7: Commit**

```bash
git add package.json tests/standalone/integration/vitest.config.ts tests/standalone/integration/helpers.ts tests/standalone/integration/cli-boot.test.ts
git commit -m "test(standalone): add integration config, helpers, and bare-require guard"
```

---

## Task 4: Layer 2 — boot, health, loading shell, dataReady, url-print, `--port`, `--no-open`

Grows `cli-boot.test.ts` with the lifecycle tests that fork the CLI and probe over HTTP/WS. Each test uses a distinct port and its own tmp home so the serialized suite never collides or shares single-instance state. Covers spec integration rows `cli boots and serves health`, `serves loading shell before parse completes`, `dataReady arrives over WS after parse`, `cli prints url to stderr`, `cli with --port honors override`, `cli with --no-open does not spawn browser`, and acceptance #2 (`/health`), #4 (CI green).

**Files:**
- Modify: `tests/standalone/integration/cli-boot.test.ts`

- [ ] **Step 1: Write the failing tests**

Replace the import line and append the boot describe block in `tests/standalone/integration/cli-boot.test.ts`. The top of the file becomes:
```ts
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { bootCli, makeTmpHome, stopCli, wsConnect, wsWaitFor, type Booted, CLI } from './helpers';

const booted: Array<{ b: Booted; home: string }> = [];
async function boot(port: number, args: string[] = []): Promise<Booted> {
  const home = makeTmpHome();
  const b = await bootCli(home, ['--port', String(port), ...args]);
  booted.push({ b, home });
  return b;
}

afterEach(async () => {
  for (const { b, home } of booted.splice(0)) {
    await stopCli(b);
    fs.rmSync(home, { recursive: true, force: true });
  }
});
```
(Keep the existing `describe('cli bundle', …)` block from Task 3.) Then append:
```ts
describe('cli boot lifecycle', () => {
  it('boots and serves /health with the documented payload', async () => {
    const b = await boot(7350);
    const res = await fetch(`http://127.0.0.1:${b.port}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; app: string; version: string; pid: number };
    expect(body.ok).toBe(true);
    expect(body.app).toBe('ai-engineer-coach');
    expect(typeof body.version).toBe('string');
    expect(body.version.length).toBeGreaterThan(0);
    expect(typeof body.pid).toBe('number');
  });

  it('serves the loading shell (GET / → 200 HTML) as soon as the URL is printed', async () => {
    // Serve-then-parse: createServer binds and the URL prints BEFORE bootstrapParse,
    // so GET / returns the HTML shell immediately (dataReady gates client rendering only).
    const b = await boot(7351);
    const res = await fetch(b.url); // b.url carries ?t=<token>
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<!DOCTYPE html>');
  });

  it('broadcasts dataReady over WS after the parse completes', async () => {
    const b = await boot(7352); // empty home → empty ParseResult → setData still fires
    const ws = await wsConnect(b);
    const frame = await wsWaitFor(ws, 'dataReady');
    expect(frame).toMatchObject({ type: 'dataReady' });
    ws.close();
  });

  it('prints the url with a 64-hex token to stderr', async () => {
    const b = await boot(7353);
    expect(b.reused).toBe(false);
    expect(b.token).toMatch(/^[0-9a-f]{64}$/);
    expect(b.stderr()).toMatch(/coach running at http:\/\/127\.0\.0\.1:7353\/\?t=[0-9a-f]{64}/);
  });

  it('honors --port override', async () => {
    const b = await boot(7354);
    expect(b.port).toBe(7354);
    expect((await fetch(`http://127.0.0.1:7354/health`)).status).toBe(200);
  });

  it('with --no-open still boots and serves (browser suppressed)', async () => {
    // "open not invoked" is unobservable cross-process; the 05-cli unit test asserts that
    // with a mocked open. Here we confirm --no-open does not break boot (deviation #7).
    const b = await boot(7357, ['--no-open']);
    expect((await fetch(`http://127.0.0.1:${b.port}/health`)).status).toBe(200);
    expect(b.stderr()).not.toContain('browser open failed');
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npm run test:integration:standalone`
Expected: PASS — the bundle test (1) plus 6 boot tests = `7 passed`. (`bootCli` already passes `--no-open`; the explicit `--no-open` in the last test is harmless.) If `dataReady` times out, confirm 01-server's connect-time `dataReady` send and that `setData` runs even for an empty parse (05-cli always calls it).

- [ ] **Step 3: Commit**

```bash
git add tests/standalone/integration/cli-boot.test.ts
git commit -m "test(standalone): integration tests for boot, health, dataReady, port"
```

---

## Task 5: Layer 2 — disabled method, native `openExternal`, reuse, SIGINT, port-collision

The RPC-shape and single-instance/lifecycle integration tests. Covers spec rows `disabled method returns data-nested error`, `native openExternal works before dataReady`, `second cli reuses first`, `cli responds to SIGINT with code 130`, `port collision retries +1..+9 then fails`, and acceptance #4.

**Files:**
- Create: `tests/standalone/integration/cli-rpc-lifecycle.test.ts`

- [ ] **Step 1: Write the tests**

Create `tests/standalone/integration/cli-rpc-lifecycle.test.ts`:
```ts
import { fork } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bootCli, makeTmpHome, stopCli, wsConnect, wsRequest, type Booted, CLI } from './helpers';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

function track(b: Booted, home: string): Booted {
  cleanups.push(async () => { await stopCli(b); fs.rmSync(home, { recursive: true, force: true }); });
  return b;
}

describe('cli rpc + lifecycle', () => {
  it('returns a data-nested error for a disabled method (no sibling error field)', async () => {
    const home = makeTmpHome();
    const b = track(await bootCli(home, ['--port', '7358']), home);
    const ws = await wsConnect(b);
    // saveRule ∉ V1_ALLOWED → tier-2 disabled, independent of data-ready (dispatcher).
    const res = await wsRequest(ws, 'saveRule', { name: 'x' }, 'd1');
    ws.close();
    expect(res).toMatchObject({
      type: 'response',
      id: 'd1',
      data: { code: 'standalone-v1-disabled', method: 'saveRule' },
    });
    expect(typeof (res.data as { error: unknown }).error).toBe('string');
    expect((res.data as { error: string }).error.length).toBeGreaterThan(0);
    expect('error' in res).toBe(false); // never a sibling field
  });

  it.runIf(process.platform === 'linux')(
    'runs native openExternal over WS before dataReady (fake xdg-open on PATH)',
    async () => {
      // open@10 resolves xdg-open via PATH on Linux; a fake one returns 0 without a browser.
      const home = makeTmpHome();
      const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-bin-'));
      fs.writeFileSync(path.join(binDir, 'xdg-open'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      const child = fork(CLI, ['--no-open', '--port', '7359'], {
        env: { ...process.env, HOME: home, USERPROFILE: home, PATH: `${binDir}${path.delimiter}${process.env.PATH}` },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });
      const b: Booted = await new Promise((resolve, reject) => {
        let buf = '';
        const t = setTimeout(() => reject(new Error(`no url; stderr:\n${buf}`)), 20_000);
        child.stderr!.on('data', (x: Buffer) => {
          buf += x.toString();
          const m = buf.match(/running at (http:\/\/127\.0\.0\.1:(\d+)\/\?t=([0-9a-f]{64}))/);
          if (m) { clearTimeout(t); resolve({ child, url: m[1], token: m[3], port: Number(m[2]), reused: false, stderr: () => buf }); }
        });
      });
      cleanups.push(async () => {
        await stopCli(b);
        fs.rmSync(home, { recursive: true, force: true });
        fs.rmSync(binDir, { recursive: true, force: true });
      });
      const ws = await wsConnect(b);
      const res = await wsRequest(ws, 'openExternal', { url: 'https://example.com' }, 'n1');
      ws.close();
      expect(res).toMatchObject({ type: 'response', id: 'n1', data: { ok: true } });
    },
  );

  it('reuses a live instance: the second invocation exits 0 without a second server', async () => {
    const home = makeTmpHome();
    const a = track(await bootCli(home, ['--port', '7355']), home);
    expect(a.reused).toBe(false);
    // Second boot, SAME home + port → sees server-state.json, reuses, prints + exits 0.
    const b = await bootCli(home, ['--port', '7355']);
    expect(b.reused).toBe(true);
    expect(b.stderr()).toContain('coach already running at');
    const code = await new Promise<number | null>((resolve) =>
      b.child.exitCode !== null ? resolve(b.child.exitCode) : b.child.once('exit', resolve),
    );
    expect(code).toBe(0);
  });

  it.skipIf(process.platform === 'win32')(
    'responds to SIGINT with exit 130 and clears server-state.json',
    async () => {
      const home = makeTmpHome();
      cleanups.push(() => fs.rmSync(home, { recursive: true, force: true }));
      const b = await bootCli(home, ['--port', '7356']);
      const stateFile = path.join(home, '.ai-engineer-coach', 'server-state.json');
      expect(fs.existsSync(stateFile)).toBe(true);
      const exited = new Promise<number | null>((resolve) => b.child.once('exit', resolve));
      b.child.kill('SIGINT');
      expect(await exited).toBe(130);
      expect(fs.existsSync(stateFile)).toBe(false); // close() → clearServerState()
    },
  );

  it('fails with a --port hint when 7331..7340 are all taken', async () => {
    // Occupy the whole retry range so listenWithRetry exhausts it (deviation #6).
    const probes: net.Server[] = [];
    cleanups.push(async () => {
      await Promise.all(probes.map((s) => new Promise<void>((r) => s.close(() => r()))));
    });
    for (let p = 7331; p <= 7340; p++) {
      await new Promise<void>((resolve, reject) => {
        const s = net.createServer();
        s.once('error', reject);
        s.listen(p, '127.0.0.1', () => { probes.push(s); resolve(); });
      });
    }
    const home = makeTmpHome();
    cleanups.push(() => fs.rmSync(home, { recursive: true, force: true }));
    // No --port → defaults to 7331 and retries 7331..7340, all taken → exit 1.
    const child = fork(CLI, ['--no-open'], {
      env: { ...process.env, HOME: home, USERPROFILE: home },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let buf = '';
    child.stderr!.on('data', (b: Buffer) => { buf += b.toString(); });
    const code = await new Promise<number | null>((resolve) => child.once('exit', resolve));
    expect(code).toBe(1); // bin/coach maps the rejected runCli to exit 1
    expect(buf).toMatch(/--port/);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npm run test:integration:standalone`
Expected: PASS — Task 4's `cli-boot.test.ts` (7) plus this file. On **Linux**: `cli-rpc-lifecycle` = 5 passed. On **macOS**: 4 passed, 1 skipped (`openExternal` is Linux-only). On **Windows**: 3 passed, 2 skipped (`openExternal` + SIGINT). Total varies by OS; all green/skipped, none failed.

- [ ] **Step 3: Commit**

```bash
git add tests/standalone/integration/cli-rpc-lifecycle.test.ts
git commit -m "test(standalone): integration tests for rpc errors, reuse, SIGINT, port collision"
```

---

## Task 6: Layer 3 — synthetic session-log fixture generator

The Playwright layer needs a `$HOME` populated with enough data that every nav page renders. This task creates a committed generator (deviation #2) that writes Claude Code JSONL sessions spanning the **last 7 days** (relative to run time, so date-windowed pages stay populated). Single-harness by design (deviation #3).

**Files:**
- Create: `tests/standalone/fixtures/seed-home.mjs`

- [ ] **Step 1: Write the generator**

Create `tests/standalone/fixtures/seed-home.mjs`:
```js
// tests/standalone/fixtures/seed-home.mjs
// Writes synthetic Claude Code session logs under <home>/.claude/projects/, spanning the
// last 7 days, so every standalone nav page renders without console errors. Timestamps are
// relative to Date.now() so date-windowed pages stay populated regardless of when CI runs.
// Format per src/core/parser-claude.ts (JSONL: one JSON object per line).
import * as fs from 'node:fs';
import * as path from 'node:path';

const MODELS = ['claude-opus-4-20250805', 'claude-sonnet-4-20250514'];
const TOOLS = ['Write', 'Edit', 'Read', 'Skill'];
const DAY = 86_400_000;

export function seedHome(home) {
  const projectsDir = path.join(home, '.claude', 'projects');
  const projects = ['-Users-coach-demo-api', '-Users-coach-demo-web']; // → two workspaces
  const now = Date.now();

  for (const proj of projects) {
    const dir = path.join(projectsDir, proj);
    fs.mkdirSync(dir, { recursive: true });
    for (let d = 0; d < 7; d++) {
      const sessionId = `sess-${proj.slice(-3)}-${d}`;
      const base = now - d * DAY - 3 * 3_600_000; // mid-day each of the last 7 days
      const lines = [];
      for (let turn = 0; turn < 3; turn++) {
        const userTs = new Date(base + turn * 120_000).toISOString();
        lines.push(JSON.stringify({
          type: 'user',
          timestamp: userTs,
          sessionId,
          cwd: `/Users/coach/${proj}`,
          message: { role: 'user', content: [{ type: 'text', text: `task ${turn} on day ${d}` }] },
        }));
        const asstTs = new Date(base + turn * 120_000 + 30_000).toISOString();
        lines.push(JSON.stringify({
          type: 'assistant',
          timestamp: asstTs,
          sessionId,
          message: {
            role: 'assistant',
            model: MODELS[turn % MODELS.length],
            content: [
              { type: 'text', text: `Working on task ${turn}.` },
              { type: 'tool_use', name: TOOLS[turn % TOOLS.length], input: { file_path: `/Users/coach/${proj}/f${turn}.ts`, content: 'x' } },
            ],
            usage: { input_tokens: 1200 + turn * 100, output_tokens: 300 + turn * 50, cache_read_input_tokens: 500 },
          },
        }));
      }
      fs.writeFileSync(path.join(dir, `${sessionId}.jsonl`), lines.join('\n') + '\n');
    }
  }
  return projectsDir;
}

// `node seed-home.mjs <home>` for manual inspection.
if (process.argv[2]) {
  const dir = seedHome(process.argv[2]);
  process.stdout.write(`seeded ${dir}\n`);
}
```

- [ ] **Step 2: Verify the generator writes valid JSONL into a temp home**

Run:
```bash
node -e "const {seedHome}=require('./tests/standalone/fixtures/seed-home.mjs');" 2>/dev/null || true
node tests/standalone/fixtures/seed-home.mjs /tmp/coach-fixture-probe
node -e "const fs=require('fs'),path=require('path');const root='/tmp/coach-fixture-probe/.claude/projects';let files=0,lines=0;for(const p of fs.readdirSync(root)){for(const f of fs.readdirSync(path.join(root,p))){files++;for(const ln of fs.readFileSync(path.join(root,p,f),'utf8').split('\n').filter(Boolean)){JSON.parse(ln);lines++;}}}console.log('files',files,'lines',lines);"
rm -rf /tmp/coach-fixture-probe
```
Expected: `files 14 lines 84` (2 projects × 7 days = 14 session files; 14 × 6 lines = 84), and **no** `JSON.parse` throw. (On Windows run via Git Bash, or substitute a `%TEMP%` path; the assertion is "14 files, 84 lines, all valid JSON".)

- [ ] **Step 3: Commit**

```bash
git add tests/standalone/fixtures/seed-home.mjs
git commit -m "test(standalone): add synthetic Claude session-log fixture generator"
```

---

## Task 7: Layer 3 — Playwright config + global setup/teardown

Wires Playwright: a Chromium-only config that boots one CLI child against a freshly-seeded `$HOME` in `globalSetup`, records its URL+token in a runtime file the smoke spec reads, and stops it in `globalTeardown`.

**Files:**
- Create: `tests/standalone/playwright/playwright.config.ts`
- Create: `tests/standalone/playwright/global-setup.ts`
- Create: `tests/standalone/playwright/global-teardown.ts`

- [ ] **Step 1: Write the Playwright config**

Create `tests/standalone/playwright/playwright.config.ts`:
```ts
import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  testMatch: '**/*.spec.ts',
  globalSetup: fileURLToPath(new URL('./global-setup.ts', import.meta.url)),
  globalTeardown: fileURLToPath(new URL('./global-teardown.ts', import.meta.url)),
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 30_000,
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], headless: true } }],
});
```

- [ ] **Step 2: Write the global setup**

Create `tests/standalone/playwright/global-setup.ts`:
```ts
import { fork } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedHome } from '../fixtures/seed-home.mjs';

const RUNTIME = fileURLToPath(new URL('./.runtime.json', import.meta.url));
const CLI = path.resolve(fileURLToPath(new URL('../../../dist/standalone/cli.js', import.meta.url)));

export default async function globalSetup(): Promise<void> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-pw-'));
  seedHome(home);
  const child = fork(CLI, ['--no-open', '--port', '7388'], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const url = await new Promise<string>((resolve, reject) => {
    let buf = '';
    const t = setTimeout(() => reject(new Error(`cli did not start in 30s. stderr:\n${buf}`)), 30_000);
    child.stderr!.on('data', (b: Buffer) => {
      buf += b.toString();
      const m = buf.match(/coach running at (http:\/\/127\.0\.0\.1:\d+\/\?t=[0-9a-f]{64})/);
      if (m) { clearTimeout(t); resolve(m[1]); }
    });
    child.once('exit', (c) => reject(new Error(`cli exited (${c}) before serving. stderr:\n${buf}`)));
  });
  const u = new URL(url);
  fs.writeFileSync(
    RUNTIME,
    JSON.stringify({ pid: child.pid, home, origin: u.origin, token: u.searchParams.get('t') }),
  );
  child.unref(); // keep it running for the test run; teardown stops it via pid
}
```

- [ ] **Step 3: Write the global teardown**

Create `tests/standalone/playwright/global-teardown.ts`:
```ts
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const RUNTIME = fileURLToPath(new URL('./.runtime.json', import.meta.url));

export default async function globalTeardown(): Promise<void> {
  if (!fs.existsSync(RUNTIME)) return;
  const { pid, home } = JSON.parse(fs.readFileSync(RUNTIME, 'utf8')) as { pid: number; home: string };
  try { process.kill(pid, 'SIGINT'); } catch { /* already gone */ }
  await new Promise((r) => setTimeout(r, 500)); // let close() clear server-state.json
  try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* ignore */ }
  try { fs.rmSync(RUNTIME, { force: true }); } catch { /* ignore */ }
}
```

- [ ] **Step 4: Verify config + setup load (no smoke spec yet)**

Run:
```bash
npm run build && npx playwright install --with-deps chromium && npx playwright test --config=tests/standalone/playwright/playwright.config.ts --list
```
Expected: Playwright loads the config, runs `globalSetup` (which forks the CLI and writes `.runtime.json`), prints `No tests found` or `Listing tests:` with zero specs (the smoke spec lands in Task 8), then `globalTeardown` stops the child. A clean exit (and a transient `.runtime.json` that teardown removes) confirms the setup/teardown wiring. If `globalSetup` throws "cli did not start", ensure `npm run build` produced `dist/standalone/cli.js`.

- [ ] **Step 5: Commit**

```bash
git add tests/standalone/playwright/playwright.config.ts tests/standalone/playwright/global-setup.ts tests/standalone/playwright/global-teardown.ts
git commit -m "test(standalone): add playwright config and CLI global setup/teardown"
```

---

## Task 8: Layer 3 — smoke spec (10 pages console-clean + banner guards)

The browser smoke test. Navigates to each of the 10 real nav pages **by URL hash** (`…/?t=<token>#<id>`) via the shim's hash bridge (04-webview-shim Task 5), asserts the **right** page rendered (the matching nav link gains `active`) and is console-clean, then pins the curated-banner behavior: present on `#skills` after a user-initiated `createSkill`, absent on `#dashboard` despite its proactive disabled calls. Covers spec acceptance #4 (deep-link/hash navigation), #5 (per-page render guard) and #8 (banner regression guard). The active-link assertion is what makes the per-page guard real — the reused upstream `app.ts` has no hash router of its own, so without the shim bridge every hash would silently render `dashboard` and a bare `main#content > *` check would false-green.

**Files:**
- Create: `tests/standalone/playwright/smoke.spec.ts`

- [ ] **Step 1: Write the smoke spec**

Create `tests/standalone/playwright/smoke.spec.ts`:
```ts
import { test, expect, type ConsoleMessage } from '@playwright/test';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const { origin, token } = JSON.parse(
  fs.readFileSync(fileURLToPath(new URL('./.runtime.json', import.meta.url)), 'utf8'),
) as { origin: string; token: string };

// The 10 real nav page ids. The shim's hash bridge (04-webview-shim Task 5) selects the
// page from `#<id>` after dataReady; navigateTo toggles `active` on the matching nav link
// (app.ts:466). burndown's nav <li> is not emitted while FF_TOKEN_REPORTING_ENABLED is
// false (panel-html.ts:34) and navigateTo('burndown') normalizes to 'dashboard'
// (app.ts:26-29), so its active link is dashboard.
const NAV = [
  'dashboard', 'timeline', 'image-gallery', 'output', 'burndown',
  'patterns', 'anti-patterns', 'skills', 'config-health', 'level-up',
];

const pageUrl = (id: string): string => `${origin}/?t=${token}#${id}`;
// The nav link expected to be `active` once the page rendered (burndown → dashboard).
const activeId = (id: string): string => (id === 'burndown' ? 'dashboard' : id);
const activeLink = (id: string): string => `.nav-links a[data-page="${activeId(id)}"]`;

for (const id of NAV) {
  test(`#${id} renders the right page with zero console errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m: ConsoleMessage) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto(pageUrl(id), { waitUntil: 'load' });
    // The shim's hash bridge navigates after dataReady; the active nav link proves the
    // RIGHT page rendered (not a silent fall-back to dashboard if the hash were ignored).
    // This is the real per-page check acceptance #5 needs — `main#content > *` alone would
    // pass on dashboard 10 times. (auto-retrying assertion: waits for the class to appear.)
    await expect(page.locator(activeLink(id))).toHaveClass(/active/, { timeout: 15_000 });
    // ...and the page actually rendered content (degraded sections still emit nodes).
    await expect(page.locator('main#content')).toBeVisible();
    await expect.poll(() => page.locator('main#content > *').count(), { timeout: 15_000 })
      .toBeGreaterThan(0);

    expect(errors, `console errors on #${id}:\n${errors.join('\n')}`).toEqual([]);
  });
}

test('skills page shows the roadmap banner after a user-initiated createSkill', async ({ page }) => {
  await page.goto(pageUrl('skills'), { waitUntil: 'load' });
  await expect(page.locator('.nav-links a[data-page="skills"]')).toHaveClass(/active/, { timeout: 15_000 });
  // Drive a genuine banner-worthy method through the shim's outbound channel. The host
  // returns standalone-v1-disabled; the shim (createSkill ∈ BANNER_WORTHY) injects the banner.
  await page.evaluate(() => {
    const api = (window as unknown as { acquireVsCodeApi: () => { postMessage: (m: unknown) => void } }).acquireVsCodeApi();
    api.postMessage({ type: 'request', id: 'smoke-create-skill', method: 'createSkill', params: {} });
  });
  await expect(page.locator('#coach-roadmap-banner')).toBeVisible({ timeout: 10_000 });
});

test('dashboard does NOT show the roadmap banner on its proactive disabled calls', async ({ page }) => {
  await page.goto(pageUrl('dashboard'), { waitUntil: 'load' });
  await expect(page.locator('.nav-links a[data-page="dashboard"]')).toHaveClass(/active/, { timeout: 15_000 });
  await expect.poll(() => page.locator('main#content > *').count(), { timeout: 15_000 })
    .toBeGreaterThan(0);
  // Let the proactive triageSkills/discoverCatalog/triageCatalog calls round-trip (silent-disabled).
  await page.waitForTimeout(1_500);
  await expect(page.locator('#coach-roadmap-banner')).toHaveCount(0);
});
```

- [ ] **Step 2: Run the smoke suite**

Run:
```bash
npm run build && npx playwright install --with-deps chromium && npm run test:playwright:standalone
```
(`test:playwright:standalone` = `playwright test --config=tests/standalone/playwright/playwright.config.ts`, from 07-build.)
Expected: PASS — 12 tests (10 page + 2 banner) green on Chromium. If the **active-link** assertion times out for some `#<id>`, the shim's hash bridge (04-webview-shim Task 5) is missing or regressed — the hash was ignored and the page stayed on `dashboard`; fix the bridge there (this is the navigation contract 08 depends on). If a specific `#<id>` instead fails on **console errors**, that page does **not** degrade gracefully on the fixture — return to Task 1's audit (it is the regression this layer exists to catch) and escalate per the decision rule. If the `createSkill` banner test fails, confirm `acquireVsCodeApi` is defined (the shim loaded) and `createSkill ∈ BANNER_WORTHY` (04).

- [ ] **Step 3: Commit**

```bash
git add tests/standalone/playwright/smoke.spec.ts
git commit -m "test(standalone): add playwright smoke for 10 nav pages and banner guards"
```

---

## Task 9: Layer 4 — CI matrix workflow

Adds the GitHub Actions matrix that runs the full stack on Ubuntu/macOS/Windows on Node 20, with Playwright deferred on Windows (historically flaky in Actions) per the spec.

**Files:**
- Create: `.github/workflows/standalone.yml`

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/standalone.yml`:
```yaml
name: standalone
on: [push, pull_request]
jobs:
  test:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        node: ['20']
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
      - run: npm ci
      - run: npm run build && npm run build:standalone
      - run: npm test -- --reporter=verbose
      - run: npm run test:integration:standalone
      - if: runner.os != 'Windows'   # Playwright on Windows in Actions is flaky; deferred to v1.1
        run: npx playwright install --with-deps chromium
      - if: runner.os != 'Windows'
        run: npm run test:playwright:standalone
      - run: npm run pack:check
```
Notes: `npm test` runs unit tests only (root `include: src/**`, build-free) — it does **not** pick up the integration suite (separate config). `npm run build:standalone` (= `node esbuild.mjs`) re-runs the deterministic build; harmless. `npm run pack:check` (= `npm pack --dry-run`) is the publishability gate from 07-build.

- [ ] **Step 2: Validate the YAML parses**

Run:
```bash
node -e "const fs=require('fs');const s=fs.readFileSync('.github/workflows/standalone.yml','utf8');if(!/runs-on: \\\$\{\{ matrix\.os \}\}/.test(s))throw new Error('matrix os missing');if(!/test:integration:standalone/.test(s))throw new Error('integration step missing');if(!/pack:check/.test(s))throw new Error('pack:check step missing');console.log('workflow ok: 3 OS x node 20, integration + playwright(non-win) + pack:check');"
```
Expected: `workflow ok: …`. (If you have `yamllint`/`actionlint` available, also run `actionlint .github/workflows/standalone.yml`; not required.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/standalone.yml
git commit -m "ci(standalone): add cross-platform test matrix workflow"
```

---

## Task 10: Final verification — full local run, additive-only diffs, acceptance gate

Runs the whole stack locally and confirms the fork's additive-only discipline against `upstream/main`. **No source change** — verification only (a fix re-runs the relevant task).

**Files:** none (verification only).

- [ ] **Step 1: Unit suite stays unit-only and green (acceptance #1)**

Run: `npm test`
Expected: PASS — the full unit suite (all `src/**/*.test.ts`, including the new `standalone-html.snapshot.test.ts`) is green, and **no** `tests/standalone/integration/**` file is collected (root `include` is `src/**`). If the integration tests run here, the root config was wrongly broadened — revert; they belong only to `test:integration:standalone`.

- [ ] **Step 2: Integration suite green against a fresh build (acceptance #2)**

Run: `npm run build && npm run test:integration:standalone`
Expected: PASS — `cli-boot.test.ts` (7) + `cli-rpc-lifecycle.test.ts` (3–5 depending on OS, rest skipped). Exit 0.

- [ ] **Step 3: Playwright smoke green on this OS (acceptance #3, skip on Windows)**

Run (macOS/Linux): `npx playwright install --with-deps chromium && npm run test:playwright:standalone`
Expected: PASS — 12 tests green. On Windows, skip (the CI matrix skips Playwright on Windows; deviation/spec).

- [ ] **Step 4: `pack:check` still clean (acceptance #4 publishability gate)**

Run: `npm run pack:check`
Expected: the dry-run manifest prints and exits 0 (the 07-build `files` allowlist is unaffected by the new `tests/` + `.github/` paths — neither is in the publish allowlist).

- [ ] **Step 5: Additive-only — `src/` shows only additions under `src/standalone/`**

Run:
```bash
git diff upstream/main -- src/ | grep -E '^[-+]' | grep -vE '^[-+]{3}'
```
Expected: every line is an addition (`+`) inside `src/standalone/`. 08-testing's only `src/` additions are `__tests__/standalone-html.snapshot.test.ts` and its `__snapshots__/*.snap`; no deletions, no edits outside `src/standalone/`. (If `upstream/main` is not configured: `git remote add upstream https://github.com/microsoft/AI-Engineering-Coach.git && git fetch upstream`.)

- [ ] **Step 6: Additive-only — `package.json` shows additions only (vs upstream)**

Run:
```bash
git diff upstream/main -- package.json | grep -E '^[-+]' | grep -vE '^[-+]{3}'
```
Expected: every changed line is a `+` (the standalone scripts incl. the finalized `test:integration:standalone` and the new `coverage:standalone`, plus 01/02/07's deps/scripts/bin/files — all cumulative additions) except the **one** sanctioned `name`-rename `-/+` pair from 07-build. No other removals. (The `test:integration:standalone` value differs from 07-build's commit, but against `upstream/main` it is a pure addition — upstream has no such key — so only a `+` line appears here.)

- [ ] **Step 7: `tests/` and `.github/` are fork-only new paths (no upstream edits)**

Run:
```bash
git diff upstream/main --name-status -- tests/ .github/ | grep -vE '^A' || echo "all additions"
```
Expected: `all additions` (every `tests/standalone/**` and `.github/workflows/standalone.yml` path is status `A` — added). No `M`/`D` against upstream.

- [ ] **Step 8: Final commit (only if Steps 1–7 required a fix)**

If everything passed, there is nothing to commit. If a fix was needed:
```bash
git add -A
git commit -m "test(standalone): finalize verification stack and additive-only checks"
```

---

## Self-Review

### Spec coverage (`08-testing.md`)

| Spec item | Task | Verification / artifact |
|---|---|---|
| Layer 0 — first-build per-page RPC audit (gated, one-time); pin `BANNER_WORTHY`; halt-if-broken rule | Task 1 | `tests/standalone/PAGE-RPC-AUDIT.md` + grep procedure + decision rule |
| Layer 1 — unit conventions; `vscode` alias (idempotent); coverage tracked manually | Task 2 | alias verify (Step 1), `coverage:standalone` config + script |
| Layer 1 — one snapshot for `renderStandaloneHtml({...})` (Decisions table) | Task 2 | `standalone-html.snapshot.test.ts` + `.snap` |
| Layer 2 — `tests/standalone/integration/*.test.ts`, `child_process.fork(dist/standalone/cli.js)` | Tasks 3–5 | dedicated config + helpers + two test files |
| Integration row: `bundle imports in bare node without vscode` | Task 3 | `cli-boot.test.ts` require-guard |
| Integration row: `cli boots and serves health` | Task 4 | `/health` payload assertion |
| Integration row: `serves loading shell before parse completes` | Task 4 | GET / → 200 + `<!DOCTYPE html>` |
| Integration row: `dataReady arrives over WS after parse` | Task 4 | `wsWaitFor(ws,'dataReady')` |
| Integration row: `cli prints url to stderr` | Task 4 | stderr regex on `coach running at …` |
| Integration row: `second cli reuses first` | Task 5 | reuse → exit 0 + "already running" |
| Integration row: `cli responds to SIGINT with code 130` (state cleared) | Task 5 | POSIX-only; exit 130 + `server-state.json` gone |
| Integration row: `cli with --port honors override` | Task 4 | `/health` on 7354 |
| Integration row: `cli with --no-open does not spawn browser` | Task 4 | boots + serves (deviation #7) |
| Integration row: `disabled method returns data-nested error` | Task 5 | `saveRule` → `{data:{error,code:'standalone-v1-disabled',method}}`, no sibling |
| Integration row: `native openExternal works before dataReady` | Task 5 | Linux-only, fake `xdg-open`; `{data:{ok:true}}` |
| Integration row: `port collision retries +1..+9 then fails` | Task 5 | bind 7331..7340 → exit 1 + `--port` hint (deviation #6) |
| Layer 3 — fixture under `tests/standalone/fixtures/`; 7 days; populate every page | Task 6 | `seed-home.mjs` (relative dates; 14 files/84 lines) |
| Layer 3 — Playwright smoke: 10 nav pages, zero console errors; burndown→dashboard | Tasks 7–8 | `smoke.spec.ts` per-page loop |
| Layer 3 — positive banner on `#skills` (createSkill) | Task 8 | banner-present test |
| Layer 3 — banner ABSENT on `#dashboard` | Task 8 | banner-absent test |
| Layer 4 — CI matrix (3 OS, Node 20; Playwright skipped on Windows; no publish) | Task 9 | `.github/workflows/standalone.yml` |
| Decisions: per-test temp HOME via `HOME`/`USERPROFILE` | Tasks 3–8 | `bootCli`/`globalSetup` env |
| Decisions: coverage gate not enforced in CI | Tasks 2, 9 | report-only script; absent from workflow |
| Acceptance #1 `npm test` exits 0 | Task 10 Step 1 | unit-only run |
| Acceptance #2 `npm run test:integration:standalone` exits 0 | Task 10 Step 2 | post-build run |
| Acceptance #3 Playwright exits 0 (mac/linux) | Task 10 Step 3 | smoke run |
| Acceptance #4 CI green on 3 OS (Playwright skipped on Windows) | Task 9 | workflow |
| Acceptance #4 hash/deep-link navigation (pages reachable by `#<id>` URL) | Task 8 (via 04 Task 5 bridge) | active-link assertion per page |
| Acceptance #5 smoke visits all 10 nav pages; console-error fails it; standalone-html drift guard | Tasks 2, 8 | snapshot + per-page guard (active-link verifies the right page rendered) |
| Acceptance #6 removing a `V1_ALLOWED` method fails a per-module unit test ("exactly 40" in 02) | (02-dispatcher) | not duplicated — `v1-allowed.test.ts` owns it |
| Acceptance #7 bare `require(cli.js)` does not throw | Task 3 | require-guard test |
| Acceptance #8 banner absent on `#dashboard`, present on `#skills` after `createSkill` | Task 8 | two banner tests |

### Placeholder scan

No `TBD`/`TODO`/"handle edge cases"/"similar to Task N". Every test/file step shows complete code; every run step shows the exact command and expected output. Task 1's audit is procedural by nature (a discovery guard) but is fully specified — exact grep commands, the four-bucket rule, the halt-and-escalate condition, and the concrete `BANNER_WORTHY` reconciliation list — not a hand-wave. Acceptance #6 is intentionally **not** re-implemented here (it is 02-dispatcher's `v1-allowed.test.ts`); cited rather than duplicated.

### Type / name consistency

- `dist/standalone/cli.js` (helpers `CLI`, `globalSetup`, the bare-require test) matches 07-build's esbuild `outfile` and `bin/coach`'s require target.
- The stderr URL line regex (`coach (already )?running at http://127.0.0.1:<port>/?t=<64hex>`) matches 05-cli's exact `process.stderr.write` strings (`coach running at ${handle.url}` / `coach already running at ${existing}`), and `handle.url` is `http://127.0.0.1:<port>/?t=<token>` (01-server).
- `/health` payload `{ ok, app:'ai-engineer-coach', version, pid }`, the `dataReady` frame `{ type:'dataReady', currentWorkspace:'' }` (asserted via `toMatchObject({type:'dataReady'})`), the disabled error `{ data:{ error, code:'standalone-v1-disabled', method } }`, and WS close `4001` all match 01-server verbatim.
- `saveRule ∉ V1_ALLOWED` and `openExternal ∈ STANDALONE_NATIVE` match 02-dispatcher; `createSkill ∈ BANNER_WORTHY` and `#coach-roadmap-banner` match 04-webview-shim; `acquireVsCodeApi` is the shim's global (04).
- The smoke spec's hash navigation (`…#<id>`) and active-link assertion (`.nav-links a[data-page="<id>"]` gains `active`) match 04-webview-shim's hash bridge (Task 5) and `app.ts`'s `navigateTo` (`app.ts:466`); the `burndown → dashboard` normalization matches `app.ts:26-29`, and burndown's nav `<li>` being absent matches `panel-html.ts:34` while `FF_TOKEN_REPORTING_ENABLED` is false. The `main#content` selector matches `panel-html.ts:61`.
- `renderStandaloneHtml({ token, appVersion })` and its emitted strings (`coach-token`, `/standalone-shim.js`, `/dist/webview/app.js`, `/dist/webview/styles.css`, no `data-page="burndown"`) match 03-standalone-html — the snapshot pins them.
- Claude fixture layout (`~/.claude/projects/<encoded>/<sessionId>.jsonl`) and line schema (`type`, `timestamp`, `sessionId`, `message.role/content/model/usage`) match `src/core/parser-claude.ts`; `HOME`/`USERPROFILE` redirect matches 06-state's `os.homedir()` usage.
- Scripts referenced — `test:integration:standalone` (finalized here), `test:playwright:standalone`, `pack:check`, `build:standalone` — match 07-build's `package.json` keys; `coverage:standalone` is the one new script this plan adds.
