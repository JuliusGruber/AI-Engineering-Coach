# Standalone Parity — Bucket B (Rule & Skill Authoring / Write Path) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose all of bucket B (Rule Editor, Anti-Patterns editor, Export Summary, Skill install, Import registry rules) in the standalone CLI build by extending `vscode-stub.ts` with a filesystem/dialog seam and allowlisting ten methods across the two existing dispatch tiers — writes on by default, degrading gracefully — without editing any upstream `src/` file outside `src/standalone/`.

**Architecture:** Three additive layers. **Layer 1** adds the `Uri.file` / `Uri.joinPath` (base-honoring) / `workspace.fs.writeFile` / dialog members to the existing `vscode` stub, which the three write-handlers (`installSkill`, `installCatalogItem`, `exportSummary`) consume verbatim. **Layer 2** allowlists seven rule/import methods on the registry tier (`V1_ALLOWED`). **Layer 3** allowlists three service methods on the service-bridge tier (`V1_SERVICE_ALLOWED`) and removes now-dead shim entries. No new source files; `dispatcher.ts`, `server.ts`, `request-service-bridge.ts`, and `esbuild.mjs` are untouched.

**Tech Stack:** TypeScript (strict), Node ESM, esbuild (CLI + browser bundles), Vitest (unit + integration), Playwright (browser smoke). The reused upstream webview modules resolve `import * as vscode` to `src/standalone/vscode-stub.ts` via both the esbuild alias (`esbuild.mjs:189`) and the Vitest alias (`vitest.config.*` `resolve.alias`).

**Source spec:** `docs-fork/superpowers/spec/2026-05-29-standalone-parity-bucket-b-design.md`.

---

## Fork invariant (the constraint that shapes everything)

The fork is **additive-only**: `git diff upstream/main -- src/` must touch only `src/standalone/`. Every code change in this plan lands in `src/standalone/**` (the four fork-owned files + their `__tests__`). The only non-`src/` edits are under `tests/standalone/**` (integration + Playwright), which the `src/` invariant does not police. **Never** edit `panel-rpc.ts`, `panel-request-service.ts`, `summary-export-vscode.ts`, `core/summary-export.ts`, `rule-loader.ts`, `rule-trust.ts`, `dispatcher.ts`, `server.ts`, `request-service-bridge.ts`, or `esbuild.mjs`.

## File Structure

**Modified — fork-owned source (`src/standalone/`):**

| File | Responsibility / change |
| --- | --- |
| `vscode-stub.ts` | Add the write seam: `Uri.file`, base-honoring `Uri.joinPath`, `workspace.fs.writeFile` + `workspace.workspaceFolders`, `window.showOpenDialog`/`showInformationMessage`, `env.openExternal`. |
| `v1-allowed.ts` | Add 7 registry methods (`getRuleEditor`, `getRuleSource`, `getRulePreview`, `saveRule`, `updateRuleThreshold`, `testRuleLive`, `importRegistryRules`). Set grows 45 → 52. |
| `v1-service-allowed.ts` | Add 3 service methods (`installSkill`, `installCatalogItem`, `exportSummary`). Set grows 9 → 12. |
| `webview-shim.ts` | Hygiene: `BANNER_WORTHY` 4 → 1 (`{ createSkill }`); `RESOLVE_EMPTY_WHEN_DISABLED` → empty set. |

**Modified — fork-owned tests (`src/standalone/__tests__/`):**

| File | Change |
| --- | --- |
| `vscode-stub.test.ts` | New describe blocks for the write seam (incl. the `{}`-base `joinPath` no-op regression guard); the `COACH_EXPORT_DIR`-unset fallback test asserts `~/.ai-engineer-coach/exports/`. |
| `v1-allowed.test.ts` | Count `45 → 52` (two sites); flip `saveRule`/`getRuleEditor` membership; add the 7 new members. |
| `v1-service-allowed.test.ts` | Count `9 → 12` (two sites); flip install/export membership. |
| `webview-shim.test.ts` | `BANNER_WORTHY.size` `4 → 1`; repurpose the `RESOLVE_EMPTY` test to assert `size === 0`. |
| `dispatcher.test.ts` | **Task 2:** swap the stale `saveRule` disabled-exemplar → `reviewLocalRules`. **Task 7:** add tier-routing cases (rule → registry; install/export → bridge; `reviewLocalRules`/`createSkill` still disabled). |
| `server.test.ts` | **Task 2:** swap the mocked `saveRule` label → `reviewLocalRules` (dispatch is mocked, so it still passes; the swap keeps the label honest now that `saveRule` is allowlisted). |

**New — fork-owned tests:**

| File | Responsibility |
| --- | --- |
| `src/standalone/__tests__/rule-write.test.ts` | Registry-handler contract through the stub: `saveRule` writes to a temp `HOME`; `getRuleEditor` degrades (no throw); `getRulePreview`/`updateRuleThreshold`/`testRuleLive` smoke. |
| `src/standalone/__tests__/service-writes.test.ts` | Service-handler contract through the real `PanelRequestService` + stub: `installSkill` (temp `HOME`) and `installCatalogItem` (mocked `fetch`). |
| `tests/standalone/integration/cli-write-path.test.ts` | End-to-end over the booted CLI: `installSkill` (file appears under sandbox `HOME`) and `exportSummary` (`COACH_EXPORT_DIR` → both files + result shape). |

**Modified — test infra (`tests/standalone/`, not `src/`):**

| File | Change |
| --- | --- |
| `tests/standalone/playwright/global-setup.ts` | Fork the smoke server with `COACH_EXPORT_DIR` inside the sandbox `home` so `exportSummary` writes nowhere real. |
| `tests/standalone/playwright/smoke.spec.ts` | Add `saveRule`, `installSkill`, `exportSummary` smokes driven through the shim's outbound channel. |
| `tests/standalone/integration/cli-rpc-lifecycle.test.ts` | **Task 2:** swap the disabled-method exemplar `saveRule` → `reviewLocalRules` (`saveRule` is now allowlisted → would return `data not ready`/`{ok:false}`, never the disabled gate). |

**Unchanged — verified, do NOT touch:** `dispatcher.ts`, `server.ts`, `request-service-bridge.ts`, `esbuild.mjs`, and all upstream `src/` outside `src/standalone/`.

---

## A note on test placement (`installCatalogItem`)

The spec lists `installCatalogItem` under Integration "(base-URL/host shim or mocked `fetch`)". The handler hard-codes `https://raw.githubusercontent.com/github/awesome-copilot/main/${catalogPath}` (`panel-request-service.ts:634`) with **no env override**, and the integration harness *forks the built CLI as a separate process* — which cannot accept a Vitest `fetch` mock, and must not hit the live network in CI. Therefore `installCatalogItem` is verified **in-process** (Task 6) against the real handler + real stub with `vi.stubGlobal('fetch', …)`, which exercises the identical `fetch → workspace.fs.writeFile` path without a forked process or live GitHub call. The forked-CLI integration suite (Task 8) covers the two network-free writes (`installSkill`, `exportSummary`), which is what the booted harness can assert deterministically. This is a deliberate deviation from the spec's literal placement, made for robustness; the coverage is equivalent.

**Coverage caveat (made explicit):** the *forked bundle* therefore never runs `installCatalogItem`'s `fetch → workspace.fs.writeFile` path end-to-end. That is acceptable because Task 8's `installSkill` drives the **same** `vscode-stub workspace.fs.writeFile` seam through the booted CLI — so "the seam is compiled into the shipped bundle and writes real files" is proven end-to-end; only `installCatalogItem`'s `fetch` wiring is exercised in-process only (Task 6).

---

# Layer 1 — The write seam

### Task 1: Extend `vscode-stub.ts` with the filesystem + dialog surface

**Files:**
- Modify: `src/standalone/vscode-stub.ts`
- Test: `src/standalone/__tests__/vscode-stub.test.ts`
- Verify-unchanged: `src/standalone/__tests__/standalone-html.snapshot.test.ts`

- [ ] **Step 1: Write the failing tests for the write seam**

Append this describe block to `src/standalone/__tests__/vscode-stub.test.ts` (after the existing imports; it reuses the file's existing `import * as vscode from '../vscode-stub'`). Add the Node imports at the top of the file alongside the existing imports:

```typescript
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
```

```typescript
describe('write seam — Uri', () => {
  it('Uri.file returns { fsPath, path } mirroring the input path', () => {
    expect(vscode.Uri.file('/home/u/.agents/skills/x.md')).toEqual({
      fsPath: '/home/u/.agents/skills/x.md',
      path: '/home/u/.agents/skills/x.md',
    });
  });

  it('Uri.joinPath honors a base carrying fsPath', () => {
    expect(vscode.Uri.joinPath({ fsPath: '/base' }, 'a', 'b.md')).toEqual({
      path: '/base/a/b.md',
      fsPath: '/base/a/b.md',
    });
  });

  it('Uri.joinPath honors a base carrying only path', () => {
    expect(vscode.Uri.joinPath({ path: '/p' }, 'c.md')).toEqual({
      path: '/p/c.md',
      fsPath: '/p/c.md',
    });
  });

  it('Uri.joinPath with an empty {} base still equals the joined parts (getDashboardHtml no-op regression guard)', () => {
    // panel-html.ts:11 calls joinPath(extensionUri, 'dist','webview','app.js') with extensionUri = {}.
    // The base-fix must drop the empty base so the result is byte-identical to the old impl.
    expect(vscode.Uri.joinPath({}, 'dist', 'webview', 'app.js')).toEqual({
      path: 'dist/webview/app.js',
      fsPath: 'dist/webview/app.js',
    });
  });
});

describe('write seam — workspace', () => {
  it('workspace.workspaceFolders is undefined (single-folder degrade)', () => {
    expect(vscode.workspace.workspaceFolders).toBeUndefined();
  });

  it('workspace.fs.writeFile creates parent dirs (mkdir-p) and writes the bytes to uri.fsPath', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-stub-'));
    try {
      const target = path.join(tmp, 'nested', 'deep', 'file.txt');
      await vscode.workspace.fs.writeFile(vscode.Uri.file(target), Buffer.from('hello', 'utf8'));
      expect(fs.existsSync(target)).toBe(true);
      expect(fs.readFileSync(target, 'utf8')).toBe('hello');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('write seam — window + env', () => {
  it('showOpenDialog returns COACH_EXPORT_DIR when set', async () => {
    const saved = process.env.COACH_EXPORT_DIR;
    process.env.COACH_EXPORT_DIR = '/tmp/exports';
    try {
      const folders = await vscode.window.showOpenDialog({ canSelectFolders: true });
      expect(folders).toEqual([{ fsPath: '/tmp/exports', path: '/tmp/exports' }]);
    } finally {
      if (saved === undefined) delete process.env.COACH_EXPORT_DIR;
      else process.env.COACH_EXPORT_DIR = saved;
    }
  });

  it('showOpenDialog falls back to ~/.ai-engineer-coach/exports when COACH_EXPORT_DIR is unset', async () => {
    const saved = process.env.COACH_EXPORT_DIR;
    delete process.env.COACH_EXPORT_DIR;
    try {
      const expected = path.join(os.homedir(), '.ai-engineer-coach', 'exports');
      const folders = await vscode.window.showOpenDialog({ canSelectFolders: true });
      expect(folders).toEqual([{ fsPath: expected, path: expected }]);
    } finally {
      if (saved !== undefined) process.env.COACH_EXPORT_DIR = saved;
    }
  });

  it('showInformationMessage resolves undefined (no button → never opens the folder)', async () => {
    expect(await vscode.window.showInformationMessage('done', 'Open Folder')).toBeUndefined();
  });

  it('env.openExternal resolves true (provided for safety; never reached in export flow)', async () => {
    expect(await vscode.env.openExternal({ fsPath: '/x', path: '/x' })).toBe(true);
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run src/standalone/__tests__/vscode-stub.test.ts`
Expected: FAIL — `vscode.Uri.file is not a function`, `Cannot read properties of undefined (reading 'workspaceFolders')` / `'fs'`, `vscode.window is undefined`, `vscode.env is undefined`. The pre-existing `lm` / `LanguageModelChatMessage` tests still PASS.

- [ ] **Step 3: Implement the seam in `vscode-stub.ts`**

Add Node imports at the top of `src/standalone/vscode-stub.ts` (after the existing `import { detectProvider, … } from './llm-provider';`):

```typescript
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
```

Replace the existing `Uri` export (the base-dropping `joinPath`) with the base-honoring version plus `file`:

```typescript
export const Uri = {
  // installSkill:615 / installCatalogItem:651 build absolute targets via Uri.file(`${HOME}/...`).
  file: (p: string) => ({ fsPath: p, path: p }),
  // Honor the base ONLY when present. getDashboardHtml (panel-html.ts:11) passes an empty {}
  // extensionUri → b === '' → filter(Boolean) drops it → identical to the old impl (snapshot
  // stays byte-identical). exportSummaryFiles:47 passes a real folder → must NOT be dropped.
  joinPath: (base: { fsPath?: string; path?: string } | undefined, ...parts: string[]) => {
    const b = base?.fsPath ?? base?.path ?? '';
    const joined = [b, ...parts].filter(Boolean).join('/');
    return { path: joined, fsPath: joined };
  },
};

// --- vscode.workspace / window / env write surface (bucket B) -------------------
// Consumed by panel-request-service.ts (installSkill/installCatalogItem) and
// summary-export-vscode.ts (exportSummaryFiles) via `import * as vscode`. See
// docs-fork/superpowers/spec/2026-05-29-standalone-parity-bucket-b-design.md § A.

export const workspace = {
  // getRuleEditor:742 reads `?.[0]?.uri.fsPath` → undefined (personal+builtin layers only);
  // exportSummaryFiles:33 reads `?.[0]?.uri` → defaultUri = undefined. Both short-circuit cleanly.
  workspaceFolders: undefined as readonly unknown[] | undefined,
  fs: {
    // Replicates VS Code's auto-parent-create: installCatalogItem writes nested
    // ~/.agents/<sub>/<slug>/, installSkill writes ~/.agents/skills/. `data` arrives as a
    // Buffer/Uint8Array (Buffer.from(...)), which fs.writeFile accepts directly.
    async writeFile(uri: { fsPath: string }, data: Uint8Array): Promise<void> {
      await fs.promises.mkdir(path.dirname(uri.fsPath), { recursive: true });
      await fs.promises.writeFile(uri.fsPath, data);
    },
  },
};

export const window = {
  // No interactive folder picker in standalone: always return the configured export dir, so
  // exportSummaryFiles never hits its `cancelled` branch (:45). The default lands under the
  // user's home (sibling to ~/.ai-engineer-coach/rules/) so a one-click export never pollutes
  // the repo `coach` was launched in; COACH_EXPORT_DIR overrides it.
  async showOpenDialog(_opts?: unknown): Promise<Array<{ fsPath: string; path: string }>> {
    const dir = process.env.COACH_EXPORT_DIR || path.join(os.homedir(), '.ai-engineer-coach', 'exports');
    return [{ fsPath: dir, path: dir }];
  },
  // No button → exportSummaryFiles:64 `if (action === 'Open Folder')` never fires.
  async showInformationMessage(_message?: string, ..._items: string[]): Promise<string | undefined> {
    return undefined;
  },
};

export const env = {
  // Never reached (showInformationMessage returns undefined); provided for safety/future use.
  async openExternal(_target: unknown): Promise<boolean> {
    return true;
  },
};
```

Finally, extend the default export to include the new members (so `require('vscode')` default-interop consumers also see them):

```typescript
export default { Uri, lm, workspace, window, env, LanguageModelChatMessage, CancellationTokenSource, CancellationError };
```

- [ ] **Step 4: Run the seam tests to verify they pass**

Run: `npx vitest run src/standalone/__tests__/vscode-stub.test.ts`
Expected: PASS — all new write-seam tests green; the pre-existing `lm` tests still green.

- [ ] **Step 5: Confirm the standalone HTML snapshot is byte-identical (joinPath no-op)**

Run: `npx vitest run src/standalone/__tests__/standalone-html.snapshot.test.ts`
Expected: PASS with **no** snapshot update prompt. The `{}`-base `joinPath` produces `'dist/webview/app.js'` exactly as before, so `getDashboardHtml`'s output is unchanged. (If this fails, the base-fix is wrong — do **not** run `-u`; fix `joinPath`.)

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors. Confirms the stub's new types satisfy `import * as vscode` consumers under strict.

- [ ] **Step 7: Commit**

```bash
git add src/standalone/vscode-stub.ts src/standalone/__tests__/vscode-stub.test.ts
git commit -m "feat(standalone): add fs/dialog write seam to vscode-stub (bucket B layer 1)"
```

---

# Layer 2 — Registry tier (7 rule/import methods)

### Task 2: Allowlist the 7 rule/import methods in `V1_ALLOWED`

**Files:**
- Modify: `src/standalone/v1-allowed.ts`
- Test: `src/standalone/__tests__/v1-allowed.test.ts`

- [ ] **Step 1: Update the gating tests to the new target (write the failing assertions first)**

In `src/standalone/__tests__/v1-allowed.test.ts`, change both `toBe(45)` sites to `toBe(52)`:

```typescript
  it('contains exactly the documented 52', () => {
    expect(V1_ALLOWED.size).toBe(52);
  });

  it('is frozen / readonly', () => {
    expect(() => {
      (V1_ALLOWED as Set<string>).add('totallyNew');
    }).toThrow();
    expect(V1_ALLOWED.size).toBe(52);
  });
```

Replace the `'includes representative read-only methods and excludes write methods'` test with one reflecting the new reality (the two formerly-excluded methods are now allowed):

```typescript
  it('includes representative read-only methods and the now-exposed write/editor methods', () => {
    expect(V1_ALLOWED.has('getSessions')).toBe(true);
    expect(V1_ALLOWED.has('getStats')).toBe(true);
    expect(V1_ALLOWED.has('getRegistryCatalog')).toBe(true);
    expect(V1_ALLOWED.has('saveRule')).toBe(true);        // bucket B: writes via Node fs
    expect(V1_ALLOWED.has('getRuleEditor')).toBe(true);   // bucket B: graceful require('vscode') fallback
  });

  it('includes the bucket-B rule/import methods', () => {
    for (const m of [
      'getRuleEditor', 'getRuleSource', 'getRulePreview',
      'saveRule', 'updateRuleThreshold', 'testRuleLive', 'importRegistryRules',
    ]) {
      expect(V1_ALLOWED.has(m)).toBe(true);
    }
  });
```

Keep the existing `'does NOT add the deferred rule-write methods'` test unchanged (`calibrateRule` / `runRuleTests` stay `false`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/standalone/__tests__/v1-allowed.test.ts`
Expected: FAIL — `expected 45 to be 52`; `expected false to be true` for `saveRule` / `getRuleEditor` / the 7 members.

- [ ] **Step 3: Add the 7 methods to the allowlist**

In `src/standalone/v1-allowed.ts`, add the seven methods to the `_inner` set and update the header comment. Append after the `'explainOccurrence', 'generateRule', 'compileNlRule',` line:

```typescript
  'explainOccurrence', 'generateRule', 'compileNlRule',
  // Bucket B — Rule Editor / Anti-Patterns / Import (registry tier). saveRule writes via Node
  // fs (works as-is; trust recording no-ops with no store). getRuleEditor accepts the graceful
  // require('vscode') fallback (workspaceRoot → undefined → personal+builtin layers). testRuleLive
  // is reached by the rule-editor modal (page-antipatterns-editor.ts:297). importRegistryRules has
  // no caller in src/ yet — allowlisted forward-only (exposes the method; no standalone UI hits it).
  'getRuleEditor', 'getRuleSource', 'getRulePreview',
  'saveRule', 'updateRuleThreshold', 'testRuleLive', 'importRegistryRules',
```

Update the file's top comment to reflect the new count and the bucket-B additions (the `= 45` line becomes `= 52`, noting the 7 rule/import methods and that `getRuleEditor` is no longer excluded). For example:

```typescript
// The authoritative v1 method allowlist (see docs-fork/specs/00-overview.md).
// 40 read-only getRpcHandler methods + 2 bucket-A additions (getDataExplorer,
// evaluateExpression) + 3 bucket-D NL-rule methods (explainOccurrence, generateRule,
// compileNlRule) + 7 bucket-B rule/import methods (getRuleEditor, getRuleSource,
// getRulePreview, saveRule, updateRuleThreshold, testRuleLive, importRegistryRules) = 52.
// calibrateRule / runRuleTests remain deferred (no exposed page reaches them).
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/standalone/__tests__/v1-allowed.test.ts`
Expected: PASS — size 52; all 7 members present; `calibrateRule`/`runRuleTests` still absent.

- [ ] **Step 5: Repair the now-stale `saveRule` disabled-exemplars**

Allowlisting `saveRule` turns it from a disabled method into a registry-routed one, which breaks three existing tests that used `saveRule` as the *disabled* exemplar. Swap each to `reviewLocalRules` — it is in neither allowlist, so it still returns `standalone-v1-disabled` at the tier-3 gate (`dispatcher.ts:59`), **before** the data-ready guard, making it a clean drop-in even when sent pre-`dataReady`:

- `src/standalone/__tests__/dispatcher.test.ts` — in the `'blocks non-whitelisted method (no log line)'` test, change `dispatch('saveRule', {}, readyCtx)` → `dispatch('reviewLocalRules', {}, readyCtx)` and the expected `method: 'saveRule'` → `method: 'reviewLocalRules'`. The other assertions (`standalone-v1-disabled`, `errSpy` not called, `mockedGetRpcHandler` not called) hold unchanged.
- `src/standalone/__tests__/server.test.ts` — in `'nests a disabled-method error inside data, with no sibling error field'`, swap the mocked label `saveRule` → `reviewLocalRules` at all three sites (the `mockResolvedValueOnce` `method`, the `client.send({ … method })`, and the `expect(data.method)`). Dispatch is mocked here, so the test already passes; the swap keeps the label honest now that `saveRule` is live.
- `tests/standalone/integration/cli-rpc-lifecycle.test.ts` — in `'returns a data-nested error for a disabled method'`, change `wsRequest(ws, 'saveRule', { name: 'x' }, 'd1')` → `wsRequest(ws, 'reviewLocalRules', {}, 'd1')`, the expected `method: 'saveRule'` → `method: 'reviewLocalRules'`, and update the `// saveRule ∉ V1_ALLOWED …` comment to `reviewLocalRules`.

All three edits stay inside `src/standalone/**` / `tests/standalone/**`, so the additive-only invariant (Task 10 Step 5, scoped to `-- src/`) is preserved.

- [ ] **Step 6: Re-run the repaired unit suites**

Run: `npx vitest run src/standalone/__tests__/dispatcher.test.ts src/standalone/__tests__/server.test.ts`
Expected: PASS — both disabled-exemplar tests now key on `reviewLocalRules`. (The `cli-rpc-lifecycle.test.ts` swap is an integration test; it is verified in Task 8 / Task 10 Step 3.)

- [ ] **Step 7: Commit**

```bash
git add src/standalone/v1-allowed.ts src/standalone/__tests__/v1-allowed.test.ts \
  src/standalone/__tests__/dispatcher.test.ts src/standalone/__tests__/server.test.ts \
  tests/standalone/integration/cli-rpc-lifecycle.test.ts
git commit -m "feat(standalone): allowlist 7 rule/import methods + repair saveRule disabled-exemplars (bucket B layer 2)"
```

---

### Task 3: Lock in the registry-handler contract through the stub

These are characterization tests: the handlers are upstream and (after Task 2) allowlisted, so they pass on first run. Their value is pinning the standalone contract — `saveRule` writes to disk, `getRuleEditor` degrades without throwing — so future stub/allowlist drift is caught.

**Files:**
- Create: `src/standalone/__tests__/rule-write.test.ts`

- [ ] **Step 1: Write the registry-handler contract tests**

Create `src/standalone/__tests__/rule-write.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getRpcHandler } from '../../webview/panel-rpc'; // pulls vscode → stub via the vitest alias

// A rule markdown that parseRule + createRuleFromMarkdown accept (mirrors the fake-llm fixture).
const VALID_RULE_MD = [
  '---',
  'id: flag-short-prompts',
  'name: flag short prompts',
  'group: prompt-quality',
  'severity: medium',
  'scope: requests',
  'version: 1',
  'tags: [custom]',
  'thresholds:',
  '  maxLength: 30',
  '  maxRatio: 0.3',
  '  minSample: 5',
  '---',
  '',
  '# Description',
  'flag short prompts',
  '',
  '# Filter',
  'messageLength < {{thresholds.maxLength}} AND messageLength > 0',
  '',
  '# Trigger',
  'ratio > {{thresholds.maxRatio}} AND count > {{thresholds.minSample}}',
  '',
  '# When Triggered',
  '{{count}} of {{total}} items ({{pct}}) match this pattern.',
  '',
  '# How to Improve',
  'Review the flagged items and adjust your workflow accordingly.',
  '',
  '# Examples',
  '"{{messageText | truncate:80}}"',
  '',
  '# Test Cases',
  '- input: { "messageLength": 10 }',
  '  expect: flagged',
  '- input: { "messageLength": 200 }',
  '  expect: clean',
].join('\n');

// Minimal analyzer for getRuleEditor / getRulePreview / testRuleLive (they only call
// filterRequests / filterSessions, which return arrays the rule engine runs over).
const fakeAnalyzer = {
  filterRequests: () => [],
  filterSessions: () => [],
} as never;
const fakeParse = {} as never;

const tmpHomes: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const h of tmpHomes.splice(0)) fs.rmSync(h, { recursive: true, force: true });
});

function tmpHome(): string {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-rw-'));
  tmpHomes.push(h);
  // os.homedir() honors $HOME on POSIX (CI is Linux); getPersonalRulesDir() resolves under it.
  vi.stubEnv('HOME', h);
  vi.stubEnv('USERPROFILE', h);
  return h;
}

describe('saveRule (registry write via Node fs)', () => {
  it('writes a parsed rule under ~/.ai-engineer-coach/rules/ and returns { ok:true, filePath }', async () => {
    const home = tmpHome();
    const handler = getRpcHandler('saveRule');
    expect(handler).toBeTypeOf('function');
    const result = (await handler!(undefined as never, undefined as never, { markdown: VALID_RULE_MD })) as {
      ok: boolean;
      filePath: string;
    };
    expect(result.ok).toBe(true);
    expect(result.filePath).toBe(path.join(home, '.ai-engineer-coach', 'rules', 'flag-short-prompts.md'));
    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(fs.readFileSync(result.filePath, 'utf8')).toBe(VALID_RULE_MD);
  });

  it('does not throw on the trust step when no default trust store is set (standalone)', async () => {
    tmpHome();
    const handler = getRpcHandler('saveRule');
    // getDefaultTrustStore() is undefined in standalone → approveTrust is skipped, no throw.
    await expect(handler!(undefined as never, undefined as never, { markdown: VALID_RULE_MD })).resolves.toMatchObject({ ok: true });
  });

  it('returns { ok:false } for empty markdown (no write)', async () => {
    tmpHome();
    const handler = getRpcHandler('saveRule');
    const result = (await handler!(undefined as never, undefined as never, { markdown: '   ' })) as { ok: boolean };
    expect(result.ok).toBe(false);
  });
});

describe('getRuleEditor (registry, degrades with no workspace)', () => {
  it('returns layers + rules + empty pending without throwing (workspaceRoot → undefined)', async () => {
    const handler = getRpcHandler('getRuleEditor');
    const result = (await handler!(fakeAnalyzer, fakeParse, {})) as {
      rules: unknown[];
      layers: unknown;
      pending: unknown[];
    };
    expect(Array.isArray(result.rules)).toBe(true);
    expect(result.layers).toBeDefined();
    expect(result.pending).toEqual([]); // no trust store → getPending() empty
  });
});

describe('getRulePreview / updateRuleThreshold / testRuleLive (registry smoke)', () => {
  it('getRulePreview returns the not-found shape for an unknown ruleId', async () => {
    const handler = getRpcHandler('getRulePreview');
    const result = (await handler!(fakeAnalyzer, fakeParse, { ruleId: 'does-not-exist' })) as {
      previewDescription: string;
      previewExamples: unknown[];
    };
    expect(result.previewDescription).toBe('Rule not found.');
    expect(result.previewExamples).toEqual([]);
  });

  it('updateRuleThreshold returns { ok:false } for an unknown ruleId (no throw)', async () => {
    const handler = getRpcHandler('updateRuleThreshold');
    const result = (await handler!(undefined as never, undefined as never, { ruleId: 'does-not-exist', key: 'maxLength', value: 1 })) as { ok: boolean };
    expect(result.ok).toBe(false);
  });

  it('testRuleLive returns the no-markdown error shape (no throw)', async () => {
    const handler = getRpcHandler('testRuleLive');
    const result = (await handler!(fakeAnalyzer, fakeParse, { markdown: '' })) as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toBe('No rule markdown provided');
  });
});
```

- [ ] **Step 2: Run the contract tests**

Run: `npx vitest run src/standalone/__tests__/rule-write.test.ts`
Expected: PASS. (No red phase — the behavior is provided by the upstream handlers + Task 1 stub + Task 2 allowlist. If `saveRule` writes to your real `~/.ai-engineer-coach/rules/`, the `HOME` stub failed — investigate before proceeding.)

- [ ] **Step 3: Commit**

```bash
git add src/standalone/__tests__/rule-write.test.ts
git commit -m "test(standalone): pin registry rule-write/editor contract through the stub (bucket B)"
```

---

# Layer 3 — Service tier (install ×2 + export)

### Task 4: Allowlist `installSkill` / `installCatalogItem` / `exportSummary` in `V1_SERVICE_ALLOWED`

**Files:**
- Modify: `src/standalone/v1-service-allowed.ts`
- Test: `src/standalone/__tests__/v1-service-allowed.test.ts`

- [ ] **Step 1: Update the gating tests to the new target (failing first)**

In `src/standalone/__tests__/v1-service-allowed.test.ts`, change both `toBe(9)` sites to `toBe(12)`:

```typescript
  it('contains exactly the documented 12 service methods', () => {
    expect(V1_SERVICE_ALLOWED.size).toBe(12);
  });

  it('is frozen / readonly', () => {
    expect(() => {
      (V1_SERVICE_ALLOWED as Set<string>).add('totallyNew');
    }).toThrow();
    expect(V1_SERVICE_ALLOWED.size).toBe(12);
  });
```

Add a membership test for the 3 new methods and update the exclusion test (install/export now allowed; `createSkill` and the bucket-E methods still excluded):

```typescript
  it('includes the bucket-B service write methods', () => {
    for (const m of ['installSkill', 'installCatalogItem', 'exportSummary']) {
      expect(V1_SERVICE_ALLOWED.has(m)).toBe(true);
    }
  });

  it('excludes createSkill (VS Code chat) and the bucket-E service methods', () => {
    expect(V1_SERVICE_ALLOWED.has('createSkill')).toBe(false);
    expect(V1_SERVICE_ALLOWED.has('getWorkspaceDeps')).toBe(false);
    expect(V1_SERVICE_ALLOWED.has('getSdlcRepoScan')).toBe(false);
  });
```

(Delete the old `'excludes createSkill (VS Code chat) and the bucket-B/E service methods'` test — it asserted `installSkill` / `exportSummary` are `false`, which is now wrong. The two tests above replace it.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/standalone/__tests__/v1-service-allowed.test.ts`
Expected: FAIL — `expected 9 to be 12`; `expected false to be true` for `installSkill` / `installCatalogItem` / `exportSummary`.

- [ ] **Step 3: Add the 3 methods to the service allowlist**

In `src/standalone/v1-service-allowed.ts`, append the three methods to `_inner` and update the header comment:

```typescript
const _inner = new Set<string>([
  'generateLearningQuiz', 'generateCodeComparison', 'generateDidYouKnow', 'generateLearningResources',
  'generateSkillContent', 'triageSkills', 'triageCatalog', 'discoverCatalog',
  'reviewContextFiles',
  // Bucket B — service-tier writes. installSkill/installCatalogItem write via the vscode-stub
  // workspace.fs seam; exportSummary delegates to exportSummaryFiles through the same seam.
  'installSkill', 'installCatalogItem', 'exportSummary',
]);
```

Update the top comment: `Learning ×4 + Skill ×4 + Context ×1 (= 9) + bucket-B writes ×3 (installSkill, installCatalogItem, exportSummary) = 12. Still excludes createSkill (opens VS Code chat) and the bucket-E methods (getWorkspaceDeps / getSdlc*).`

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/standalone/__tests__/v1-service-allowed.test.ts`
Expected: PASS — size 12; the 3 members present; `createSkill` / bucket-E still absent.

- [ ] **Step 5: Commit**

```bash
git add src/standalone/v1-service-allowed.ts src/standalone/__tests__/v1-service-allowed.test.ts
git commit -m "feat(standalone): allowlist install/export on the service-bridge tier (bucket B layer 3)"
```

---

### Task 5: Shim hygiene — shrink `BANNER_WORTHY` and empty `RESOLVE_EMPTY_WHEN_DISABLED`

Once `installSkill` / `installCatalogItem` / `getRuleEditor` are allowlisted, the dispatcher never returns `standalone-v1-disabled` for them, so their banner / resolve-empty branches are unreachable. Remove the dead entries for hygiene (mechanism stays inert).

**Files:**
- Modify: `src/standalone/webview-shim.ts`
- Test: `src/standalone/__tests__/webview-shim.test.ts`

- [ ] **Step 1: Update the shim tests to the new reality (failing first)**

In `src/standalone/__tests__/webview-shim.test.ts`, replace the `BANNER_WORTHY` describe block body with:

```typescript
describe('BANNER_WORTHY', () => {
  it('contains only createSkill after buckets D + B went live', () => {
    expect(BANNER_WORTHY.has('createSkill')).toBe(true);       // opens VS Code chat; still degraded
    expect(BANNER_WORTHY.has('installSkill')).toBe(false);     // bucket B: now bridged & live
    expect(BANNER_WORTHY.has('installCatalogItem')).toBe(false); // bucket B: now bridged & live
    expect(BANNER_WORTHY.has('getRuleEditor')).toBe(false);    // bucket B: now allowlisted & live
    expect(BANNER_WORTHY.has('triageCatalog')).toBe(false);    // bucket D
    expect(BANNER_WORTHY.has('getStats')).toBe(false);         // allowed, not disabled
    expect(BANNER_WORTHY.size).toBe(1);
  });
});
```

In the `'repeated disabled responses do not stack banners'` test, change the second frame from `installSkill` (no longer banner-worthy) to a second `createSkill` so the "no stacking" intent still holds:

```typescript
  it('repeated disabled responses do not stack banners', () => {
    installWithToken();
    const ws = MockWebSocket.instances[0];

    ws.message(JSON.stringify(disabledFrame('createSkill')));
    ws.message(JSON.stringify(disabledFrame('createSkill')));

    expect(document.querySelectorAll(BANNER_ID)).toHaveLength(1);
  });
```

Replace the `'neutralizes a disabled RESOLVE_EMPTY method (getRuleEditor)'` test with a test that the mechanism is now inert (per spec):

```typescript
  it('RESOLVE_EMPTY_WHEN_DISABLED is empty — getRuleEditor is allowlisted now (mechanism inert)', () => {
    expect(RESOLVE_EMPTY_WHEN_DISABLED.size).toBe(0);
    expect(RESOLVE_EMPTY_WHEN_DISABLED.has('getRuleEditor')).toBe(false);
  });
```

Keep the `'forwards a non-RESOLVE_EMPTY banner method unchanged (it keeps rejecting)'` test (`createSkill`) unchanged.

- [ ] **Step 2: Run the shim tests to verify they fail**

Run: `npx vitest run src/standalone/__tests__/webview-shim.test.ts`
Expected: FAIL — `expected 4 to be 1`; `installCatalogItem` / `getRuleEditor` still `true`; `RESOLVE_EMPTY_WHEN_DISABLED.size` is `1` not `0`.

- [ ] **Step 3: Shrink the two sets in `webview-shim.ts`**

In `src/standalone/webview-shim.ts`, replace the `BANNER_WORTHY` declaration:

```typescript
// Curated set: only these disabled methods trigger the roadmap banner. Everything else
// disabled is silent. After buckets D + B, only createSkill remains degraded (it opens VS
// Code chat — no standalone equivalent). installSkill/installCatalogItem (bucket B) are now
// bridged and getRuleEditor (bucket B) is allowlisted, so the dispatcher never returns
// standalone-v1-disabled for them and their banner branch is unreachable — removed for hygiene.
export const BANNER_WORTHY: ReadonlySet<string> = new Set(['createSkill']);
```

Replace the `RESOLVE_EMPTY_WHEN_DISABLED` declaration (keep the explanatory comment, note it is now inert):

```typescript
// Disabled methods a page awaits as PRIMARY render data with no per-call fallback would need
// neutralizing to an empty frame so rpc() resolves instead of crashing the page render.
// getRuleEditor was the sole member; bucket B allowlists it, so the dispatcher no longer
// disables it and this branch is unreachable. Emptied for hygiene (mechanism kept inert).
export const RESOLVE_EMPTY_WHEN_DISABLED: ReadonlySet<string> = new Set<string>();
```

- [ ] **Step 4: Run the shim tests to verify they pass**

Run: `npx vitest run src/standalone/__tests__/webview-shim.test.ts`
Expected: PASS — `BANNER_WORTHY.size === 1`; `RESOLVE_EMPTY_WHEN_DISABLED.size === 0`; banner/no-stack/forwarding behavior intact.

- [ ] **Step 5: Commit**

```bash
git add src/standalone/webview-shim.ts src/standalone/__tests__/webview-shim.test.ts
git commit -m "chore(standalone): shrink BANNER_WORTHY to createSkill, empty RESOLVE_EMPTY (bucket B hygiene)"
```

---

### Task 6: Lock in the service-handler contract through the real `PanelRequestService` + stub

In-process contract tests that drive the real `installSkill` / `installCatalogItem` handlers (vscode → stub via the Vitest alias). `installCatalogItem` mocks global `fetch` here (see "A note on test placement" above).

**Files:**
- Create: `src/standalone/__tests__/service-writes.test.ts`

- [ ] **Step 1: Write the service-handler contract tests**

Create `src/standalone/__tests__/service-writes.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type * as vscode from 'vscode';
import { PanelRequestService } from '../../webview/panel-request-service'; // vscode → stub via alias
import type { RequestMessage } from '../../webview/panel-shared';

interface Frame {
  type?: string;
  id?: string;
  data?: Record<string, unknown>;
}

function makeService(): { frames: Frame[]; service: PanelRequestService } {
  const frames: Frame[] = [];
  const webview = { postMessage: (f: Frame): void => { frames.push(f); } };
  // installSkill / installCatalogItem need no analyzer.
  const service = new PanelRequestService(
    webview as unknown as vscode.Webview,
    () => undefined,
    () => undefined,
  );
  return { frames, service };
}

const tmpHomes: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  for (const h of tmpHomes.splice(0)) fs.rmSync(h, { recursive: true, force: true });
});

function tmpHome(): string {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-sw-'));
  tmpHomes.push(h);
  vi.stubEnv('HOME', h);
  vi.stubEnv('USERPROFILE', h);
  return h;
}

describe('installSkill (service write via the stub workspace.fs seam)', () => {
  it('writes ~/.agents/skills/<filename> and responds { ok:true, path }', async () => {
    const home = tmpHome();
    const { frames, service } = makeService();
    const handled = service.tryHandle({ type: 'request', id: 'is1', method: 'installSkill', params: { filename: 'demo.md', content: 'hello-skill' } } as RequestMessage);
    expect(handled).toBe(true);
    await vi.waitFor(() => expect(frames).toHaveLength(1));

    const target = path.join(home, '.agents', 'skills', 'demo.md');
    expect(frames[0]).toMatchObject({ type: 'response', id: 'is1', data: { ok: true, path: target } });
    expect(fs.readFileSync(target, 'utf8')).toBe('hello-skill');
  });

  it('responds with an error frame for a traversal filename (no write)', async () => {
    tmpHome();
    const { frames, service } = makeService();
    service.tryHandle({ type: 'request', id: 'is2', method: 'installSkill', params: { filename: '../evil.md', content: 'x' } } as RequestMessage);
    await vi.waitFor(() => expect(frames).toHaveLength(1));
    expect((frames[0].data as { error?: string }).error).toBe('Invalid filename');
  });
});

describe('installCatalogItem (fetch + service write via the stub seam)', () => {
  it('fetches the canned body and writes ~/.agents/skills/<slug>/<file>, responding { content, filename }', async () => {
    const home = tmpHome();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('# Canned skill\n', { status: 200 })));
    const { frames, service } = makeService();
    service.tryHandle({ type: 'request', id: 'ci1', method: 'installCatalogItem', params: { path: 'skills/demo/demo.md', kind: 'skill', title: 'Demo Skill' } } as RequestMessage);
    await vi.waitFor(() => expect(frames).toHaveLength(1));

    const target = path.join(home, '.agents', 'skills', 'demo-skill', 'demo.md');
    expect(frames[0]).toMatchObject({ type: 'response', id: 'ci1', data: { content: '# Canned skill\n', filename: 'demo-skill/demo.md' } });
    expect(fs.readFileSync(target, 'utf8')).toBe('# Canned skill\n');
  });

  it('responds with an error frame for a traversal catalog path (no fetch, no write)', async () => {
    tmpHome();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { frames, service } = makeService();
    service.tryHandle({ type: 'request', id: 'ci2', method: 'installCatalogItem', params: { path: '../etc/passwd', kind: 'skill', title: 'x' } } as RequestMessage);
    await vi.waitFor(() => expect(frames).toHaveLength(1));
    expect((frames[0].data as { error?: string }).error).toBe('Invalid catalog path');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the service-handler contract tests**

Run: `npx vitest run src/standalone/__tests__/service-writes.test.ts`
Expected: PASS. (No red phase — the behavior is provided by the upstream handlers + Task 1 stub. If files land in your real `~/.agents/`, the `HOME` stub failed — investigate before proceeding.)

- [ ] **Step 3: Commit**

```bash
git add src/standalone/__tests__/service-writes.test.ts
git commit -m "test(standalone): pin installSkill/installCatalogItem contract through the stub (bucket B)"
```

---

### Task 7: Add dispatcher tier-routing cases

Prove the routing the allowlists unlock: rule methods → registry tier; install/export → service-bridge tier; `reviewLocalRules` / `createSkill` stay disabled. `dispatcher.test.ts` already mocks `getRpcHandler` and `dispatchServiceMethod`, so these assert *which tier* fires. (The stale `saveRule` disabled-exemplar in this file was already repaired in Task 2 Step 5, so this task is purely **additive** — it appends a new describe block.)

**Files:**
- Modify: `src/standalone/__tests__/dispatcher.test.ts`

- [ ] **Step 1: Add the routing cases**

Append this describe block to `src/standalone/__tests__/dispatcher.test.ts` (it reuses the file's existing `dispatch`, `readyCtx`, `fakeHandler`, `mockedGetRpcHandler`, `mockedDispatchService`):

```typescript
describe('dispatch — bucket B tier routing', () => {
  it('routes saveRule through the registry tier (now allowlisted)', async () => {
    mockedGetRpcHandler.mockReturnValueOnce(fakeHandler(async () => ({ ok: true, filePath: '/p/x.md' })));
    const res = await dispatch('saveRule', { markdown: 'x' }, readyCtx);
    expect(res).toEqual({ ok: true, data: { ok: true, filePath: '/p/x.md' } });
    expect(mockedGetRpcHandler).toHaveBeenCalledWith('saveRule');
    expect(mockedDispatchService).not.toHaveBeenCalled();
  });

  it('routes getRuleEditor through the registry tier (now allowlisted)', async () => {
    mockedGetRpcHandler.mockReturnValueOnce(fakeHandler(async () => ({ rules: [], layers: {}, pending: [] })));
    const res = await dispatch('getRuleEditor', {}, readyCtx);
    expect(res).toEqual({ ok: true, data: { rules: [], layers: {}, pending: [] } });
    expect(mockedGetRpcHandler).toHaveBeenCalledWith('getRuleEditor');
  });

  it('routes installSkill to the service bridge, not the registry', async () => {
    mockedDispatchService.mockResolvedValueOnce({ ok: true, data: { ok: true, path: '/p/demo.md' } });
    const res = await dispatch('installSkill', { filename: 'demo.md', content: 'x' }, readyCtx);
    expect(res).toEqual({ ok: true, data: { ok: true, path: '/p/demo.md' } });
    expect(mockedDispatchService).toHaveBeenCalledWith('installSkill', { filename: 'demo.md', content: 'x' }, readyCtx);
    expect(mockedGetRpcHandler).not.toHaveBeenCalled();
  });

  it('routes exportSummary to the service bridge, not the registry', async () => {
    mockedDispatchService.mockResolvedValueOnce({ ok: true, data: { ok: true, folder: '/exports' } });
    const res = await dispatch('exportSummary', {}, readyCtx);
    expect(res).toEqual({ ok: true, data: { ok: true, folder: '/exports' } });
    expect(mockedDispatchService).toHaveBeenCalledWith('exportSummary', {}, readyCtx);
    expect(mockedGetRpcHandler).not.toHaveBeenCalled();
  });

  it('still disables reviewLocalRules and createSkill (neither allowlist)', async () => {
    const reviewRes = await dispatch('reviewLocalRules', {}, readyCtx);
    const createRes = await dispatch('createSkill', {}, readyCtx);
    expect(reviewRes).toEqual({ ok: false, error: { code: 'standalone-v1-disabled', method: 'reviewLocalRules' } });
    expect(createRes).toEqual({ ok: false, error: { code: 'standalone-v1-disabled', method: 'createSkill' } });
    expect(mockedGetRpcHandler).not.toHaveBeenCalled();
    expect(mockedDispatchService).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the dispatcher tests**

Run: `npx vitest run src/standalone/__tests__/dispatcher.test.ts`
Expected: PASS — all new routing cases green (depends on Tasks 2 + 4 having landed), existing dispatcher tests still green.

- [ ] **Step 3: Commit**

```bash
git add src/standalone/__tests__/dispatcher.test.ts
git commit -m "test(standalone): assert bucket B tier routing (rule→registry, install/export→bridge)"
```

---

# Integration, smoke, and verification

### Task 8: End-to-end integration over the booted CLI

`installSkill` (sandbox `HOME` → file appears) and `exportSummary` (`COACH_EXPORT_DIR` → both files + result shape). These prove the stub seam + allowlists are compiled into the shipped CLI bundle. `installCatalogItem` is intentionally omitted (covered in Task 6 — see "A note on test placement").

**Files:**
- Create: `tests/standalone/integration/cli-write-path.test.ts`
- Prerequisite: a fresh build (the integration suite forks `dist/standalone/cli.js`).

- [ ] **Step 1: Rebuild the standalone CLI bundle**

Run: `npm run build`
Expected: build completes with no errors; `dist/standalone/cli.js` is regenerated with the Task 1 stub + Tasks 2/4 allowlists.

- [ ] **Step 2: Write the integration tests**

Create `tests/standalone/integration/cli-write-path.test.ts`:

```typescript
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bootCli, makeTmpHome, stopCli, wsConnect, wsRequest, wsWaitFor, type Booted } from './helpers';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

function track(b: Booted, home: string): Booted {
  cleanups.push(async () => { await stopCli(b); fs.rmSync(home, { recursive: true, force: true }); });
  return b;
}

describe('cli write path (bucket B)', () => {
  it('installSkill writes the file under the sandbox HOME and returns { ok:true, path }', async () => {
    const home = makeTmpHome();
    const b = track(await bootCli(home, ['--port', '7370']), home);
    const ws = await wsConnect(b);
    await wsWaitFor(ws, 'dataReady');

    const res = await wsRequest(ws, 'installSkill', { filename: 'smoke.md', content: '# Smoke skill' }, 'is1');
    ws.close();

    const data = res.data as { ok?: boolean; path?: string; code?: string };
    expect(data.code).not.toBe('standalone-v1-disabled'); // was disabled before bucket B
    expect(data.ok).toBe(true);
    const written = path.join(home, '.agents', 'skills', 'smoke.md');
    expect(fs.existsSync(written)).toBe(true);
    expect(fs.readFileSync(written, 'utf8')).toBe('# Smoke skill');
  });

  it('exportSummary writes summary-*.md and summary-*.json into COACH_EXPORT_DIR', async () => {
    const home = makeTmpHome();
    const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-exp-'));
    cleanups.push(() => fs.rmSync(exportDir, { recursive: true, force: true }));
    const b = track(await bootCli(home, ['--port', '7371'], 20_000, { COACH_EXPORT_DIR: exportDir }), home);
    const ws = await wsConnect(b);
    await wsWaitFor(ws, 'dataReady'); // analyzer present after this frame

    const res = await wsRequest(ws, 'exportSummary', {}, 'es1');
    ws.close();

    const data = res.data as { ok?: boolean; folder?: string; markdownPath?: string; jsonPath?: string; code?: string };
    expect(data.code).not.toBe('standalone-v1-disabled');
    expect(data.ok).toBe(true);
    expect(data.folder).toBe(exportDir);
    expect(typeof data.markdownPath).toBe('string');
    expect(typeof data.jsonPath).toBe('string');
    expect(fs.existsSync(data.markdownPath!)).toBe(true);
    expect(fs.existsSync(data.jsonPath!)).toBe(true);
    expect(path.dirname(data.markdownPath!)).toBe(exportDir); // wrote nowhere real
  });
});
```

- [ ] **Step 3: Run the integration suite**

Run: `npm run test:integration:standalone`
Expected: PASS — the new `cli write path` tests plus all pre-existing integration tests green. (The suite is serialized — `fileParallelism: false` — so the new ports 7370/7371 won't clash.) `cli-rpc-lifecycle.test.ts`'s disabled-method exemplar was already swapped `saveRule` → `reviewLocalRules` in Task 2 Step 5, so it stays green now that `saveRule` is allowlisted.

- [ ] **Step 4: Commit**

```bash
git add tests/standalone/integration/cli-write-path.test.ts
git commit -m "test(standalone): integration for installSkill + exportSummary write path (bucket B)"
```

---

### Task 9: Playwright browser smoke + sandbox the export dir

Drive `saveRule` / `installSkill` / `exportSummary` through the shim's outbound channel (the established smoke pattern). First, point the smoke server's `COACH_EXPORT_DIR` at a known sandbox subdir so `exportSummary` writes to a predictable, teardown-cleaned location the smoke can assert on (the returned `folder` contains `.coach-exports`). (`HOME` is already the sandbox tmp dir, so the home-based default `~/.ai-engineer-coach/exports/` would also stay out of the repo — but pinning `COACH_EXPORT_DIR` is what makes the `.coach-exports` assertion deterministic.)

**Files:**
- Modify: `tests/standalone/playwright/global-setup.ts`
- Modify: `tests/standalone/playwright/smoke.spec.ts`
- Prerequisite: the Task 8 rebuild (Playwright forks the same `dist/standalone/cli.js`).

- [ ] **Step 1: Sandbox `COACH_EXPORT_DIR` in `global-setup.ts`**

In `tests/standalone/playwright/global-setup.ts`, add the export dir to the CLI fork's env. Change the `child = fork(CLI, …)` env block from:

```typescript
    env: { ...process.env, HOME: home, USERPROFILE: home, ANTHROPIC_API_KEY: 'smoke-test-key', COACH_LLM_BASE_URL: fakeUrl },
```

to:

```typescript
    env: { ...process.env, HOME: home, USERPROFILE: home, ANTHROPIC_API_KEY: 'smoke-test-key', COACH_LLM_BASE_URL: fakeUrl, COACH_EXPORT_DIR: path.join(home, '.coach-exports') },
```

(`home` is already `fs.mkdtempSync(...)` and is removed by `global-teardown.ts`, so the exported files are cleaned up with it. `path` is already imported in this file.)

- [ ] **Step 2: Add the smoke tests**

Append these tests to `tests/standalone/playwright/smoke.spec.ts`:

```typescript
test('rule editor saves a rule (saveRule writes to the sandbox HOME)', async ({ page }) => {
  await page.goto(pageUrl('rule-editor'), { waitUntil: 'load' });
  await expect.poll(() => page.locator('main#content > *').count(), { timeout: 15_000 }).toBeGreaterThan(0);

  const RULE_MD = [
    '---', 'id: smoke-rule', 'name: smoke rule', 'group: prompt-quality', 'severity: low',
    'scope: requests', 'version: 1', 'tags: [custom]', 'thresholds:', '  maxLength: 30', '---', '',
    '# Description', 'smoke rule', '', '# Filter', 'messageLength > 0', '',
    '# Trigger', 'count > 0', '', '# When Triggered', '{{count}} of {{total}}.', '',
    '# How to Improve', 'n/a', '', '# Examples', '"{{messageText}}"',
  ].join('\n');

  const ok = await page.evaluate(async (markdown) => {
    const api = (window as unknown as { acquireVsCodeApi: () => { postMessage: (m: unknown) => void } }).acquireVsCodeApi();
    return await new Promise<boolean>((resolve) => {
      const onMsg = (ev: MessageEvent) => {
        const f = ev.data as { type?: string; id?: string; data?: { ok?: boolean; filePath?: string; error?: string } };
        if (f.type === 'response' && f.id === 'smoke-save-rule') {
          window.removeEventListener('message', onMsg);
          resolve(f.data?.ok === true && typeof f.data?.filePath === 'string' && !f.data?.error);
        }
      };
      window.addEventListener('message', onMsg);
      api.postMessage({ type: 'request', id: 'smoke-save-rule', method: 'saveRule', params: { markdown } });
      setTimeout(() => { window.removeEventListener('message', onMsg); resolve(false); }, 10_000);
    });
  }, RULE_MD);
  expect(ok).toBe(true);
});

test('skills installs a skill (installSkill writes to the sandbox HOME)', async ({ page }) => {
  await page.goto(pageUrl('skills'), { waitUntil: 'load' });
  await expect(page.locator('.nav-links a[data-page="skills"]')).toHaveClass(/active/, { timeout: 15_000 });

  const ok = await page.evaluate(async () => {
    const api = (window as unknown as { acquireVsCodeApi: () => { postMessage: (m: unknown) => void } }).acquireVsCodeApi();
    return await new Promise<boolean>((resolve) => {
      const onMsg = (ev: MessageEvent) => {
        const f = ev.data as { type?: string; id?: string; data?: { ok?: boolean; path?: string; error?: string } };
        if (f.type === 'response' && f.id === 'smoke-install-skill') {
          window.removeEventListener('message', onMsg);
          resolve(f.data?.ok === true && typeof f.data?.path === 'string' && !f.data?.error);
        }
      };
      window.addEventListener('message', onMsg);
      api.postMessage({ type: 'request', id: 'smoke-install-skill', method: 'installSkill', params: { filename: 'smoke-skill.md', content: '# Smoke' } });
      setTimeout(() => { window.removeEventListener('message', onMsg); resolve(false); }, 10_000);
    });
  });
  expect(ok).toBe(true);
});

test('level-up exports a summary (exportSummary writes to COACH_EXPORT_DIR)', async ({ page }) => {
  await page.goto(pageUrl('level-up'), { waitUntil: 'load' });
  await expect(page.locator('.nav-links a[data-page="level-up"]')).toHaveClass(/active/, { timeout: 15_000 });

  const folder = await page.evaluate(async () => {
    const api = (window as unknown as { acquireVsCodeApi: () => { postMessage: (m: unknown) => void } }).acquireVsCodeApi();
    return await new Promise<string | null>((resolve) => {
      const onMsg = (ev: MessageEvent) => {
        const f = ev.data as { type?: string; id?: string; data?: { ok?: boolean; folder?: string; error?: string } };
        if (f.type === 'response' && f.id === 'smoke-export') {
          window.removeEventListener('message', onMsg);
          resolve(f.data?.ok === true && !f.data?.error ? (f.data?.folder ?? null) : null);
        }
      };
      window.addEventListener('message', onMsg);
      api.postMessage({ type: 'request', id: 'smoke-export', method: 'exportSummary', params: {} });
      setTimeout(() => { window.removeEventListener('message', onMsg); resolve(null); }, 10_000);
    });
  });
  expect(folder).toContain('.coach-exports'); // server-chosen sandbox dir, never the repo cwd
});
```

- [ ] **Step 3: Run the Playwright smoke suite**

Run: `npm run test:playwright:standalone`
Expected: PASS — the 3 new smokes plus all pre-existing smokes green. After the run, confirm no `summary-*.md`/`summary-*.json` appeared in the repo root:

Run: `git status --porcelain && ls summary-*.md summary-*.json 2>/dev/null || echo "no stray export files"`
Expected: `no stray export files` and a clean-of-exports working tree (only your intended source/test/doc changes).

- [ ] **Step 4: Commit**

```bash
git add tests/standalone/playwright/global-setup.ts tests/standalone/playwright/smoke.spec.ts
git commit -m "test(standalone): playwright smoke for saveRule/installSkill/exportSummary + sandbox export dir (bucket B)"
```

---

### Task 10: Full-suite verification + additive-only invariant

**Files:** none (verification only).

- [ ] **Step 1: Full unit suite (incl. snapshot)**

Run: `npm test`
Expected: PASS — every unit test green, including `standalone-html.snapshot.test.ts` (no snapshot drift) and the four updated gating tests at their new counts (52 / 12 / 1 / 0).

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: no type errors; no lint errors under `src/`.

- [ ] **Step 3: Integration + Playwright (against the Task 8 build)**

Run: `npm run test:integration:standalone && npm run test:playwright:standalone`
Expected: PASS for both. (If you changed any `src/standalone` file after Task 8's build, re-run `npm run build` first — these suites fork the built bundle.)

- [ ] **Step 4: Pack check (stub additions compile into the existing CLI bundle, no new entry)**

Run: `npm run pack:check`
Expected: `npm pack --dry-run` succeeds; the package contents are unchanged in shape (no new bundle entry — the stub additions ride inside the existing `dist/standalone/cli.js`).

- [ ] **Step 5: Verify the additive-only fork invariant (`src/`)**

Run: `git diff upstream/main -- src/ | grep -E '^[-+]' | grep -vE '^[-+]{3}'`
Expected: every changed line is an addition (`+`) and every added line is inside `src/standalone/` (the four modified fork files, the two new test files, and the modified test files under `src/standalone/__tests__/`). **No** deletions of upstream lines, and **no** `+`/`-` on any `src/` path outside `src/standalone/`.
(If `upstream/main` is not configured in this clone, set it up exactly as the prior plans document — see `docs-fork/plans/01-server.plan.md` (`git remote add upstream <url> && git fetch upstream`) — then re-run.)

- [ ] **Step 6: Verify the shared build/config files are untouched**

Run: `git diff upstream/main --stat -- esbuild.mjs package.json src/standalone/dispatcher.ts src/standalone/server.ts src/standalone/request-service-bridge.ts`
Expected: **empty** (no output). Bucket B adds no dependency, no build change, and no edit to the dispatcher / server / bridge — the seam + allowlists carry everything.

- [ ] **Step 7: Final commit (if any verification touched tracked files) and wrap-up**

If steps above produced no file changes, there is nothing to commit. Otherwise:

```bash
git add -A
git commit -m "chore(standalone): bucket B verification pass (additive-only invariant confirmed)"
```

---

## Self-Review

**1. Spec coverage** — every spec section maps to a task:

| Spec section | Task(s) |
| --- | --- |
| § A. Write seam (`Uri.file`, `joinPath` base-fix, `workspace.fs.writeFile`, `workspaceFolders`, `showOpenDialog`, `showInformationMessage`, `env.openExternal`) | Task 1 |
| § B. Registry tier — allowlist 7 (45 → 52) | Task 2 (+ contract Task 3) |
| § C. Service tier — allowlist 3 (9 → 12) | Task 4 (+ contract Task 6) |
| § E. Shim hygiene (`BANNER_WORTHY` 4 → 1, `RESOLVE_EMPTY_WHEN_DISABLED` → ∅) | Task 5 |
| § D. Export specifics (`COACH_EXPORT_DIR`, result shape) | Tasks 6/8/9 |
| Testing → stub seam unit | Task 1 |
| Testing → registry unit | Task 3 |
| Testing → gating unit (membership + dispatcher routing) | Tasks 2, 4, 5, 7 |
| Testing → integration | Task 8 (installSkill, exportSummary); Task 6 (installCatalogItem, in-process — documented deviation) |
| Testing → Playwright smoke | Task 9 |
| Testing → snapshot unchanged | Task 1 Step 5, Task 10 Step 1 |
| Testing → pack | Task 10 Step 4 |
| Test deltas (45→52, 9→12, banner 4→1, repurpose RESOLVE_EMPTY test; swap stale `saveRule`→`reviewLocalRules` exemplars in dispatcher/server/cli-rpc-lifecycle; export-dir fallback test → `~/.ai-engineer-coach/exports/`) | Tasks 1, 2, 4, 5 |
| Invariant verification | Task 10 Steps 5–6 |

**2. Placeholder scan** — no `TBD`/`later`/"handle edge cases"; every code step shows complete code; every command states expected output.

**3. Type/name consistency** — method names match upstream exactly (`getRuleEditor`, `getRuleSource`, `getRulePreview`, `saveRule`, `updateRuleThreshold`, `testRuleLive`, `importRegistryRules`, `installSkill`, `installCatalogItem`, `exportSummary`). Stub member names (`Uri.file`, `Uri.joinPath`, `workspace.fs.writeFile`, `workspace.workspaceFolders`, `window.showOpenDialog`, `window.showInformationMessage`, `env.openExternal`) match the consumer call sites in `panel-request-service.ts` and `summary-export-vscode.ts`. Counts are internally consistent: 45 → 52 (+7), 9 → 12 (+3), banner 4 → 1, resolve-empty 1 → 0.

**Known non-red TDD tasks (called out honestly):** Tasks 3 and 6 are contract/characterization tests — they pass on first run because the behavior is supplied by upstream handlers + the Task 1 stub + the Tasks 2/4 allowlists. They exist to pin the standalone contract, not to drive new production code. Every other task has a genuine red → green cycle.
