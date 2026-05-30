# Standalone Parity — Bucket E (Agentic SDLC local scans) — Design

**Date:** 2026-05-30
**Status:** Approved (brainstorming), pending implementation plan
**Scope decision:** 3 local scans only (see § Scope). `getSdlcGitHubData` excluded.
**Related:** `docs-fork/STANDALONE-PARITY-GAPS.md` § E; bucket D design
(`2026-05-27-standalone-parity-bucket-d-design.md`), bucket B design
(`2026-05-29-standalone-parity-bucket-b-design.md`).

## Problem

The standalone build's **Agentic SDLC** tab (Level Up → SDLC sub-tab,
`page-sdlc.ts`) renders an endless `LoadingScreen` and never resolves. It awaits
three RPC methods in parallel (`page-sdlc.ts:89-93`); two of them —
`getSdlcToolAnalysis` and `getSdlcRepoScan` — are not exposed by any standalone
allowlist tier, so the `rpc()` promises reject/never-resolve and the
`Promise.all` hangs. Separately, the already-shipped **Learning** page calls
`getWorkspaceDeps` (`page-learning.ts:686`) for quiz personalization; with that
method unexposed, personalization silently degrades to generic content.

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
handler self-guards to a valid empty result:
- `getSdlcToolAnalysis` → `{mcpServers: []}`
- `getWorkspaceDeps` → `{deps: []}`
- `getSdlcRepoScan` → `resolveWorkspaceRoots()` returns `[]` → `{repos: []}`

The page renders an empty-but-valid state and re-fetches on normal navigation. In
practice `page-sdlc.ts` also awaits `getSessions` (a registry method that *does*
data-ready-guard), so render won't even begin until data exists.

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

1. **Credential safety in `.git/config`:** `getGitHubRemote`'s regex captures
   only the `owner/repo` segment after `github.com/` (or `git@github.com:`). An
   embedded `https://user:token@github.com/...` credential sits *before*
   `github.com/` and is never captured — no token leaks into the response.
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

Mirrors the bucket B/D contract-test pattern. Four layers:

1. **Frozen-set membership** (`src/standalone/__tests__/v1-service-allowed.test.ts`,
   edit existing): change `toBe(12)` → `15` (count test + frozen-mutation test).
   Flip the `excludes … bucket-E service methods` test: replace the
   `getWorkspaceDeps`/`getSdlcRepoScan` = `false` assertions with a positive test
   asserting all three new methods are `true`; keep `getSdlcGitHubData` and
   `createSkill` asserted `false` (the remaining genuine exclusions).
2. **Per-method bridge contract** (new file
   `src/standalone/__tests__/sdlc-bridge.test.ts`, keeping the SDLC contract
   isolated from the existing bridge test): dispatch each via
   `dispatchServiceMethod` with a hand-built `ctx`:
   - `getSdlcToolAnalysis` — sessions with `mcp_github_*` tools →
     `{mcpServers:[{id:'github', isSdlcRelevant:true, toolCalls:N}]}`.
   - `getWorkspaceDeps` — temp dir + `package.json` →
     `{deps:[{workspace, dependencies, devDependencies}]}`.
   - `getSdlcRepoScan` — temp dir with `.github/workflows/ci.yml` →
     `{repos:[{workflows:['ci.yml'], …}]}`.
3. **Serve-then-parse guard**: dispatch each with `ctx.parseResult` undefined →
   assert `{ok:true}` with empty `{mcpServers:[]}` / `{deps:[]}` / `{repos:[]}`,
   never `ok:false`.
4. **Security regression**: `.git/config` with
   `url = https://user:ghp_secret@github.com/owner/repo.git` → assert `remote`
   is exactly `owner/repo` and the response JSON contains neither `ghp_secret`
   nor `user:`.

Temp-dir fs tests use the repo's existing pattern (real `fs` in an `os.tmpdir()`
scratch dir, cleaned in `afterEach`), consistent with bucket B's service-writes
tests — no new mocking infra.

**No e2e change required:** `tests/e2e/harness.html:411` already stubs
`getSdlcRepoScan`, so the e2e harness renders the tab today; this work is
server-side allowlist + contract coverage.

## Documentation updates (part of this work)

1. **`docs-fork/STANDALONE-PARITY-GAPS.md`** — move bucket E's three local-scan
   methods from "gap" to SHIPPED; update the Per-method degradations table
   (remove the Learning `getWorkspaceDeps` row and the SDLC-tab row); note
   `getSdlcGitHubData` remains the sole deferred bucket-E item.
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
- The SDLC tab resolves and renders (MCP servers, work-type distribution, repo
  scan, score) instead of hanging.
- The Learning page's quiz personalization receives real workspace deps.
- All new contract + security + serve-then-parse tests pass; existing suite green.
- `git diff` outside `src/standalone/` and `docs-fork/` is empty.
