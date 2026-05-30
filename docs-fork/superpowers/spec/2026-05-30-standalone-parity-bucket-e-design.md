# Standalone Parity — Bucket E (Agentic SDLC local scans) — Design

**Date:** 2026-05-30
**Status:** Approved (brainstorming), pending implementation plan
**Scope decision:** 3 local scans only (see § Scope). `getSdlcGitHubData` excluded.
**Related:** `docs-fork/STANDALONE-PARITY-GAPS.md` § E; bucket D design
(`2026-05-27-standalone-parity-bucket-d-design.md`), bucket B design
(`2026-05-29-standalone-parity-bucket-b-design.md`).

## Problem

The standalone build's **Agentic SDLC** tab (Level Up → SDLC sub-tab,
`page-sdlc.ts`) is stuck on its `LoadingScreen`. `renderSdlc` awaits three RPC
methods in parallel (`page-sdlc.ts:89-93`); two of them — `getSdlcToolAnalysis`
and `getSdlcRepoScan` — are not exposed by any standalone allowlist tier. The
dispatcher returns `{ok:false, error:{code:'standalone-v1-disabled'}}`, the
server maps that to a `response` frame carrying `data.error`, and the webview
listener **rejects** the `rpc()` promise (`shared.ts:62-63`). So the
`Promise.all` **rejects** and `renderSdlc` **throws** — it does not hang on a
pending promise. The *visible* outcome depends on entry path:

- **Initial Level-Up render** — `renderTab(activeTab)` runs inside `renderLevelUp`,
  which is wrapped in `withErrorBoundary('Level Up', …)` (`app.ts:648`). The throw
  is caught → error UI.
- **Clicking the SDLC sub-tab** — `renderTab` runs in a `void`-ed floating async
  with no catch (`page-experiments.ts:182`). `render(null, tabContent)` has
  already cleared the pane and `renderSdlc` re-rendered `LoadingScreen` before it
  threw, so the rejection is unhandled and the loading screen is left on screen.
  This is the "loads forever" symptom — a swallowed rejection, not a pending
  promise.

Separately, the already-shipped **Learning** page calls `getWorkspaceDeps`
(`page-learning.ts:686`) for quiz personalization; with that method unexposed,
personalization silently degrades to generic content.

All three handlers **already exist** in `PanelRequestService`
(`src/webview/panel-request-service.ts`) and are **already reachable** through
the standalone service-bridge built for bucket D
(`src/standalone/request-service-bridge.ts`). They are simply absent from the
`V1_SERVICE_ALLOWED` frozen set, so the dispatcher rejects them at the allowlist
gate. This is therefore an **exposure** task, not a rebuild — despite the
parity-gaps doc's "needs the dropped data service rebuilt" framing, the service
is present and the handlers are `vscode`-free.

## Scope

**In scope** — expose three local-scan methods, taking `V1_SERVICE_ALLOWED` from
12 → 15:

| Method | Consumer(s) | Reads |
|---|---|---|
| `getSdlcToolAnalysis` | `page-sdlc.ts:91`, `page-experiments.ts:221` (badge) | `parseResult.sessions` only (pure) |
| `getSdlcRepoScan` | `page-sdlc.ts:92` | workspace roots + `.git/config`, `.github/*` via Node `fs` |
| `getWorkspaceDeps` | `page-sdlc.ts` (via score), `page-learning.ts:686` | workspace roots + `package.json` via Node `fs` |

**Out of scope** — `getSdlcGitHubData`. It has **no call site** in `page-sdlc.ts`
(verified: the page consumes only `getSessions`, `getSdlcToolAnalysis`,
`getSdlcRepoScan`); it requires `vscode.authentication.getSession('github', …)`
(absent from the stub) plus outbound network. Excluding it has zero UI impact in
the current standalone build. Rated "Hard" in the parity-gaps doc; deferred.

### Per-harness coverage (important — partial delivery)

Two of the three methods (`getSdlcRepoScan`, `getWorkspaceDeps`) resolve data
through `resolveWorkspaceRoot()` (`panel-request-service.ts:1017`), which returns
a root only when `workspace.path` is a directory containing
`workspace.json`/`workspace.yaml`/`package.json`. `workspace.path` comes from
`parser-harnesses.ts:30`: `session.workspaceRootPath` (if it exists on disk),
else the harness *log* directory.

**Only the Codex parser sets `workspaceRootPath`** (`parser-codex.ts:532`, from
`meta.cwd`). The Claude (`parser-claude.ts:668`) and OpenCode
(`parser-opencode.ts:293`) parsers do **not** — they have the project dir in
scope (`cwd` / `rawSession.directory`) but never pass it. So their
`workspace.path` falls back to `~/.claude/projects` (or the OpenCode storage
dir), which has no `package.json`, and `resolveWorkspaceRoot` returns `null` →
the workspace is silently dropped from the scan.

Resulting coverage:

| Harness | `getSdlcToolAnalysis` (MCP) | `getSdlcRepoScan` | `getWorkspaceDeps` |
|---|---|---|---|
| Codex (and VS Code `workspaceStorage`) | ✅ | ✅ | ✅ |
| Claude | ✅ (pure math) | ❌ empty | ❌ empty (quiz stays generic) |
| OpenCode | ✅ (pure math) | ❌ empty | ❌ empty (quiz stays generic) |

**This is accepted (decision: pure Approach A).** Making repo-scan/deps populate
for Claude/OpenCode requires setting `workspaceRootPath` in those two parsers —
an edit to shared `src/` outside `src/standalone/`, which would add deliberate
fork-ahead drift. That fix is **deferred and tracked separately** (see
*Follow-up* below); it is **not** part of this bucket-E change. The empty repo
column is correct behavior given the unresolved root, not a bug in this work.

### Follow-up (separate, not in this change)

File a tracked item: "Claude/OpenCode parsers don't set `workspaceRootPath`
(Codex does)." Fixing it is a ~2-line portable correctness change
(`workspaceRootPath: cwd` in `parser-claude.ts`, `: rawSession.directory` in
`parser-opencode.ts`) that an `fs.existsSync` guard already makes safe. It would
light up repo-scan + deps + quiz personalization for the dominant standalone
harnesses and is an upstream-it candidate — but it is shared-`src/` drift and so
is kept out of this allowlist-only change by design.

## Approach (chosen: A — pure allowlist exposure)

Add the three method names to the frozen set in
`src/standalone/v1-service-allowed.ts`. The dispatcher
(`src/standalone/dispatcher.ts:53`) already routes any `V1_SERVICE_ALLOWED`
member to `dispatchServiceMethod`, which constructs a fresh `PanelRequestService`
per call with `() => ctx.analyzer` / `() => ctx.parseResult` and a capturing
fake webview. No handler, page, or shared-`src/` edits.

**Rejected alternatives:**
- **B — also harden `page-sdlc.ts`** with an explicit empty/error state.
  Rejected: `page-sdlc.ts` is a reused upstream file; editing it creates drift
  *outside* `src/standalone/`, violating the additive-only invariant — and it is
  unnecessary (the page already gates on `getSessions`, a data-ready-guarded
  registry method, during the serve-then-parse window).
- **C — reimplement the scans as `STANDALONE_NATIVE` handlers.** Rejected:
  duplicates ~120 lines of upstream fs logic for no benefit; the bridge works.

## Boundary discipline

Every code edit lands in `src/standalone/` (the allowlist + its tests) or
`docs-fork/`. **No edits** to `panel-request-service.ts`, `page-sdlc.ts`,
`page-learning.ts`, `page-experiments.ts`, or any shared `src/` file. The
"additive on top of upstream outside `src/standalone/`" invariant holds.

## Data flow

Identical to the 12 shipping bridge methods. Example (`getSdlcToolAnalysis`):

```
page-sdlc.ts:91  rpc('getSdlcToolAnalysis', {filter})
  → server → dispatch() → V1_SERVICE_ALLOWED.has() ✓ → dispatchServiceMethod()
  → new PanelRequestService(captureWebview, ()=>ctx.analyzer, ()=>ctx.parseResult)
  → handler counts mcp_ prefixes in parseResult.sessions[].requests[].toolsUsed
  → postResponse({mcpServers}) → captureWebview.postMessage → resolve({ok:true,data})
```

`getSdlcRepoScan` and `getWorkspaceDeps` follow the same path; their handlers
call `resolveWorkspaceRoots()` and read fixed relative paths under each resolved
root via Node `fs` (all wrapped in internal try/catch).

### Serve-then-parse window

The bridge tier has **no data-ready guard** by design (dispatcher.ts:50-52). If a
request lands before parse completes, `ctx.parseResult` is `undefined` and each
bridge handler self-guards to a valid empty result:
- `getSdlcToolAnalysis` → `{mcpServers: []}`
- `getWorkspaceDeps` → `{deps: []}`
- `getSdlcRepoScan` → `resolveWorkspaceRoots()` returns `[]` → `{repos: []}`

The two bridge methods therefore never reject. **But the SDLC page is a
multi-RPC page:** `page-sdlc.ts` also awaits `getSessions`, which is *registry*
tier and **does** data-ready-guard (dispatcher.ts:64 → `handler-error: 'data not
ready'`). So during the cold-start window the page's `Promise.all` still rejects
transiently — on `getSessions`, not on the SDLC methods — and `renderSdlc`
throws, leaving the loading screen until the next render once parse completes.
This is **pre-existing multi-RPC behavior** (every multi-RPC page behaves this
way before data-ready) and is **not introduced by this change**; allowlisting the
two SDLC methods neither causes nor worsens it. The bridge methods' self-guarding
to empty is what makes them safe to expose without a guard; the transient
cold-start throw is owned by `getSessions` and self-heals.

## Error handling

- `dispatchServiceMethod` wraps construction/dispatch in try/catch → it never
  rejects the dispatcher promise.
- All fs failures are swallowed **inside** the handlers (try/catch → empty
  result). Net effect: these three methods cannot surface an error to the UI;
  worst case is empty data, which every consumer already renders gracefully
  (`sdlc-empty` cards; `deps ?? []` in the Learning page).
- No `emitEvent` path: unlike `reviewContextFiles`, none of these emit event
  frames, so per-socket event forwarding is irrelevant.
- `rewriteLlmUnavailable` in the bridge is a no-op here (no LLM calls).

## Security

1. **Credential safety in `.git/config`:** `getGitHubRemote`'s regex anchors on
   `https://github.com/` (or `git@github.com:`) immediately, then captures the
   `owner/repo` segment. A credentialed remote
   (`https://user:token@github.com/...`, token-only, or `x-access-token:...@`)
   has text between `https://` and `github.com/`, so it **fails to match
   entirely** → `remote` is `null` (verified empirically across all four
   credential shapes). The credential is therefore never captured — neither
   leaked *nor* partially stripped into `owner/repo`. Non-GitHub remotes
   (e.g. `gitlab.com`) also yield `null`. Clean HTTPS/SSH → `owner/repo`.
2. **Path scope:** `resolveWorkspaceRoots()` resolves only roots already recorded
   in the user's own parsed harness sessions (`parseResult.workspaces`), then
   reads fixed relative paths (`package.json`, `.git/config`, `.github/{agents,
   workflows,aw}`). No user-supplied path; no traversal vector.
3. **Sensitivity vs. shipped surface:** strictly read-only local data over the
   same localhost + token-gated socket bucket B already uses for fs *writes*
   (`installSkill` writing `~/.agents/...`). Reading `package.json`/`.github` is
   less sensitive than writes already in production. No new surface.
4. **No network:** the GitHub-fetch path (`getSdlcGitHubData`) is excluded, so no
   outbound requests are introduced.

## Testing

Mirrors the bucket B/D contract-test pattern. Five layers:

1. **Frozen-set membership** (`src/standalone/__tests__/v1-service-allowed.test.ts`,
   edit existing). Three concrete edits:
   - Change `toBe(12)` → `15` in **both** the count test and the frozen-mutation
     test (two occurrences).
   - **Rewrite** the existing
     `it('excludes createSkill … and the bucket-E service methods')` block — it
     currently asserts `getWorkspaceDeps`/`getSdlcRepoScan` are `false` (lines
     33-34), which will go red. Rename it to
     `it('excludes createSkill (VS Code chat) and getSdlcGitHubData (needs auth/network)')`
     and have it assert **both** `createSkill` and `getSdlcGitHubData` are `false`.
     Note `getSdlcGitHubData`'s exclusion is a *new* first-time assertion (it is
     untested today), not a "keep" — it pins the one deferred bucket-E method.
   - **Add** `it('includes the bucket-E local-scan methods')` asserting
     `getSdlcToolAnalysis`, `getSdlcRepoScan`, `getWorkspaceDeps` are all `true`.
   - Refresh any line-number citations in `tests/standalone/PAGE-RPC-AUDIT.md`
     that point at the old assertion lines, since the block is restructured.
2. **Per-method bridge contract** (new file
   `src/standalone/__tests__/sdlc-bridge.test.ts`, keeping the SDLC contract
   isolated from the existing bridge test): dispatch each via
   `dispatchServiceMethod` with a hand-built `ctx`:
   - `getSdlcToolAnalysis` — sessions with `mcp_github_*` tools →
     `{mcpServers:[{id:'github', isSdlcRelevant:true, toolCalls:N}]}`.
   - `getWorkspaceDeps` — `parseResult.workspaces` entry whose `.path` is a temp
     dir containing `package.json` (the Codex-shaped, resolvable-root case) →
     `{deps:[{workspace, dependencies, devDependencies}]}`.
   - `getSdlcRepoScan` — `.path` = temp dir with `.github/workflows/ci.yml` →
     `{repos:[{workflows:['ci.yml'], …}]}`.
3. **Unresolved-root → empty** (encodes the documented Claude/OpenCode partial
   coverage as an executable spec, so the empty result is intentional-and-tested,
   not a latent regression): a `parseResult` whose `workspaces` entry has `.path`
   pointing at a temp dir with **no** `workspace.json`/`workspace.yaml`/
   `package.json` (the log-dir shape) → `getSdlcRepoScan` → `{repos:[]}` and
   `getWorkspaceDeps` → `{deps:[]}`, both `{ok:true}`.
4. **Serve-then-parse guard**: dispatch each with `ctx.parseResult` undefined →
   assert `{ok:true}` with empty `{mcpServers:[]}` / `{deps:[]}` / `{repos:[]}`,
   never `ok:false`.
5. **Security regression** (two assertions — the credentialed case yields `null`,
   *not* a stripped `owner/repo`, so test both):
   - `.git/config` with `url = https://user:ghp_secret@github.com/owner/repo.git`
     → `remote` is `null`, and the full response JSON contains neither
     `ghp_secret` nor `user:`.
   - `.git/config` with a clean `url = https://github.com/owner/repo.git`
     → `remote` is exactly `owner/repo` (proves the regex still extracts the
     happy path — guards against an over-eager "match nothing" fix).

Temp-dir fs tests use the repo's existing pattern (real `fs` in an `os.tmpdir()`
scratch dir, cleaned in `afterEach`), consistent with bucket B's service-writes
tests — no new mocking infra.

**No e2e change required:** `tests/e2e/harness.html:411` already stubs
`getSdlcRepoScan`, so the e2e harness renders the tab today; this work is
server-side allowlist + contract coverage.

## Documentation updates (part of this work)

1. **`docs-fork/STANDALONE-PARITY-GAPS.md`** — move bucket E's three local-scan
   methods from "gap" to SHIPPED, **annotated with the per-harness caveat**
   (repo-scan/deps populate for Codex + VS Code `workspaceStorage`; empty for
   Claude/OpenCode until their parsers carry a root path). Update the Per-method
   degradations table: the SDLC-tab row is resolved; the Learning
   `getWorkspaceDeps` row is downgraded, not removed — it now degrades only for
   Claude/OpenCode (was: always). Note `getSdlcGitHubData` remains the sole
   deferred bucket-E *method*, and add the parser `workspaceRootPath` follow-up.
2. **`docs-fork/STANDALONE-UI-FEASIBILITY.md:134`** — correct the stale claim
   that the SDLC page is "Hidden via `HIDDEN_IN_STANDALONE_V1`; silent-disabled."
   No such constant exists in `src/` (verified by grep). The tab is reachable via
   the Level Up sub-tab and, after this change, renders its local-scan data.
3. **`src/standalone/v1-service-allowed.ts`** header comment — update the
   12-method tally to 15 and adjust the "still excludes the bucket-E methods"
   note to reflect that only `getSdlcGitHubData` remains excluded.

## Acceptance criteria

- `V1_SERVICE_ALLOWED.size === 15`; contains `getSdlcToolAnalysis`,
  `getSdlcRepoScan`, `getWorkspaceDeps`; still excludes `getSdlcGitHubData` and
  `createSkill`.
- The SDLC tab resolves and renders instead of leaving the loading screen on
  screen: MCP servers, work-type distribution, and score render for **all**
  harnesses; the repo-scan column populates for **Codex / VS Code
  `workspaceStorage`** and shows the existing "No workspace repos resolved" empty
  state for Claude/OpenCode (per the per-harness coverage table — accepted).
- The Learning page's quiz personalization receives real workspace deps **for
  Codex/VS Code**; it continues to fall back to generic content for
  Claude/OpenCode (unchanged for them — tracked in Follow-up).
- All new contract + security + serve-then-parse tests pass; existing suite green.
- `git diff` outside `src/standalone/` and `docs-fork/` is empty (no shared-`src/`
  edits; the parser `workspaceRootPath` fix is explicitly out of scope).
