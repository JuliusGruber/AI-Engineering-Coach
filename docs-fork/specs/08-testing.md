# 08 — Testing

The verification layer that backs up every per-module spec. Covers
unit, integration, end-to-end smoke, and cross-platform CI.

## Goal

When this spec is implemented, the standalone fork has:

- Unit coverage for each module's contract (already enumerated in
  specs 01–06).
- Integration tests that spawn the CLI as a child process and exercise
  the boot / single-instance / shutdown lifecycle.
- A Playwright smoke test that loads each visible page in a real
  browser and asserts no console errors.
- A CI matrix that runs the above on macOS, Linux, Windows on Node 20.

## Files

| Path                                           | Purpose                                  | LOC |
|------------------------------------------------|------------------------------------------|-----|
| `src/standalone/__tests__/*.test.ts`           | Unit tests (defined per-spec)            | (see per-spec test plans) |
| `tests/standalone/integration/*.test.ts`       | Multi-process integration tests          | ~200 |
| `tests/standalone/playwright/smoke.spec.ts`    | Browser smoke test                       | ~120 |
| `tests/standalone/playwright/playwright.config.ts` | Playwright config                    | ~30  |
| `tests/standalone/fixtures/`                   | Synthetic session logs for tests         | ~ (data) |
| `.github/workflows/standalone.yml`             | CI matrix (or extend existing workflow)  | ~80  |

Unit tests live next to the modules (`src/standalone/__tests__/`) to
match the existing vitest convention. Integration and Playwright tests
live under `tests/standalone/` because they are slower and exercise
multiple modules.

## Test layers

### Layer 0: first-build per-page RPC audit (one-time, gated)

Before the Playwright list is finalized, the implementing agent performs a
mechanical audit that pins the visibility decisions to evidence:

1. For **every** page id in `ALL_NAV_ENTRIES`, grep its `page-*.ts` for
   `rpc('…')` / `rpcAllSettled([... 'method' ...])` calls.
2. Classify each method into one of four buckets:
   - **registry-allowlisted** (`V1_ALLOWED`) — works.
   - **native** (`STANDALONE_NATIVE`) — works.
   - **silent-disabled** — degrades the section quietly.
   - **banner-worthy** — user-initiated; shows the roadmap banner.
3. **Decision rule:** any page whose *primary* data source is
   silent-disabled (e.g. `sdlc`) moves to `HIDDEN_IN_STANDALONE_V1`.
   Pages that merely have a *secondary* degrading section (dashboard's
   skill suggestions, `config-health`'s context review) stay visible.
4. Record the audit table in the PR description and reconcile it against
   the feasibility doc's page-visibility table.

This is the same audit referenced by
[03-standalone-html](03-standalone-html.md) and is the guard that catches
a future upstream page added with a disabled data source.

### Layer 1: unit (vitest)

Each per-module spec already enumerates its unit test cases. This spec
does not duplicate the list — it sets the conventions:

- Framework: **vitest** (already in upstream `package.json`).
- Environment: `node` for server / dispatcher / state / cli / flags;
  `jsdom` for webview-shim and standalone-html.
- **`vscode` alias (required).** The vitest config adds
  `resolve.alias: { vscode: <abs path to src/standalone/vscode-stub.ts> }`.
  Without it, any test that imports the real `panel-rpc` (e.g. the
  dispatcher round-trip, the server integration test) fails to resolve
  the transitive top-level `import * as vscode` in `panel-shared.ts:7`.
  With it, those tests exercise the **real** upstream handlers instead of
  mocks. Mirrors the esbuild alias in [07-build](07-build.md).
- Mocks: prefer `vi.mock(...)` over real network or filesystem when
  possible. The state-module tests use a tmpdir via
  `os.tmpdir()` + per-test cleanup.
- Coverage target: **80% lines for `src/standalone/`**. Not enforced
  in CI in v1; tracked in a `coverage:standalone` script that the
  implementer runs manually.

### Layer 2: integration (vitest, multi-process)

Lives under `tests/standalone/integration/`. Uses
`child_process.fork('dist/standalone/cli.js', [...])` to spawn the
real CLI binary. Asserts on the child's stderr (URL line, status
messages), HTTP probes to `/health` and `/`, and exit codes.

| Test name                                       | Intent                                                      |
|-------------------------------------------------|-------------------------------------------------------------|
| `bundle imports in bare node without vscode`    | `require('dist/standalone/cli.js')` does not throw (vscode-alias regression guard; mirrors [07-build](07-build.md) AC 2a) |
| `cli boots and serves health`                   | Fork CLI, fetch `/health`, assert payload                   |
| `serves loading shell before parse completes`   | GET `/` returns 200 immediately after boot, before `dataReady` |
| `dataReady arrives over WS after parse`         | WS client connects, receives `{type:'dataReady'}` once parse finishes |
| `cli prints url to stderr`                      | Regex match on captured stderr                              |
| `second cli reuses first`                       | Fork two children, assert second exits 0 in < 1 s           |
| `cli responds to SIGINT with code 130`          | Send signal, assert exit code, assert `server-state.json` cleared |
| `cli with --port honors override`               | Probe non-default port                                      |
| `cli with --no-open does not spawn browser`     | `OPEN` env var (provided to `open` lib's fallback) is unused; mock via PATH manipulation |
| `disabled method returns data-nested error`     | WS client sends `{method:'saveRule'}`; asserts `{type:'response', id, data:{error, code:'standalone-v1-disabled', method}}` |
| `native loadModelBudgets works before dataReady`| WS sends `loadModelBudgets` immediately; asserts `{}` (no analyzer needed) |
| `port collision retries +1..+9 then fails`      | Pre-bind two probe servers on 7331..7340, assert exit 1     |

Set `COACH_HOME=<tmpdir>` env var support in [05-cli](05-cli.md)? **No
— do not add an env-var override in v1.** Tests instead set `HOME` (or
`USERPROFILE` on Windows) to a tmpdir before forking; the state module
already resolves through `os.homedir()`. This keeps the production
surface clean.

### Layer 3: Playwright smoke

Lives under `tests/standalone/playwright/`. One spec file in v1.

Setup:

1. Generate a synthetic session log fixture under
   `tests/standalone/fixtures/home/.claude/...` with enough data to
   populate every visible page (minimal viable: 7 days of sessions
   across 3 harnesses).
2. Boot the CLI with `HOME` (or `USERPROFILE`) pointing at the fixture
   home, on a random free port.
3. For each entry in `visibleNavEntries()` from
   [03-standalone-html](03-standalone-html.md):
   - Navigate to `http://127.0.0.1:<port>/?t=<token>#<id>`.
   - Wait for `main#coach-main` to be populated (selector exists +
     children > 0).
   - Assert page console contains zero `error`-level entries.
4. Banner behavior depends on *why* a page is hidden (see
   [03-standalone-html](03-standalone-html.md) — two reasons):
   - **Authoring/LLM hidden pages** (`rule-editor`, `rule-playground`,
     `antipatterns-editor`, `data-explorer`, `learning`): navigate to
     `#<id>`, trigger a **banner-worthy** disabled method (the page fires
     one on mount; if not, `postMessage` a known banner-worthy method like
     `getRuleEditor`), and assert `#coach-roadmap-banner` exists.
   - **`sdlc`** (hidden because its data source is silent-disabled):
     navigate to `#sdlc`, assert the page renders **without** crashing
     and **without** a banner (its methods are silent-disabled).
5. **Dashboard must NOT show the banner.** Navigate to `#dashboard`,
   let it fire its proactive `triageSkills`/`discoverCatalog`/
   `triageCatalog` calls, and assert `#coach-roadmap-banner` is **absent**
   — the regression guard for the curated-banner decision
   ([00-overview](00-overview.md#disabled-method-ux-banner-vs-silent)).

Acceptance: all assertions pass on the first browser (Chromium). Cross-
browser is **not** required in v1.

### Layer 4: CI matrix

`.github/workflows/standalone.yml` (or extend the existing workflow if
it already runs vitest):

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
        with: { node-version: ${{ matrix.node }} }
      - run: npm ci
      - run: npm run build && npm run build:standalone
      - run: npm test -- --reporter=verbose
      - run: npm run test:integration:standalone
      - if: runner.os != 'Windows'    # Playwright on Windows in CI is flaky; defer
        run: npx playwright install --with-deps chromium
      - if: runner.os != 'Windows'
        run: npx playwright test --config=tests/standalone/playwright/playwright.config.ts
      - run: npm run pack:check
```

Decisions on the matrix:

- **Node 20 only.** The feasibility doc commits to Node 20+; we test
  the minimum supported version. Add Node 22 if a user requests it.
- **Playwright on Linux + macOS only.** Windows Playwright in GitHub
  Actions is historically flaky and slow. The unit + integration tests
  do run on Windows, which catches the platform-specific bugs (path
  separators, file modes). Smoke on Windows is a v1.1 addition.
- **No `npm publish` in CI.** Manual publish to npm by the maintainer
  for v1.

## Decisions

| Open question                                 | Decision                                                          | Why |
|-----------------------------------------------|-------------------------------------------------------------------|-----|
| Coverage gate in CI                           | Not enforced in v1                                                | Per-spec test plans are concrete; coverage gate adds noise |
| Playwright cross-browser                      | Chromium only                                                     | The webview targets evergreen Chromium-class browsers; Firefox/WebKit parity is a v2 goal |
| Fixture session logs                          | Hand-curated minimal set under `tests/standalone/fixtures/`       | Repeatable; faster than auto-generation |
| Per-test temp HOME                            | Set `HOME` / `USERPROFILE` env vars                               | No new env-var contract in production code |
| Snapshot tests for HTML output                | One snapshot for `renderStandaloneHtml({...})` output             | Catches accidental nav/CSP/CSS changes |
| Test pyramid skew                             | Unit > integration > smoke                                        | Standard, fastest feedback loop |

## Dependencies

- npm dev deps to add (in `devDependencies`, not `dependencies`):
  - `@playwright/test` (^1.4x — latest stable at impl time)
- Fixtures (test-time): synthetic log files committed under
  `tests/standalone/fixtures/`. Total size budget: **2 MB**.

## Acceptance criteria

1. `npm test` runs all unit tests (existing + new under
   `src/standalone/__tests__/`) and exits 0.
2. `npm run test:integration:standalone` (script defined in
   [07-build](07-build.md)) runs all integration tests and exits 0.
3. `npx playwright test --config=tests/standalone/playwright/playwright.config.ts`
   exits 0 on macOS and Linux.
4. The CI workflow runs end-to-end green on all three OSes (with
   Playwright skipped on Windows per decision above).
5. Modifying `nav-config.ts` to drop a visible entry causes the
   Playwright smoke test to fail (regression guard for nav drift).
6. Modifying `V1_ALLOWED` to remove a method causes the relevant
   per-module unit test to fail (verified by the "exactly 40" assertion
   in [02-dispatcher](02-dispatcher.md)).
7. `require('dist/standalone/cli.js')` in a bare Node process (no
   `vscode` module present) does not throw — the `vscode`-alias
   regression guard.
8. The Playwright suite asserts `#coach-roadmap-banner` is **absent** on
   `#dashboard` and **present** on a deep-linked banner-worthy hidden
   page — the curated-banner regression guard.

## Test plan

This spec is itself the test plan; per-module test plans live in their
specs. Cross-cutting:

| Verification                          | Where                                                  |
|---------------------------------------|--------------------------------------------------------|
| Boot performance                      | Integration: assert URL printed within 3 s on CI       |
| Network-egress zero                   | Manual: run with packet-capture, document in README    |
| Tarball publishability                | `npm run pack:check` in CI                             |
| Cross-platform paths                  | Integration tests run on all three OSes in matrix      |
| Console-clean smoke                   | Playwright per-page assertion                          |

## Out of scope for v1

- Cross-browser Playwright (Firefox / WebKit)
- Performance benchmarks (boot time, RPC latency)
- Mutation tests
- Fuzz tests on the WS envelope parser
- Property-based tests on the dispatcher

Each can be added as a v1.1 addendum without changing any of the
shipped spec files; they slot into existing layers.
