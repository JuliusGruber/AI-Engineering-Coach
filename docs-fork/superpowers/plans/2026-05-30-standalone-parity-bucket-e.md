# Standalone Parity — Bucket E (Agentic SDLC local scans) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the standalone build's Agentic SDLC tab render (instead of hanging on its loading screen) and restore Learning-quiz deps personalization, by adding three already-implemented, `vscode`-free local-scan methods (`getSdlcToolAnalysis`, `getSdlcRepoScan`, `getWorkspaceDeps`) to the `V1_SERVICE_ALLOWED` frozen set — taking it 12 → 15 — with no edits to any shared `src/` file.

**Architecture:** Pure allowlist exposure (Approach A). The three handlers already live in `PanelRequestService` (`src/webview/panel-request-service.ts`) and are already reachable through the bucket-D service-bridge (`src/standalone/request-service-bridge.ts` → `dispatchServiceMethod`). The dispatcher (`src/standalone/dispatcher.ts:53`) routes any `V1_SERVICE_ALLOWED` member to the bridge; the methods are simply absent from that set, so the allowlist gate rejects them with `standalone-v1-disabled`. Adding the three names flips them on. `getSdlcGitHubData` stays excluded (needs `vscode.authentication` + outbound network; no call site in `page-sdlc.ts`).

**Tech Stack:** TypeScript (strict), Node ESM, Vitest (unit + contract). Reused upstream webview modules resolve `import * as vscode` to `src/standalone/vscode-stub.ts` via the Vitest `resolve.alias` (the same path `service-writes.test.ts` already relies on). Temp-dir fs tests use real `fs` in an `os.tmpdir()` scratch dir, cleaned in `afterEach` — the bucket-B pattern, no new mocking infra.

**Source spec:** `docs-fork/superpowers/spec/2026-05-30-standalone-parity-bucket-e-design.md`.

---

## Fork invariant (the constraint that shapes everything)

The fork is **additive-only**: every code edit lands in `src/standalone/` (the allowlist + its `__tests__`) or `docs-fork/`. **Never** edit `panel-request-service.ts`, `page-sdlc.ts`, `page-learning.ts`, `page-experiments.ts`, `dispatcher.ts`, `request-service-bridge.ts`, or any other shared `src/` file. The parser `workspaceRootPath` fix (which would light up repo-scan/deps for Claude/OpenCode) is shared-`src/` drift and is **explicitly out of scope** — it is tracked as a Follow-up only.

`tests/standalone/PAGE-RPC-AUDIT.md` is a **dated historical snapshot** (audited 2026-05-26 @ `09c4ce9`); prior buckets (B/D) did not rewrite its status tokens, and its status column describes *shim banner behavior*, not exposure tier. This change does **not** edit it (see Task 6, step 1 — verified there are no `v1-service-allowed.test.ts` line-number citations to refresh). Leaving it untouched also keeps the strict acceptance criterion ("`git diff` outside `src/standalone/` and `docs-fork/` is empty") satisfiable.

## File Structure

**Modified — fork-owned source (`src/standalone/`):**

| File | Change |
| --- | --- |
| `v1-service-allowed.ts` | Add 3 service methods (`getSdlcToolAnalysis`, `getSdlcRepoScan`, `getWorkspaceDeps`). Set grows 12 → 15. Header comment tally 12 → 15; exclusion note narrows to "only `getSdlcGitHubData`". |

**Modified — fork-owned tests (`src/standalone/__tests__/`):**

| File | Change |
| --- | --- |
| `v1-service-allowed.test.ts` | Count `12 → 15` (two sites); rewrite the `excludes …` block to assert `createSkill` + `getSdlcGitHubData` are `false`; add an `includes the bucket-E local-scan methods` test asserting the three are `true`. |

**New — fork-owned tests (`src/standalone/__tests__/`):**

| File | Responsibility |
| --- | --- |
| `sdlc-bridge.test.ts` | Per-method contract through the **real** `dispatchServiceMethod` + real `PanelRequestService` (no mock): happy-path populate, unresolved-root → empty, serve-then-parse → empty, `.git/config` credential-safety regression. Kept separate from `request-service-bridge.test.ts` (which mocks the service) so the SDLC contract is isolated. |

**Modified — fork-owned docs (`docs-fork/`):**

| File | Change |
| --- | --- |
| `STANDALONE-PARITY-GAPS.md` | § E → SHIPPED for the three local scans, annotated with the per-harness caveat; `getSdlcGitHubData` kept as the sole deferred bucket-E method; add the parser `workspaceRootPath` Follow-up; downgrade (not remove) the Learning row in the Per-method degradations table; update the now-stale § C caveat and Priority notes. |
| `STANDALONE-UI-FEASIBILITY.md` | Line ~134: correct the stale "Hidden via `HIDDEN_IN_STANDALONE_V1`; silent-disabled" claim (no such constant exists); the tab is reachable via the Level-Up sub-tab and now renders its local-scan data. |

**Unchanged — verified, do NOT touch:** `panel-request-service.ts`, `page-sdlc.ts`, `page-learning.ts`, `page-experiments.ts`, `dispatcher.ts`, `request-service-bridge.ts`, `tests/standalone/PAGE-RPC-AUDIT.md`, and all shared `src/` outside `src/standalone/`.

## A note on TDD ordering for an exposure task

This is **exposure**, not new behavior. Only the **membership** test (`v1-service-allowed.test.ts`) is a genuine red→green driver for the allowlist edit — Tasks 1→2 follow strict TDD (red, then green).

The **contract** tests in `sdlc-bridge.test.ts` (Tasks 3–5) call `dispatchServiceMethod` **directly**, bypassing the `dispatch()` allowlist gate, so the underlying handlers already satisfy them. **They should PASS on first run.** A failure there is a real signal (a wrong assumption about a handler's shape), not an expected red — investigate it, don't "make it pass." This is the honest framing for wiring already-present code.

---

## Task 1: Make the frozen-set membership tests red

**Files:**
- Modify: `src/standalone/__tests__/v1-service-allowed.test.ts`

- [ ] **Step 1: Update the two count assertions and the membership block**

Change the count in **both** the count test and the frozen-mutation test (`12` → `15`), then replace the final `excludes …` block with a rewritten exclusion test plus a new inclusion test.

Replace this (lines 5–6):

```typescript
  it('contains exactly the documented 12 service methods', () => {
    expect(V1_SERVICE_ALLOWED.size).toBe(12);
```

with:

```typescript
  it('contains exactly the documented 15 service methods', () => {
    expect(V1_SERVICE_ALLOWED.size).toBe(15);
```

Replace this (line 13):

```typescript
    expect(V1_SERVICE_ALLOWED.size).toBe(12);
```

with:

```typescript
    expect(V1_SERVICE_ALLOWED.size).toBe(15);
```

Replace this whole block (lines 31–35):

```typescript
  it('excludes createSkill (VS Code chat) and the bucket-E service methods', () => {
    expect(V1_SERVICE_ALLOWED.has('createSkill')).toBe(false);
    expect(V1_SERVICE_ALLOWED.has('getWorkspaceDeps')).toBe(false);
    expect(V1_SERVICE_ALLOWED.has('getSdlcRepoScan')).toBe(false);
  });
```

with:

```typescript
  it('excludes createSkill (VS Code chat) and getSdlcGitHubData (needs auth/network)', () => {
    expect(V1_SERVICE_ALLOWED.has('createSkill')).toBe(false);
    expect(V1_SERVICE_ALLOWED.has('getSdlcGitHubData')).toBe(false);
  });

  it('includes the bucket-E local-scan methods', () => {
    for (const m of ['getSdlcToolAnalysis', 'getSdlcRepoScan', 'getWorkspaceDeps']) {
      expect(V1_SERVICE_ALLOWED.has(m)).toBe(true);
    }
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/standalone/__tests__/v1-service-allowed.test.ts`

Expected: FAIL. The count tests fail with `expected 15, received 12`; `includes the bucket-E local-scan methods` fails because `has('getSdlcToolAnalysis')` is `false`. (`excludes …` passes already — `getSdlcGitHubData` is not in the set yet.)

- [ ] **Step 3: Commit the red test**

```bash
git add src/standalone/__tests__/v1-service-allowed.test.ts
git commit -m "test(standalone): bucket-E membership — expect 15 service methods + local scans"
```

---

## Task 2: Expose the three local-scan methods (make membership tests green)

**Files:**
- Modify: `src/standalone/v1-service-allowed.ts`

- [ ] **Step 1: Add the three methods to the frozen set**

Add a bucket-E group after the bucket-B writes. Replace this (lines 14–17):

```typescript
  // Bucket B — service-tier writes. installSkill/installCatalogItem write via the vscode-stub
  // workspace.fs seam; exportSummary delegates to exportSummaryFiles through the same seam.
  'installSkill', 'installCatalogItem', 'exportSummary',
]);
```

with:

```typescript
  // Bucket B — service-tier writes. installSkill/installCatalogItem write via the vscode-stub
  // workspace.fs seam; exportSummary delegates to exportSummaryFiles through the same seam.
  'installSkill', 'installCatalogItem', 'exportSummary',
  // Bucket E — local-scan reads (agentic SDLC tab + Learning quiz personalization). No vscode,
  // no network; each self-guards to an empty result when parse hasn't finished. getSdlcGitHubData
  // stays excluded (needs vscode.authentication + outbound fetch; no call site in page-sdlc.ts).
  'getSdlcToolAnalysis', 'getSdlcRepoScan', 'getWorkspaceDeps',
]);
```

- [ ] **Step 2: Update the header comment tally (12 → 15)**

Replace this (lines 1–8):

```typescript
// src/standalone/v1-service-allowed.ts
// The 12 PanelRequestService methods exposed via the standalone service-bridge tier.
// Learning ×4 + Skill ×4 (incl. generateSkillContent) + Context ×1 (= 9, bucket D) +
// bucket-B writes ×3 (installSkill, installCatalogItem, exportSummary) = 12.
// Still excludes createSkill (opens VS Code chat, not an LLM call) and the bucket-E methods
// (getWorkspaceDeps / getSdlc*) that also live in PanelRequestService but are not allowlisted
// here. See docs-fork/superpowers/spec/2026-05-27-standalone-parity-bucket-d-design.md § C and
// docs-fork/superpowers/spec/2026-05-29-standalone-parity-bucket-b-design.md § C.
```

with:

```typescript
// src/standalone/v1-service-allowed.ts
// The 15 PanelRequestService methods exposed via the standalone service-bridge tier.
// Learning ×4 + Skill ×4 (incl. generateSkillContent) + Context ×1 (= 9, bucket D) +
// bucket-B writes ×3 (installSkill, installCatalogItem, exportSummary) = 12 +
// bucket-E local scans ×3 (getSdlcToolAnalysis, getSdlcRepoScan, getWorkspaceDeps) = 15.
// Still excludes createSkill (opens VS Code chat, not an LLM call) and getSdlcGitHubData — the
// one bucket-E method that needs vscode.authentication + outbound network. See
// docs-fork/superpowers/spec/2026-05-27-standalone-parity-bucket-d-design.md § C,
// docs-fork/superpowers/spec/2026-05-29-standalone-parity-bucket-b-design.md § C, and
// docs-fork/superpowers/spec/2026-05-30-standalone-parity-bucket-e-design.md.
```

- [ ] **Step 3: Run the membership test to verify it passes**

Run: `npx vitest run src/standalone/__tests__/v1-service-allowed.test.ts`

Expected: PASS (all assertions green; size is 15; the three local scans are present; `getSdlcGitHubData` + `createSkill` are absent).

- [ ] **Step 4: Commit**

```bash
git add src/standalone/v1-service-allowed.ts
git commit -m "feat(standalone): expose bucket-E local scans via service bridge (12->15)"
```

---

## Task 3: SDLC bridge per-method contract tests (happy paths)

**Files:**
- Create: `src/standalone/__tests__/sdlc-bridge.test.ts`

> This file must **not** call `vi.mock('../../webview/panel-request-service', …)` — it deliberately drives the **real** `PanelRequestService` through the real `dispatchServiceMethod`, exactly as `service-writes.test.ts` does. The `vscode` import inside the service resolves to the stub via the Vitest `resolve.alias`.

- [ ] **Step 1: Write the file with shared fixtures + three happy-path tests**

```typescript
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { dispatchServiceMethod } from '../request-service-bridge';
import type { DispatchContext, DispatchResult } from '../dispatcher';
import type { ParseResult } from '../../core/cache';
import type { Session } from '../../core/types/session-types';
import type { Workspace } from '../../core/types/session-types';

// --- temp-dir scratch (bucket-B pattern: real fs, cleaned per test) ---
const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-sdlc-'));
  tmpDirs.push(d);
  return d;
}

// --- fixtures ---
function session(opts: { toolsUsed?: string[]; workspaceId?: string; workspaceName?: string; harness?: string }): Session {
  return {
    sessionId: 's1',
    workspaceId: opts.workspaceId ?? 'ws1',
    workspaceName: opts.workspaceName ?? 'demo',
    harness: opts.harness ?? 'codex',
    creationDate: null,
    lastMessageDate: 1,
    requests: [{ toolsUsed: opts.toolsUsed ?? [] }],
  } as unknown as Session;
}

function makeParseResult(opts: { workspaces?: Workspace[]; sessions?: Session[] }): ParseResult {
  return {
    workspaces: new Map((opts.workspaces ?? []).map(w => [w.id, w])),
    sessions: opts.sessions ?? [],
    editLocIndex: new Map(),
    sessionSourceIndex: new Map(),
  } as unknown as ParseResult;
}

// analyzer is unused by all three local-scan handlers; only parseResult matters.
function ctx(parseResult?: ParseResult): DispatchContext {
  return { parseResult };
}

// narrow the success branch for data access
function data(res: DispatchResult): Record<string, unknown> {
  expect(res.ok).toBe(true);
  return (res as { ok: true; data: Record<string, unknown> }).data;
}

describe('bucket-E SDLC bridge — populated (resolvable, Codex-shaped root)', () => {
  it('getSdlcToolAnalysis counts mcp_ tool prefixes into SDLC-relevant servers', async () => {
    const parseResult = makeParseResult({
      sessions: [session({ toolsUsed: ['mcp_github_create_issue', 'mcp_github_list_prs'] })],
    });
    const res = await dispatchServiceMethod('getSdlcToolAnalysis', {}, ctx(parseResult));
    expect(data(res).mcpServers).toMatchObject([
      { id: 'github', isSdlcRelevant: true, toolCalls: 2 },
    ]);
  });

  it('getWorkspaceDeps reads package.json from a package.json-marked root', async () => {
    const root = tmpDir();
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
      dependencies: { react: '^18.0.0' },
      devDependencies: { vitest: '^4.0.0' },
    }));
    const parseResult = makeParseResult({ workspaces: [{ id: 'ws1', name: 'demo', path: root }] });
    const res = await dispatchServiceMethod('getWorkspaceDeps', {}, ctx(parseResult));
    expect(res).toEqual({
      ok: true,
      data: { deps: [{ workspace: 'demo', dependencies: ['react'], devDependencies: ['vitest'] }] },
    });
  });

  it('getSdlcRepoScan lists .github workflows under a resolvable root', async () => {
    const root = tmpDir();
    fs.writeFileSync(path.join(root, 'package.json'), '{}');
    fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'name: ci');
    const parseResult = makeParseResult({ workspaces: [{ id: 'ws1', name: 'demo', path: root }] });
    const res = await dispatchServiceMethod('getSdlcRepoScan', {}, ctx(parseResult));
    expect(data(res).repos).toMatchObject([
      { workspace: 'demo', remote: null, workflows: ['ci.yml'] },
    ]);
  });
});
```

- [ ] **Step 2: Run the happy-path tests**

Run: `npx vitest run src/standalone/__tests__/sdlc-bridge.test.ts`

Expected: PASS (3 passing). These exercise the already-present handlers end-to-end through the real bridge. If any FAIL, that is a real contract mismatch — investigate the handler, do not patch the assertion to match a wrong result.

- [ ] **Step 3: Commit**

```bash
git add src/standalone/__tests__/sdlc-bridge.test.ts
git commit -m "test(standalone): bucket-E SDLC bridge contract — populated happy paths"
```

---

## Task 4: Unresolved-root and serve-then-parse → empty (intentional-and-tested)

**Files:**
- Modify: `src/standalone/__tests__/sdlc-bridge.test.ts`

These encode the documented Claude/OpenCode partial coverage (unresolved root → empty) and the cold-start window (no parseResult → empty) as executable specs, so the empty result is intentional, not a latent regression.

- [ ] **Step 1: Append two new `describe` blocks at the end of the file**

```typescript
describe('bucket-E SDLC bridge — unresolved root (log-dir-shaped, Claude/OpenCode)', () => {
  it('getSdlcRepoScan returns no repos when the root resolves to null', async () => {
    const logDir = tmpDir(); // no package.json / workspace.json / workspace.yaml
    const parseResult = makeParseResult({ workspaces: [{ id: 'ws1', name: 'claude-proj', path: logDir }] });
    const res = await dispatchServiceMethod('getSdlcRepoScan', {}, ctx(parseResult));
    expect(res).toEqual({ ok: true, data: { repos: [] } });
  });

  it('getWorkspaceDeps returns no deps when the root resolves to null', async () => {
    const logDir = tmpDir();
    const parseResult = makeParseResult({ workspaces: [{ id: 'ws1', name: 'claude-proj', path: logDir }] });
    const res = await dispatchServiceMethod('getWorkspaceDeps', {}, ctx(parseResult));
    expect(res).toEqual({ ok: true, data: { deps: [] } });
  });
});

describe('bucket-E SDLC bridge — serve-then-parse (parseResult undefined → empty, never ok:false)', () => {
  it('getSdlcToolAnalysis self-guards to empty', async () => {
    const res = await dispatchServiceMethod('getSdlcToolAnalysis', {}, ctx(undefined));
    expect(res).toEqual({ ok: true, data: { mcpServers: [], toolCounts: {} } });
  });

  it('getWorkspaceDeps self-guards to empty', async () => {
    const res = await dispatchServiceMethod('getWorkspaceDeps', {}, ctx(undefined));
    expect(res).toEqual({ ok: true, data: { deps: [] } });
  });

  it('getSdlcRepoScan self-guards to empty', async () => {
    const res = await dispatchServiceMethod('getSdlcRepoScan', {}, ctx(undefined));
    expect(res).toEqual({ ok: true, data: { repos: [] } });
  });
});
```

> Note the exact shapes: `getSdlcToolAnalysis`'s no-parse branch returns `{ mcpServers: [], toolCounts: {} }` (the `toolCounts: {}` is real — see `panel-request-service.ts:1213`), whereas its populated branch returns `{ mcpServers }` only. `getWorkspaceDeps` → `{ deps: [] }`; `getSdlcRepoScan` → `{ repos: [] }`.

- [ ] **Step 2: Run the file**

Run: `npx vitest run src/standalone/__tests__/sdlc-bridge.test.ts`

Expected: PASS (8 passing total). All five empty-result cases resolve `{ ok: true }`, never `{ ok: false }`.

- [ ] **Step 3: Commit**

```bash
git add src/standalone/__tests__/sdlc-bridge.test.ts
git commit -m "test(standalone): bucket-E unresolved-root + serve-then-parse self-guard to empty"
```

---

## Task 5: Security regression — `.git/config` credential safety

**Files:**
- Modify: `src/standalone/__tests__/sdlc-bridge.test.ts`

`getGitHubRemote`'s regex (`panel-request-service.ts:1083`) anchors on `https://github.com/` or `git@github.com:` immediately. A credentialed remote has text between `https://` and `github.com/`, so it **fails to match entirely** → `remote` is `null` (never captured, never partially stripped). Both assertions matter: the credentialed case yields `null`, and the clean case still yields `owner/repo` (guards against an over-eager "match nothing" fix).

- [ ] **Step 1: Append the security `describe` block at the end of the file**

```typescript
describe('bucket-E SDLC bridge — .git/config credential safety', () => {
  it('yields null (not a stripped owner/repo) for a credentialed remote, leaking nothing', async () => {
    const root = tmpDir();
    fs.writeFileSync(path.join(root, 'package.json'), '{}');
    fs.mkdirSync(path.join(root, '.git'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.git', 'config'),
      '[remote "origin"]\n\turl = https://user:ghp_secret@github.com/owner/repo.git\n',
    );
    const parseResult = makeParseResult({ workspaces: [{ id: 'ws1', name: 'demo', path: root }] });
    const res = await dispatchServiceMethod('getSdlcRepoScan', {}, ctx(parseResult));
    const repos = data(res).repos as Array<{ remote: string | null }>;
    expect(repos[0].remote).toBeNull();
    const json = JSON.stringify(res);
    expect(json).not.toContain('ghp_secret');
    expect(json).not.toContain('user:');
  });

  it('extracts owner/repo from a clean https github remote (regex still works)', async () => {
    const root = tmpDir();
    fs.writeFileSync(path.join(root, 'package.json'), '{}');
    fs.mkdirSync(path.join(root, '.git'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.git', 'config'),
      '[remote "origin"]\n\turl = https://github.com/owner/repo.git\n',
    );
    const parseResult = makeParseResult({ workspaces: [{ id: 'ws1', name: 'demo', path: root }] });
    const res = await dispatchServiceMethod('getSdlcRepoScan', {}, ctx(parseResult));
    const repos = data(res).repos as Array<{ remote: string | null }>;
    expect(repos[0].remote).toBe('owner/repo');
  });
});
```

- [ ] **Step 2: Run the file**

Run: `npx vitest run src/standalone/__tests__/sdlc-bridge.test.ts`

Expected: PASS (10 passing total). The credentialed remote yields `null` and neither `ghp_secret` nor `user:` appears anywhere in the response JSON; the clean remote yields exactly `owner/repo`.

- [ ] **Step 3: Commit**

```bash
git add src/standalone/__tests__/sdlc-bridge.test.ts
git commit -m "test(standalone): bucket-E .git/config credential-safety regression"
```

---

## Task 6: Documentation updates + final verification

**Files:**
- Modify: `docs-fork/STANDALONE-PARITY-GAPS.md`
- Modify: `docs-fork/STANDALONE-UI-FEASIBILITY.md`
- Verify only: `tests/standalone/PAGE-RPC-AUDIT.md` (no edit expected)

- [ ] **Step 1: Confirm PAGE-RPC-AUDIT needs no edit**

The spec's only PAGE-RPC-AUDIT ask is to "refresh any line-number citations that point at the old assertion lines" of `v1-service-allowed.test.ts`. Confirm there are none:

Run: `npx vitest run` is not needed here — instead grep:

Use Grep: pattern `v1-service-allowed` in `tests/standalone/PAGE-RPC-AUDIT.md`.
Expected: **no matches** → no citations to refresh → **do not edit this file** (it is a dated snapshot outside `src/standalone/` + `docs-fork/`; editing it would also break the final git-diff-scope check).

- [ ] **Step 2: STANDALONE-PARITY-GAPS.md — rewrite § E to SHIPPED + caveat + Follow-up**

Replace this block (the `## E.` section, lines ~147–157):

```markdown
## E. Agentic SDLC — needs the dropped data service rebuilt

- **SDLC local scans** — repo / tool / dependency analysis across the
  lifecycle. `getSdlcRepoScan` / `getSdlcToolAnalysis` / `getWorkspaceDeps`
  are all off every allowlist (verified absent from `v1-allowed.ts`,
  `v1-service-allowed.ts`, `standalone-native.ts`). The **SDLC tab renders an
  endless loading state and never resolves** (`page-sdlc.ts:91-92`); the
  Level-Up SDLC badge call (`page-experiments.ts:221`) silently no-ops. **Med–High**
  — route these through the request-service bridge. Biggest visible broken surface.
- **SDLC GitHub data** — `getSdlcGitHubData`. Needs GitHub auth / network.
  **Hard** — distinct from the local scans.
```

with:

```markdown
## E. Agentic SDLC

- **SDLC local scans** ✅ — repo / tool / dependency analysis across the
  lifecycle. `getSdlcToolAnalysis` / `getSdlcRepoScan` / `getWorkspaceDeps` are
  exposed through the request-service bridge (`V1_SERVICE_ALLOWED`, 15 methods;
  bucket-E design 2026-05-30). The SDLC tab now resolves and renders instead of
  hanging on its loading screen, and the Level-Up SDLC badge
  (`page-experiments.ts:221`) populates. **Per-harness caveat:**
  `getSdlcToolAnalysis` is pure session math and populates for **all** harnesses;
  `getSdlcRepoScan` / `getWorkspaceDeps` resolve a workspace root only when the
  parser recorded a `workspaceRootPath` — **only the Codex parser does**
  (`parser-codex.ts:532`), plus VS Code `workspaceStorage`. For Claude / OpenCode
  the root is unresolved, so repo-scan and deps return empty (the page shows its
  "No workspace repos resolved" empty state; quiz personalization stays generic).
  See Follow-up.
- **SDLC GitHub data** — `getSdlcGitHubData`. Needs GitHub auth / network
  (`vscode.authentication.getSession('github', …)` + outbound fetch) and has no
  call site in `page-sdlc.ts`. **Hard** — the sole remaining deferred bucket-E
  method.

**Follow-up (tracked separately, NOT in the bucket-E change):** the Claude
(`parser-claude.ts:668`) and OpenCode (`parser-opencode.ts:293`) parsers don't set
`workspaceRootPath` the way Codex (`parser-codex.ts:532`) does. A ~2-line portable
fix (`workspaceRootPath: cwd` / `: rawSession.directory`, guarded by the existing
`fs.existsSync`) would light up repo-scan + deps + quiz personalization for those
harnesses. It is shared-`src/` drift (outside `src/standalone/`), so it is an
upstream-it candidate kept out of the allowlist-only bucket-E change by design.
```

- [ ] **Step 3: STANDALONE-PARITY-GAPS.md — fix the now-stale § C Learning caveat**

Replace this (lines ~124–126, inside the Learning Center ✅ bullet):

```markdown
  `V1_SERVICE_ALLOWED`). **Caveat:** the Learning page also calls `getWorkspaceDeps`
  (bucket E, NOT allowlisted) — quiz personalization degrades to generic content
  (see Per-method degradations).
```

with:

```markdown
  `V1_SERVICE_ALLOWED`). **Caveat:** the Learning page also calls `getWorkspaceDeps`
  (bucket E, now allowlisted) — quiz personalization uses real deps for Codex / VS
  Code `workspaceStorage`, and falls back to generic content only for Claude /
  OpenCode (unresolved workspace root; see Per-method degradations + bucket-E Follow-up).
```

- [ ] **Step 4: STANDALONE-PARITY-GAPS.md — downgrade (don't remove) the Per-method degradations rows**

Replace these two rows (lines ~190–191):

```markdown
| Learning | `getWorkspaceDeps` | `page-learning.ts:686` | quiz personalization falls back to generic content | E |
| SDLC tab | `getSdlcRepoScan`, `getSdlcToolAnalysis` | `page-sdlc.ts:91-92` | tab loads forever, never renders | E |
```

with (the SDLC-tab row is resolved → removed; the Learning row stays as a per-harness coverage caveat, no longer an exposure gap):

```markdown
| Learning | `getWorkspaceDeps` | `page-learning.ts:686` | exposed (bucket E); quiz personalization uses real deps for Codex / VS Code, generic for Claude / OpenCode (unresolved root) | E |
```

Then, in the table's intro sentence (lines ~182–184), append a clarifying note. Replace:

```markdown
(`V1_ALLOWED` / `V1_SERVICE_ALLOWED` / `STANDALONE_NATIVE`). Verified by grep
against the allowlist files, 2026-05-30:
```

with:

```markdown
(`V1_ALLOWED` / `V1_SERVICE_ALLOWED` / `STANDALONE_NATIVE`). Verified by grep
against the allowlist files, 2026-05-30. One row (`getWorkspaceDeps`) is now
exposed but data-limited per harness — kept here as a coverage caveat, not an
exposure gap:
```

- [ ] **Step 5: STANDALONE-PARITY-GAPS.md — update the stale Priority notes**

Replace this block (lines ~195–199):

```markdown
- **Biggest visible broken surface: the SDLC tab (bucket E)** — allowlist
  `getSdlcRepoScan` + `getSdlcToolAnalysis` through the request-service bridge.
- **Cheap finishers:** `saveModelBudgets`/`loadModelBudgets` (Burndown),
  `getWorkspaceDeps` (Learning), `reviewLocalRules` (Anti-Patterns) — small write/
  read paths that complete already-shipped pages.
```

with:

```markdown
- **SDLC tab (bucket E) — SHIPPED (2026-05-30):** `getSdlcToolAnalysis` +
  `getSdlcRepoScan` + `getWorkspaceDeps` are allowlisted through the request-service
  bridge; the tab renders (repo-scan column populates for Codex / VS Code, empty for
  Claude / OpenCode pending the parser Follow-up).
- **Cheap finishers:** `saveModelBudgets`/`loadModelBudgets` (Burndown),
  `reviewLocalRules` (Anti-Patterns) — small write/read paths that complete
  already-shipped pages.
```

- [ ] **Step 6: STANDALONE-UI-FEASIBILITY.md — correct the stale `sdlc` row**

Replace this table row (line ~134):

```markdown
| `sdlc`                | **Hidden.** *(Corrected: was "Visible, read-only repo/PR data works".)* Its data (`getSdlcRepoScan`/`getSdlcToolAnalysis`/`getSdlcGitHubData`) lives in the dropped `PanelRequestService`, so the page would render empty. Hidden via `HIDDEN_IN_STANDALONE_V1`; silent-disabled (no banner). |
```

with:

```markdown
| `sdlc`                | **Visible (Level-Up → SDLC sub-tab).** Local scans (`getSdlcToolAnalysis`/`getSdlcRepoScan`/`getWorkspaceDeps`) are exposed via the request-service bridge (bucket E, 2026-05-30) and render; `getSdlcGitHubData` stays deferred (needs GitHub auth/network). *(Corrected: earlier "Hidden via `HIDDEN_IN_STANDALONE_V1`; silent-disabled" was wrong — no such constant exists in `src/`; the tab is reachable via the Level-Up sub-tab and now renders its local-scan data.)* |
```

- [ ] **Step 7: Run the full unit suite**

Run: `npm test`

Expected: PASS (whole suite green; `v1-service-allowed.test.ts` and `sdlc-bridge.test.ts` included; no other test regressed).

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`

Expected: no errors (the new test's casts compile under strict TS).

- [ ] **Step 9: Verify the additive-only invariant (acceptance: no diff outside the two allowed trees)**

Run (PowerShell): `git status --porcelain | ForEach-Object { $_.Substring(3) } | Where-Object { $_ -notmatch '^(src/standalone/|docs-fork/)' }`

Expected: **no output**. Every changed/added path is under `src/standalone/` or `docs-fork/`. (If `PAGE-RPC-AUDIT.md` or any shared `src/` file appears, that is a boundary violation — revert it.)

- [ ] **Step 10: Commit the docs**

```bash
git add docs-fork/STANDALONE-PARITY-GAPS.md docs-fork/STANDALONE-UI-FEASIBILITY.md
git commit -m "docs(fork): bucket-E SDLC local scans SHIPPED with per-harness caveat"
```

---

## Acceptance criteria (from the spec — verify all before declaring done)

- `V1_SERVICE_ALLOWED.size === 15`; contains `getSdlcToolAnalysis`, `getSdlcRepoScan`, `getWorkspaceDeps`; still excludes `getSdlcGitHubData` and `createSkill`. *(Task 1–2)*
- The SDLC tab resolves and renders instead of leaving the loading screen: MCP servers + work-type distribution + score render for **all** harnesses; the repo-scan column populates for **Codex / VS Code `workspaceStorage`** and shows the "No workspace repos resolved" empty state for Claude/OpenCode (accepted, per the per-harness coverage table). *(Tasks 3–4 encode the populated + empty contracts.)*
- The Learning page's quiz personalization receives real workspace deps for **Codex / VS Code**; continues to fall back to generic content for Claude/OpenCode (tracked in Follow-up). *(Task 3 deps happy path + Task 4 unresolved-root empty.)*
- All new contract + security + serve-then-parse tests pass; existing suite green. *(Tasks 3–6.)*
- `git diff` outside `src/standalone/` and `docs-fork/` is empty — no shared-`src/` edits; the parser `workspaceRootPath` fix is explicitly out of scope. *(Task 6, step 9.)*

## Self-review notes (author)

- **Spec coverage:** Scope (3 methods) → Tasks 1–2. Per-harness partial coverage → Task 4 (unresolved-root) + § E caveat (Task 6.2). Serve-then-parse window → Task 4. Error handling (never `ok:false`) → Tasks 4–5. Security (credential safety, both shapes) → Task 5. Testing layers 1–5 → Tasks 1, 3, 4, 4, 5 respectively. Docs (3 updates) → Task 6 (PARITY-GAPS, UI-FEASIBILITY, allowlist header in Task 2.2). PAGE-RPC-AUDIT citation refresh → Task 6.1 (verified none needed). Acceptance/boundary → Task 6.9. Out-of-scope (`getSdlcGitHubData`, parser fix) → asserted excluded (Task 1) + Follow-up (Task 6.2).
- **Type consistency:** `makeParseResult`/`session`/`ctx`/`data` helper names are used identically across Tasks 3–5; `Workspace` = `{id,name,path}`; `ParseResult` carries `workspaces`/`sessions`/`editLocIndex`/`sessionSourceIndex`. Empty shapes asserted match the handlers verbatim: `{mcpServers:[],toolCounts:{}}`, `{deps:[]}`, `{repos:[]}`.
- **No placeholders:** every code/doc edit shows exact before/after text and a runnable command with expected output.
