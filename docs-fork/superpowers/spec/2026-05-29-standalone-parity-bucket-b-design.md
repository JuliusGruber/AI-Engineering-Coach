# Standalone Parity — Bucket B: Rule & Skill Authoring / Write Path (design)

**Date:** 2026-05-29
**Status:** Approved (brainstorming) — code-grounded against upstream handlers and the
standalone surface. Ready for implementation planning.
**Source:** `docs-fork/STANDALONE-PARITY-GAPS.md` § "B. Rule & skill authoring — needs a write path (v1 is read-only)"

## Problem

`docs-fork/STANDALONE-PARITY-GAPS.md` lists bucket B as five authoring features that
are all blocked on the same missing capability — **the standalone build is read-only**:

1. **Rule Editor** — create / edit / tune / live-test rules
   (`getRuleEditor` / `getRuleSource` / `saveRule` / `updateRuleThreshold` / `testRuleLive`).
2. **Anti-Patterns Editor** — editable markdown rules + threshold tuning (shares
   `saveRule` / `updateRuleThreshold`).
3. **Export Summary** — Markdown / JSON summary export (`exportSummary`).
4. **Skill install** — install a skill / catalog item to disk
   (`installSkill` / `installCatalogItem`).
5. **Import registry rules** — surface built-in catalog rules for import/review
   (`importRegistryRules`).

The doc frames the blocker as "needs a write path" and tags most items **Med** ("write
to `~/.ai-engineer-coach/rules/` + shim the `require('vscode')`"). Tracing the code shows
the bucket is **less uniform and lighter** than that framing: the write methods split
across the two dispatch tiers that already exist (after bucket D), one "write" method
already works untouched, and the only genuinely-new infrastructure is **one stub seam**.

### What the code actually shows

The ten methods divide cleanly by **which dispatch tier** they reach and **whether they
actually touch disk**:

**Registry handlers** (`src/webview/panel-rpc.ts`, signature `(analyzer, parseResult, params)`,
reached by the standalone dispatcher's tier 3 today):

- **`saveRule`** (`panel-rpc.ts:800`) — **writes**, but via **Node `fs`/`path`**
  (`require('fs')` at `:808-811`, `fs.writeFileSync` at `:828`), **not** `vscode.workspace.fs`.
  Node built-ins are not aliased to the stub, so this **already works in standalone** — it
  needs only allowlisting. It writes to `getPersonalRulesDir()` (`~/.ai-engineer-coach/rules/`,
  `rule-loader.ts:42/45`) and then calls `approveTrust(getDefaultTrustStore(), …)`
  (`:833-835`); `getDefaultTrustStore()` returns a module-level var (`rule-trust.ts:159-161`)
  that **only the extension sets** (`setDefaultTrustStore`), so in standalone it is `undefined`
  and the trust step is skipped cleanly (trust is bucket C).
- **`getRuleEditor`** (`panel-rpc.ts:710`) — **read-only**. Its `require('vscode')`
  (`:740-742`) is used **solely** to read `vscode.workspace.workspaceFolders?.[0]?.uri.fsPath`
  for the project rule layer, wrapped in a `try/catch` that degrades `workspaceRoot` to
  `undefined` (`:743`). It is the **primary render data** for the Anti-Patterns nav page
  (`page-antipatterns.ts:222`, bare `Promise.all`) and the Rule Editor route
  (`page-rule-editor.ts:106`). The v1-allowlist comment excludes it "because it calls
  require('vscode')" — but the graceful fallback means it is safe to allowlist.
- **`getRuleSource`** (`:794`), **`getRulePreview`** (`:780`), **`updateRuleThreshold`**
  (`:843`), **`testRuleLive`** (`:863`), **`importRegistryRules`** (`:1242`) — all
  **read-only / in-memory** (no disk, no `vscode`). `getRulePreview` was missed by the gaps
  doc but is required: the Rule Editor (`page-rule-editor.ts:474`) and Anti-Patterns
  (`page-antipatterns.ts:1176`) both call it, and it is silent-disabled today
  (`tests/standalone/PAGE-RPC-AUDIT.md` §2).

**Service handlers** (`src/webview/panel-request-service.ts`, signature `(msg: RequestMessage)`,
reached through **bucket D's existing bridge** `src/standalone/request-service-bridge.ts`):

- **`installSkill`** (`panel-request-service.ts:596`) — **writes** via
  `vscode.Uri.file(…)` + `vscode.workspace.fs.writeFile(uri, Buffer.from(content))`
  (`:615-616`) to `${HOME}/.agents/skills/<filename>`; path-traversal-guarded (`:604`).
- **`installCatalogItem`** (`:623`) — **fetch + write**: `fetch` from
  `raw.githubusercontent.com/github/awesome-copilot/…` (`:640`, host-validated at `:636`)
  then `vscode.Uri.file` + `vscode.workspace.fs.writeFile` (`:651-652`) to
  `${HOME}/.agents/{skills,agents}/<slug>/<file>`; traversal-guarded (`:628/:649`).
- **`exportSummary`** (`:237`, `handleExportSummary`) — delegates to
  `exportSummaryFiles(this.analyzer, filter)` (`:247`), self-guarding on `!this.analyzer`
  (`:238`). `exportSummaryFiles` (`src/summary-export-vscode.ts:26`) builds the report from
  the **vscode-free** `core/summary-export.ts` (`buildSummaryExportFromAnalyzer:187`,
  `renderSummaryMarkdown:208`, `renderSummaryJson:204`, `getSummaryExportFilenames:263`) and
  then uses the **VS Code save-dialog + workspace.fs**: `showOpenDialog` (`:35`),
  `Uri.joinPath(folder, name)` (`:47-48`), `workspace.fs.writeFile` (`:50-51`),
  `showInformationMessage`/`env.openExternal` (`:60-65`). Its return shape is
  `SummaryExportWriteResult = { ok, cancelled?, folder?, markdownPath?, jsonPath? }`
  (`:18-24`) — the frozen webview page consumes exactly this.

So all three service-writes funnel through **one `vscode` surface** — `Uri.file`,
`Uri.joinPath`, `workspace.fs.writeFile`, `window.showOpenDialog/showInformationMessage` —
which the stub does not yet provide. Implementing that surface in `vscode-stub.ts` lights
up all three with **zero edits to upstream**, exactly as D's `lm` stub did for the LLM
call sites. The single subtlety: the existing `Uri.joinPath` stub (`vscode-stub.ts:8-13`)
**drops its base argument**, which is harmless for its original caller but wrong for export.

### The `Uri.joinPath` base-fix (the one subtlety)

The current stub is `joinPath: (_base, ...parts) => ({ path: parts.join('/'), fsPath: … })`.
`getDashboardHtml` (`panel-html.ts:11`) — which **is** a live standalone path
(`standalone-html.ts:51` calls it with an empty `{}` extensionUri) — calls
`joinPath(extensionUri, 'dist', 'webview', 'app.js')`. `exportSummaryFiles:47` calls
`joinPath(folder, filenames.markdown)` and writes to the result, so the folder **must not**
be dropped. The fix honors the base only when present:

```
joinPath(base, ...parts) => {
  const b = base?.fsPath ?? base?.path ?? '';
  const joined = [b, ...parts].filter(Boolean).join('/');
  return { path: joined, fsPath: joined };
}
```

This is a **verified no-op** for `getDashboardHtml`: its base is `{}` → `b === ''` →
`filter(Boolean)` drops it → `'dist/webview/app.js'`, identical to today. The standalone
HTML snapshot (`__tests__/standalone-html.snapshot.test.ts`) is therefore byte-identical,
and there are no existing `joinPath` assertions in `__tests__/vscode-stub.test.ts` to break.

### Fork invariant (the constraint that shapes everything)

The fork is **additive-only**: `git diff upstream/main -- src/` touches only
`src/standalone/`; all upstream `src/` is byte-identical. Exposure happens through the
standalone surface (the `vscode` alias → `src/standalone/vscode-stub.ts`, the dispatcher,
and the allowlists). `panel-rpc.ts`, `panel-request-service.ts`, `summary-export-vscode.ts`,
`core/summary-export.ts`, `rule-loader.ts`, and `rule-trust.ts` must remain untouched.

## Goal

Expose all of bucket B in the standalone build by (1) extending `vscode-stub.ts` with the
`workspace.fs` / dialog surface the three service-writes consume, and (2) allowlisting the
ten methods across the two existing dispatch tiers — **without editing any upstream `src/`
file outside `src/standalone/`**, with writes **on by default**, and degrading gracefully
when a write target or the network is unavailable.

This bucket adds **zero new source files**: it reuses D's `request-service-bridge.ts`
verbatim and leaves `dispatcher.ts`, `server.ts`, and `esbuild.mjs` unchanged.

## Decisions (from brainstorming)

| Decision | Choice | Rationale |
| --- | --- | --- |
| Plan scope | **All of B** — Rule Editor + Anti-Patterns editor + Export + Skill install + Import | One stub seam + allowlist adds cover all five line-items; the seam is shared across the three service-writes. |
| Write-path policy | **On by default** (no gate) | The server is localhost + token-gated (`auth.ts`); every write is dir-scoped with the upstream traversal guards; matches the VS Code extension and keeps the dispatcher unchanged. The alternative (a `COACH_ALLOW_WRITES` gate + degraded-mode UX) adds plumbing for a threat the token gate already covers. |
| Service-write mechanism | **Extend `vscode-stub.ts`** (`Uri.file`/`joinPath`/`workspace.fs`/dialogs) | One seam, zero edits to `panel-request-service.ts` or `summary-export-vscode.ts`; same pattern as D's `lm` stub. Rejected: reimplementing each handler natively in `src/standalone` (duplicates upstream logic + drift risk). |
| Export mechanism | **Server-side dir-write**, reusing `exportSummaryFiles` via the stub | Returns the exact `{ ok, folder, markdownPath, jsonPath }` shape the frozen page expects → zero webview changes; reuses the vscode-free core builders through the existing wrapper; lit by the same `workspace.fs` seam as skill-install. The folder-picker degrades to a configured dir. |
| Export dir | **`COACH_EXPORT_DIR` env, default `process.cwd()`** | The natural CLI analog of the extension's "pick a folder" (files land where `coach` was run); overridable for scripted use. |
| `saveRule` exposure | **Allowlist as-is** (registry tier) | It already writes via Node `fs`; no stub needed. Trust recording no-ops (no store) until bucket C. |
| `getRuleEditor` exposure | **Allowlist** (accept the graceful `require('vscode')` fallback) | `workspaceRoot` degrades to `undefined` → personal+builtin rule layers only; project layer arrives with bucket C. Unblocks both the Anti-Patterns page and the Rule Editor route. |
| `testRuleLive` / `importRegistryRules` | **Allowlist for completeness** | Both are in the RPC map and bucket B's line-items but are not wired to any exposed page (`PAGE-RPC-AUDIT.md`); allowlisting is harmless and forward-looking. |
| `createSkill` | **Exclude** (stays degraded) | `panel-request-service.ts:295` opens VS Code Copilot chat (`workbench.action.chat.open`) — no standalone equivalent; not a write. Carried over from D. |
| `reviewLocalRules` | **Exclude** (bucket C) | `panel-rpc.ts:852` calls `vscode.commands.executeCommand` for the trust quick-pick; reimplemented as a browser modal + standalone trust store in bucket C. |

## Scope

Exposed methods (10):

- **Rule Editor / Anti-Patterns (registry):** `getRuleEditor`, `getRuleSource`,
  `getRulePreview`, `saveRule`, `updateRuleThreshold`, `testRuleLive`.
- **Import (registry):** `importRegistryRules`.
- **Skill install (service):** `installSkill`, `installCatalogItem`.
- **Export (service):** `exportSummary`.

### Out of scope (documented degradations, not regressions)

- `createSkill` — opens VS Code chat; stays `BANNER_WORTHY`.
- `reviewLocalRules` + project-layer rule loading — bucket C (trust store + `--project`).
- `getSdlc*` / `getWorkspaceDeps` — bucket E (ride in `PanelRequestService` but not
  allowlisted here).

## Components

### A. The write seam — extend `vscode-stub.ts`

`installSkill`, `installCatalogItem`, and `exportSummary` (via `exportSummaryFiles`) all
consume `vscode` filesystem/dialog members the stub lacks. Add exactly those:

1. **`Uri.file(p)`** → `{ fsPath: p, path: p }` — `installSkill:615`, `installCatalogItem:651`.
2. **`Uri.joinPath`** — replace the base-dropping impl with the base-honoring one (see
   "The `Uri.joinPath` base-fix" above). No-op for `getDashboardHtml`'s `{}` base; correct
   for `exportSummaryFiles:47-48`.
3. **`workspace.fs.writeFile(uri, data)`** →
   `await fs.promises.mkdir(path.dirname(uri.fsPath), { recursive: true })` then
   `await fs.promises.writeFile(uri.fsPath, data)`. The recursive mkdir replicates VS Code's
   auto-parent-create, required for `installCatalogItem`'s nested `~/.agents/<sub>/<slug>/`
   and `installSkill`'s `~/.agents/skills/`. `data` arrives as a `Buffer` (`Buffer.from(...)`)
   / `Uint8Array`, which `fs.writeFile` accepts directly.
4. **`workspace.workspaceFolders`** → `undefined`. Keeps `getRuleEditor:742`
   (`?.[0]?.uri.fsPath` short-circuits to `undefined`) and `exportSummaryFiles:33`
   (`defaultUri = undefined`) degrading cleanly. (Adding `workspace` means `getRuleEditor`
   no longer throws-then-catches; it reads `undefined` directly — same result.)
5. **`window.showOpenDialog(opts)`** → `[{ fsPath: exportDir, path: exportDir }]` where
   `exportDir = process.env.COACH_EXPORT_DIR || process.cwd()`. Always returns the dir, so
   export never hits the `cancelled` branch (`exportSummaryFiles:45`).
6. **`window.showInformationMessage(...)`** → `Promise<undefined>` (no button) → the
   `if (action === 'Open Folder')` branch (`:64`) never fires. **`env.openExternal`** →
   harmless stub (never reached, provided for safety/future use).

These additions are picked up automatically: `esbuild.mjs:189` already aliases
`vscode → ./src/standalone/vscode-stub.ts` for the CLI bundle. No build change.

**Rejected:** reimplementing `exportSummaryFiles` / install handlers natively in
`src/standalone` (duplicates orchestration + invites drift); a native `exportSummary` tier-1
handler (the native signature `(params) => …` has no `ctx`, so it cannot reach
`ctx.analyzer` — export must stay on the analyzer-bearing service tier).

### B. Registry tier — allowlist 7 in `V1_ALLOWED` (45 → 52)

Add to `src/standalone/v1-allowed.ts`: `getRuleEditor`, `getRuleSource`, `getRulePreview`,
`saveRule`, `updateRuleThreshold`, `testRuleLive`, `importRegistryRules`. No dispatcher
change — tier 3 already routes `V1_ALLOWED` members through `getRpcHandler`
(`dispatcher.ts:59-79`).

- `saveRule` writes via Node `fs` (works as-is); trust recording no-ops (`getDefaultTrustStore`
  → `undefined`).
- `getRuleEditor` reads `workspaceRoot = undefined` → `getRuleLayerInfo(undefined)` →
  personal+builtin layers; `getPending()` → empty (no trust store). Renders fully.
- The tier-3a data-ready guard (`dispatcher.ts:64`) is a non-issue: all seven are user
  actions or page-render data reached only post-`dataReady` (the webview renders no page
  until `dataReady`), and the no-data ones (`saveRule`, `updateRuleThreshold`,
  `testRuleLive`, `importRegistryRules`) are never called pre-data regardless. Same
  reasoning as D's NL-rule methods.

### C. Service tier — allowlist 3 in `V1_SERVICE_ALLOWED` (9 → 12)

Add to `src/standalone/v1-service-allowed.ts`: `installSkill`, `installCatalogItem`,
`exportSummary`. No dispatcher change — tier 2 already routes `V1_SERVICE_ALLOWED` members
through `dispatchServiceMethod` (`dispatcher.ts:53-55`), which builds a fresh
`PanelRequestService` per call with `() => ctx.analyzer` / `() => ctx.parseResult`.

- `exportSummary`'s self-guard (`!this.analyzer` → "Dashboard data is still loading",
  `:239`) fires identically to upstream because the bridge passes `() => ctx.analyzer`. The
  tier-2 "no blanket data-ready guard" decision (D § C) preserves this specific message.
- `installSkill` / `installCatalogItem` need no analyzer; they succeed once the stub
  `workspace.fs` is present. `installCatalogItem`'s `fetch` uses the Node global `fetch`
  already relied on by D's `discoverCatalog`.
- Bridge result mapping is unchanged: a `postResponse` frame with no `data.error` →
  `{ ok:true, data }` (e.g. `installSkill` → `{ ok:true, path }`); a `postError` frame →
  `{ ok:false, error:{ code:'handler-error', … } }`. No event frames are emitted by these
  three, so `ctx.emitEvent` is unused here.

### D. Export specifics

`exportSummary` (Level-Up → Share Card tab, `page-peers.ts:338`) reuses `exportSummaryFiles`
**verbatim** through the stub:

- Report built by the vscode-free `core/summary-export.ts` (unchanged).
- `showOpenDialog` → `COACH_EXPORT_DIR || cwd`; `Uri.joinPath(folder, name)` → correct
  absolute paths (base-fix); `workspace.fs.writeFile` → Node `fs` writes `summary-*.md` and
  `summary-*.json`.
- Returns `{ ok:true, folder, markdownPath, jsonPath }` — the page renders "Exported to
  &lt;folder&gt;" with zero webview changes. No interactive picker ⇒ no `cancelled` path.

### E. Shim hygiene — `webview-shim.ts`

- **`BANNER_WORTHY` 4 → 1:** remove `installSkill`, `installCatalogItem`, `getRuleEditor`
  (now live) → `{ createSkill }`. Hygiene-only: once allowlisted, the dispatcher never
  returns `standalone-v1-disabled` for them, so the banner branch (`webview-shim.ts:189`) is
  already unreachable. `createSkill` stays (opens VS Code chat).
- **`RESOLVE_EMPTY_WHEN_DISABLED` → empty:** `getRuleEditor` was the sole member, needed only
  while it was disabled (it is awaited in `renderAntiPatterns`' bare `Promise.all`, so a
  disabled frame would crash the page — see `PAGE-RPC-AUDIT.md` §4). Now that it is
  allowlisted, the neutralization branch (`webview-shim.ts:190-195`) is unreachable for it.
  Empty the set (keep the mechanism inert) for hygiene, mirroring the BANNER cleanup.

### What does NOT change

`src/standalone/dispatcher.ts` (tiers already route service + registry),
`src/standalone/server.ts` (no new events — all three are request/response),
`src/standalone/request-service-bridge.ts` (reused verbatim), `esbuild.mjs` (stub already
aliased). **No new source files.**

## Data flow

Registry writes/reads (e.g. `saveRule`, `getRuleEditor`) — unchanged dispatch path:

```
webview → WebSocket /rpc → dispatcher.dispatch()
  → V1_ALLOWED gate (now includes the 7 rule/import methods)
  → data-ready guard → getRpcHandler(method) → panel-rpc handler
      ├─ saveRule       → Node fs.writeFileSync (~/.ai-engineer-coach/rules/<id>.md)
      └─ getRuleEditor… → in-memory rule engine → { ok, data }
```

Service writes (bridge + stub seam):

```
webview → WebSocket /rpc → dispatcher.dispatch()
  → V1_SERVICE_ALLOWED gate (now includes install×2 + exportSummary)
  → request-service-bridge.dispatchServiceMethod()
  → PanelRequestService.tryHandle({type:'request', id, method, params})
  → handler → vscode-stub workspace.fs.writeFile → Node fs.promises
      └─ capturing webview.postMessage({type:'response', id, data}) → resolve { ok, data }
```

## Error handling & degradation

- **`saveRule`** — on write failure (perms) returns `{ ok:false, error:'Failed to write …' }`
  (`panel-rpc.ts:830`) → page shows the error. Trust step silently skipped (no store).
- **`installSkill`** — missing `HOME` → "Cannot determine home directory" (`:611`); bad
  filename → "Invalid filename" (`:605`); write failure → `handler-error`. All are
  button-action try/catch sites → page degrades, no crash.
- **`installCatalogItem`** — network/GitHub failure → `handler-error` (caught at `:654`);
  invalid path / non-allowlisted host → rejected before fetch (`:628/:636/:649`).
- **`exportSummary`** — `!analyzer` → "Dashboard data is still loading" (`:239`); write
  failure → `handler-error`. Returns `{ ok:true, folder, … }` on success.
- **`getRuleEditor`** — never throws in standalone (the `workspaceRoot` read degrades to
  `undefined`); renders personal+builtin layers, empty pending list.
- **Writes are on by default** — no degraded "writes disabled" path exists; the localhost
  token gate (`auth.ts`) plus the upstream dir-scoping/traversal guards are the controls.

### Write locations (transparency)

AI-feature data flow is documented in bucket D; bucket B adds **disk writes**, all behind
the localhost token gate and dir-scoped:

| Method | Target | Guard |
| --- | --- | --- |
| `saveRule` | `~/.ai-engineer-coach/rules/<safe-id>.md` | id sanitized (`panel-rpc.ts:823`) |
| `installSkill` | `~/.agents/skills/<filename>` | rejects `..` / leading `/` (`:604`) |
| `installCatalogItem` | `~/.agents/{skills,agents}/<slug>/<file>` (+ GitHub fetch) | host-allowlist (`:636`) + `..` checks (`:628/:649`) |
| `exportSummary` | `COACH_EXPORT_DIR` or `process.cwd()` | server-chosen dir (no arbitrary path from the browser) |

## Testing

- **Unit — stub seam (`vscode-stub.test.ts`):** `Uri.file` shape; `Uri.joinPath` honors a
  base with `fsPath`/`path`; **`Uri.joinPath({}, 'a', 'b')` still equals `'a/b'`** (the
  `getDashboardHtml` no-op regression guard); `workspace.fs.writeFile` creates parent dirs
  (mkdir-p) and writes bytes to `uri.fsPath`; `showOpenDialog` returns `COACH_EXPORT_DIR ||
  cwd`; `showInformationMessage` resolves `undefined`.
- **Unit — registry:** `saveRule` writes a parsed rule to a temp `HOME`'s
  `.ai-engineer-coach/rules/` and returns `{ ok:true, filePath }`; `saveRule` with no store
  does not throw on the trust step; `getRuleEditor` returns `layers` with
  `workspaceRoot=undefined` (no throw); `getRulePreview`/`updateRuleThreshold`/`testRuleLive`
  smoke.
- **Unit — gating:** `V1_ALLOWED` / `V1_SERVICE_ALLOWED` membership for the new methods;
  dispatcher tier routing (rule methods → registry; install/export → bridge;
  `reviewLocalRules`/`createSkill` still disabled/banner).
- **Integration (`tests/standalone/integration`):** dispatch `installSkill` (temp `HOME` →
  file appears under `~/.agents/skills/`); `installCatalogItem` against a **fake catalog
  fetch** (base-URL/host shim or mocked `fetch`) → file written + `{ content, filename }`;
  `exportSummary` with `COACH_EXPORT_DIR` set to a temp dir + a built analyzer → both files
  on disk and `{ ok:true, folder, markdownPath, jsonPath }`.
- **Playwright smoke:** Rule Editor saves a rule (toast/`filePath`); Skills installs a skill
  (button → success); Level-Up → Share Card exports a summary ("Exported to …"). Run with
  `COACH_EXPORT_DIR`/`HOME` pointed at the test sandbox so CI writes nowhere real.
- **Snapshot:** `standalone-html.snapshot.test.ts` asserted **unchanged** (joinPath base-fix
  is a no-op for the `{}` base).
- **Pack:** no new bundle entry; confirm the stub additions compile into the existing
  standalone CLI bundle.

### Test deltas (existing pinned counts)

These freeze-guard assertions break by design; update them to the stated targets:

- **`src/standalone/__tests__/v1-allowed.test.ts:6` and `:15`** — `V1_ALLOWED.size`
  pinned `toBe(45)` at two sites → **45 → 52** (adds the 7 rule/import methods). Assumes
  D's three NL-rule additions have landed (current baseline 45).
- **`src/standalone/__tests__/v1-service-allowed.test.ts:6` and `:13`** —
  `V1_SERVICE_ALLOWED.size` pinned `toBe(9)` at two sites → **9 → 12** (adds `installSkill`,
  `installCatalogItem`, `exportSummary`).
- **`src/standalone/__tests__/webview-shim.test.ts:87`** — `BANNER_WORTHY.size` pinned
  `toBe(4)` → **4 → 1** (`{ createSkill }`).
- **`src/standalone/__tests__/webview-shim.test.ts:308`** — the "neutralizes a disabled
  RESOLVE_EMPTY method (getRuleEditor)" test must change: `getRuleEditor` is now allowlisted
  and removed from `RESOLVE_EMPTY_WHEN_DISABLED`. Repurpose it to assert
  `RESOLVE_EMPTY_WHEN_DISABLED.size === 0` (the mechanism is inert); keep the
  "non-RESOLVE_EMPTY banner method keeps rejecting" case (`createSkill`, `:326/:333`)
  unchanged.

## Invariant verification

After implementation, `git diff upstream/main -- src/` must still touch only
`src/standalone/`. Changes live in: modified `src/standalone/vscode-stub.ts`,
`v1-allowed.ts`, `v1-service-allowed.ts`, `webview-shim.ts`; plus docs/tests. **No new
source files**, and no change to `dispatcher.ts`, `server.ts`,
`request-service-bridge.ts`, or `esbuild.mjs`. No upstream `src/` file outside
`src/standalone/` is modified.

## Suggested sequencing (for the implementation plan)

Three layers — the stub seam first, then the two allowlist groups (independent of each
other once the seam exists):

1. **Layer 1 — Stub seam:** `Uri.file`, `Uri.joinPath` base-fix, `workspace.fs.writeFile`
   (+ `workspaceFolders`), `window.showOpenDialog/showInformationMessage` (+ `env.openExternal`)
   in `vscode-stub.ts` + stub unit tests (incl. the `{}`-base no-op guard). Independently
   verifiable; snapshot asserted unchanged.
2. **Layer 2 — Registry tier:** allowlist the 7 rule/import methods in `v1-allowed.ts` +
   registry unit tests (`saveRule` write, `getRuleEditor` degrade, `getRulePreview`). Depends
   on nothing in Layer 1 (these don't use the stub fs seam). `getRuleEditor` reads
   `workspace.workspaceFolders` — added in Layer 1 — but works regardless of ordering: with
   the `workspace` stub absent its `require('vscode').workspace.workspaceFolders` throws and
   the upstream `try/catch` (`panel-rpc.ts:743`) degrades `workspaceRoot` to `undefined`; with
   it present the read returns `undefined` directly. Same result either way.
3. **Layer 3 — Service tier:** allowlist `installSkill`/`installCatalogItem`/`exportSummary`
   in `v1-service-allowed.ts` + `BANNER_WORTHY`/`RESOLVE_EMPTY_WHEN_DISABLED` hygiene +
   integration/smoke. Depends on Layer 1 (the stub fs/dialog seam).

Each layer verifies the additive-only invariant before completion.
