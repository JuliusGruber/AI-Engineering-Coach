# Continuous Upstream Sync for an Additive-Only Fork: Strategy + Skill Design

> Derived 2026-05-30 against `upstream/main` = `3a41450`, merge-base `1fef41a`
> (HEAD 67 commits behind). Produced by a codebase-grounded + web-researched,
> adversarially-verified workflow. Load-bearing claims (merge-base authorship
> diff, commit `e3be742`, the esbuild redirect plugin) re-verified by hand
> against the live repo.

## 1. TL;DR

- **Use plain `git merge upstream/main`** (never rebase, subtree, or `-s ours`). The fork's shape — upstream tree at the repo root plus one added directory `src/standalone/` — makes merge the only mechanism that keeps `git diff upstream/main` meaningful and conflict-free. The `upstream/main` remote-tracking ref *is* your vendor branch for free.
- **Enforce the invariant against the merge-base, not `upstream/main`.** The reliable authorship gate is `git diff --name-only $(git merge-base HEAD upstream/main) HEAD -- src/ ':(exclude)src/standalone/'` — it must be empty. Gating on `upstream/main` directly reports ~16 false positives (behind-upstream noise).
- **Behavior overrides live in the build, not in core.** `esbuild.mjs:19-49` redirects `core/constants` → `src/standalone/standalone-constants.ts` to flip `FF_TOKEN_REPORTING_ENABLED` for standalone bundles only, so `src/core/constants.ts:127` stays byte-identical to upstream. Any future override follows this pattern — never edit core.
- **Parity gaps are a set-difference + four secondary signals.** `unexposed = keyof ExtensionMethodMap \ (V1_ALLOWED ∪ V1_SERVICE_ALLOWED ∪ keys(STANDALONE_NATIVE))`, then layer FF-gate / call-site / deep-link / write-path tags. The mechanical diff regenerates the bulk of `docs-fork/STANDALONE-PARITY-GAPS.md`; bucketing/difficulty stay human.
- **Ship one project skill `merging-upstream`** with low-freedom helper scripts for the dangerous git plumbing and high-freedom prose for triage. It never auto-pushes, never auto-reverts the legit Windows `path.join` fix, and surfaces conflicts for a human.

---

## 2. The merge strategy

### 2.1 Mechanism choice: `git merge` (justified)

| Candidate | Verdict for this fork |
|---|---|
| **`git merge upstream/main`** | **CHOSEN.** Fork = upstream-at-root + one added dir. Merge keeps upstream files byte-identical and `git diff upstream/main` meaningful. GitHub's "Syncing a fork" doc shows exactly this as the default. |
| `git rebase` | **Rejected.** The fork's `main` is published (`origin`), so rebase forces force-pushes onto anyone tracking it and re-derives conflicts every sync. Safe only for a local in-progress feature branch before it lands. |
| `git subtree` | **Rejected.** Subtree is for the *inverse* topology (a host repo vendoring a dependency into a subdir). It would invert the upstream/fork relationship and break root-level byte-identity. |
| `-s ours` strategy | **Rejected/dangerous.** It "does not even look at what the other tree contains" — it would silently drop real upstream changes, defeating the purpose. (`-X ours` *option* is different and reserved for one narrow case below.) |
| vendor-branch | **Already have it.** `upstream/main` *is* the pristine vendor line; `origin/main` is the customized line that merges from it. No separate branch needed. |

### 2.2 One-time setup (idempotent)

```bash
git remote get-url upstream || git remote add upstream https://github.com/microsoft/AI-Engineering-Coach.git
git remote get-url origin   # https://github.com/JuliusGruber/AI-Engineering-Coach.git
git config --global rerere.enabled true   # reuse recorded conflict resolutions across syncs
```

`rerere` is purely additive (records under `.git/rr-cache`, no history impact). For an additive-only fork the same conflict recurs in the same spot (e.g. a file adjacent to `src/standalone/` that upstream keeps editing), so the 2nd+ resolution becomes automatic. Recover a bad recording with `git rerere forget <path>`.

### 2.3 Routine sync

```bash
git fetch upstream
git rev-parse --verify upstream/main          # = 3a41450 at time of analysis; HEAD is 67 behind

git switch -c sync/upstream-$(date +%Y%m%d)   # NEVER merge onto main directly
git merge --no-ff upstream/main               # may stop on conflicts

# If conflicts: resolve, leaning on rerere. Then:
git diff --check                              # no conflict markers left
git merge --continue
```

**Conflict policy:**
- A conflict *inside* `src/standalone/` → resolve manually (it's your code colliding with an upstream rename/signature change — exactly the signal you want).
- A conflict in a **generated/lock-style file** that upstream also touches → `-X theirs`/`-X ours` is acceptable for that one path (deterministic side wins). Do **not** blanket-apply it.
- A conflict in **any other core file** → this is accidental drift; resolve toward upstream and then verify the file ends byte-identical (§3 gate).

### 2.4 Remediating the already-drifted files

The naive command (`git diff upstream/main -- src/`) lists files, but the **merge-base** diff shows only **3 fork-authored/merge-resolved** files, and only **one** is a deliberate edit:

```bash
base=$(git merge-base HEAD upstream/main)
git diff --name-only "$base" HEAD -- src/ ':(exclude)src/standalone/'
# -> src/core/metric-engine.ts
#    src/core/parser-codex.test.ts
#    src/webview/panel-request-service.ts
for f in src/core/metric-engine.ts src/core/parser-codex.test.ts src/webview/panel-request-service.ts; do
  echo "== $f =="; git log --oneline "$base"..HEAD -- "$f"
done
```

| File | Attribution | Remediation |
|---|---|---|
| `src/webview/panel-request-service.ts` | **Deliberate fork edit**, commit `e3be742` "fix(standalone): build install paths with path.join for Windows separator parity" (1 file, +2/-2). Correct, generically-useful Windows fix. | **Upstream it** (open a PR to microsoft/AI-Engineering-Coach). Do **not** revert — reverting reintroduces the mixed-separator bug that broke `service-writes.test.ts` on this Windows repo. |
| `src/core/metric-engine.ts` | Merge-resolution drift (`git log $base..HEAD` is **empty**) — behind upstream, not intentional. | **Re-merge** current upstream (or `git checkout upstream/main -- <file>`). |
| `src/core/parser-codex.test.ts` | Same — merge-resolution drift. | Same — re-merge. |

The webview files named only in the literal `upstream/main` diff (`panel.ts`, `page-burndown.ts`, `panel-sidebar.ts`) have an **empty** `$base..HEAD` log — they are behind/merge-resolved noise, **not** fork authorship. Do not touch them as "invariant breaches." After upstreaming the path.join fix and re-merging, the merge-base diff returns empty and the invariant holds. **There is no fork code sitting in the wrong directory** — the standalone strategy is structurally clean; the drift is incidental.

---

## 3. Preserving the additive-only invariant

### 3.1 The exact gate (merge-base, the only reliable baseline)

```bash
# AUTHORSHIP GATE — must be EMPTY
base=$(git merge-base HEAD upstream/main)
git diff --quiet "$base" HEAD -- src/ ':(exclude)src/standalone/' \
  || { echo "INVARIANT VIOLATED: fork-authored edits outside src/standalone/"; \
       git diff --name-only "$base" HEAD -- src/ ':(exclude)src/standalone/'; exit 1; }
```

**Why merge-base, not `upstream/main`:** gating on `git diff upstream/main -- src/ ':(exclude)src/standalone'` reports ~16 files (most of them behind-upstream noise) and mis-implicates `panel.ts`/`page-burndown.ts`/`panel-sidebar.ts`. The merge-base diff isolates *fork authorship* from *behind-upstream noise*. A noisy gate gets ignored.

### 3.2 Guard the override's preconditions

```bash
# core/constants must stay byte-identical (the FF override depends on it)
git diff --quiet upstream/main -- src/core/constants.ts || { echo "core/constants drifted"; exit 1; }

# the redirect must be wired and EXCLUSIVE to esbuild
test "$(git grep -c makeConstantsRedirectPlugin -- esbuild.mjs)" -ge 2 || exit 1
git grep -n 'standalone/standalone-constants' -- src/ ':(exclude)src/standalone/' && \
  { echo "core code references the shadow constants"; exit 1; }

# run the build — it is itself a parity gate (see below)
npm run build:standalone
```

### 3.3 How behavior changes WITHOUT editing core

This is the load-bearing pattern that makes the invariant possible:

- `src/core/constants.ts:127` = `FF_TOKEN_REPORTING_ENABLED = false` — **upstream value, never touched**.
- `src/standalone/standalone-constants.ts` (11 lines): `export * from '../core/constants'` then `export const FF_TOKEN_REPORTING_ENABLED = true` (the local export shadows the re-export).
- `esbuild.mjs:19-49` `makeConstantsRedirectPlugin`: `onResolve` filter `/constants$/` → if the resolved path equals `src/core/constants.ts`, return `{ path: standaloneConstants }`. Recursion guard at `esbuild.mjs:29` lets `standalone-constants.ts`'s own `export *` reach real core.
- Attached **only** to standalone bundles: `esbuild.mjs:191` (CLI `dist/standalone/cli.js`) and `:233` (standalone webview), plus watch-mode `:353`. The extension bundle (`:52`), workers, and the shared `dist/webview/app.js` (`:100`) get **no** plugin → stay FF=false. That is why webview source keeps `import { FF_TOKEN_REPORTING_ENABLED } from '../core/constants'` (`app.ts:24`, `page-burndown.ts:9`, `page-dashboard.ts:9`, `page-output.ts:9`, `panel-html.ts:8`, `panel-rpc.ts:41`) with zero core edits.
- **Self-defending:** `esbuild.mjs:38-45` `onEnd` throws `standalone-constants-redirect: 0 redirects` if the filter ever stops matching (e.g. upstream renames `constants.ts`). So `npm run build:standalone` fails loud instead of silently shipping FF=false — running the build *is* a parity gate, and a pure git-diff check would miss a constants rename.

**Any future fork behavior change uses this same seam:** add a standalone-only re-export + an `onResolve` redirect, never an edit to the shared file. The `vscode` alias (`esbuild.mjs:185-190` → `src/standalone/vscode-stub.ts`) is the analogous seam for VS Code APIs, scoped to the CLI entry only so the stub never leaks into the published extension.

### 3.4 Layered GitHub controls (defense-in-depth)

1. **Required status check** running the §3.1 + §3.2 gate — the primary programmatic guard; divergence cannot merge even with approvals. (`git diff --exit-code` is the canonical CI primitive.)
2. **CODEOWNERS** soft gate (human checkpoint that fits the reality that core files *do* change during sanctioned syncs):
   ```
   /src/             @JuliusGruber       # guardian on all core
   /src/standalone/  @fork-team          # last-match-wins re-assigns the added dir
   ```
   Combine with branch protection "Require review from Code Owners".
3. **Path restriction (rulesets)** only on paths you *never* touch — *not* a blanket `src/**`, which would also block legitimate sync merges (the same core files legitimately change when you pull upstream).
4. **Optional advisory `pre-commit` local hook** failing on staged paths outside `src/standalone/` — early warning only; bypassable with `--no-verify`, so CI stays authoritative.

---

## 4. Automated parity-gap detection

### 4.1 The canonical inputs

- **Upstream universe** = property keys of two interfaces in `src/core/types/rpc-types.ts`: `RpcMethodMap` (`rpc-types.ts:57-114`, read/registry methods) and `ExtensionMethodMap extends RpcMethodMap` (`rpc-types.ts:118-139`, the 21 extension-only methods `openExternal:119` … `loadModelBudgets:138`). So `keyof ExtensionMethodMap` (`ExtensionMethodName`, `rpc-types.ts:141`) **is** the full upstream surface. Read it at the upstream ref — `git show upstream/main:src/core/types/rpc-types.ts` — so fork edits don't pollute the universe.
- **Exposed set** = union of three tiers:
  - `V1_ALLOWED` `_inner` Set — `src/standalone/v1-allowed.ts:9-32` (52 read/registry keys).
  - `V1_SERVICE_ALLOWED` `_inner` Set — `src/standalone/v1-service-allowed.ts:10-17` (12 service/LLM keys).
  - `STANDALONE_NATIVE` Record keys — `src/standalone/standalone-native.ts:5-25` (exactly 1: `openExternal`).
  - The bridge adds **no** keys: `request-service-bridge.ts` `dispatchServiceMethod` (`:26-68`) is gated by `V1_SERVICE_ALLOWED`, not its own list. (Assert this still holds.)

### 4.2 Algorithm

```
STEP 0  refs   base = git merge-base HEAD upstream/main; head = git rev-parse upstream/main
STEP 1  universe   parse RpcMethodMap + ExtensionMethodMap keys from `git show upstream/main:.../rpc-types.ts`
                   (ts-morph AST, or regex /^\s*(\w+):\s*\{ params/ — every member matches that shape)
STEP 2  exposed    parse the Set string-literals (v1-allowed, v1-service-allowed) + Record keys (standalone-native); union
STEP 3  gap        gap = universe \ exposed \ humanExclusionList
STEP 4  tag FF     grep FF_TOKEN_REPORTING_ENABLED; assert esbuild onResolve redirect exists → tag flag-gated
STEP 5  tag vscode/write  static-grep each gap method's upstream handler for `vscode.` vs fs/write
STEP 6  tag deeplink   scan standalone-html.ts + upstream nav for routes with no nav <li>
STEP 7  degradations   grep src/webview/page-*.ts for each gap method's postMessage call site → (page, method, file:line)
STEP 8  bucket F    git diff --stat <base> HEAD -- src/ ':(exclude)src/standalone/' ; non-empty = merge debt
STEP 9  banner     write "Derived against <base>, re-verified against <head>"
```

### 4.3 What it computes mechanically (verified by hand against the files)

`52 + 12 + 1 = 65 exposed`. The raw `universe \ exposed` residual is exactly:

```
reviewLocalRules   (rpc-types.ts:96   — in RpcMethodMap, absent from all 3 tiers)
calibrateRule      (rpc-types.ts:107  — deferred per v1-allowed.ts:7)
runRuleTests       (rpc-types.ts:108  — deferred per v1-allowed.ts:7)
createSkill        (rpc-types.ts:120  — opens VS Code chat, not an LLM call)
getWorkspaceDeps   (rpc-types.ts:133)
getSdlcToolAnalysis(rpc-types.ts:134)
getSdlcRepoScan    (rpc-types.ts:135)
getSdlcGitHubData  (rpc-types.ts:136)
saveModelBudgets   (rpc-types.ts:137)
loadModelBudgets   (rpc-types.ts:138)
```

**Regression assertions** (count the Set *literally*, never trust the header comment): `V1_ALLOWED.size == 52`, `V1_SERVICE_ALLOWED.size == 12`, `keys(STANDALONE_NATIVE) == 1`, `exposed == 65`.

### 4.4 The two pitfalls the naive diff must correct

- **Over-reports forward-only entries.** `importRegistryRules` is allowlisted (`v1-allowed.ts:31`) but has no standalone UI caller — and `calibrateRule`/`runRuleTests` are off-allowlist but the doc deliberately omits them (no shipped page reaches them, `v1-allowed.ts:7`). → needs a **reachable-from-a-shipped-page filter** or an explicit ignore list.
- **Under-reports called-but-unallowlisted degradations.** `saveModelBudgets`/`getWorkspaceDeps` are *called* by shipped pages yet not allowlisted, so they degrade silently → the STEP 7 call-site cross-reference (the "Per-method degradations" table) catches these. Also note **allowlisted ≠ working** and **type-map membership ≠ runtime handler** (`panel-rpc.ts` / `panel-request-service.ts` are the implemented surface; reconcile both).

### 4.5 What stays human

Bucket A–F assignment, difficulty/severity tags (`Med`/`Hard`/`HIGH`), portability (shimmable vs fundamentally vscode-only), the scope-exclusion list (`src/chat/*`, `src/mcp/*`, devcontainer/CI/CSP), and all Effect/Priority prose. The skill **proposes** buckets from the auto-signals; a human finalizes. **Bucket F (merge debt) is invisible to the allowlist diff** — it needs the STEP 8 git diff vs merge-base. Run **both** derivations.

### 4.6 Regenerating the doc

Render gap list + auto-tags + degradations table + staleness banner; leave bucket-letter, difficulty, and Effect/Priority as `TODO` placeholders. **Staleness trigger:** the doc's baseline is `abc0a6c`, **67 commits behind** `upstreamHead 3a41450`; if `git rev-parse upstream/main` ≠ the doc's derived SHA, regenerate. Always read `rpc-types.ts` from `git show upstream/main:` so the fork's own additive edits don't fold into the universe.

---

## 5. The skill design

Project skill, committed to the fork so it is versioned next to the code it guards and the team gets it. Directory name == frontmatter name. Follows progressive disclosure (only `name`+`description` preloaded; body loads on trigger; references one level deep).

```
.claude/skills/merging-upstream/
├── SKILL.md
├── reference.md            # the additive-only invariant in detail (TOC if >100 lines)
├── report-template.md      # the parity-gap report format (preserve bucket A–F structure)
└── scripts/                # low-freedom, run-exactly, forward-slash paths
    ├── fetch-upstream.sh
    ├── drift-gate.sh       # §3.1 + §3.2 merge-base authorship gate
    ├── parity-gap.mjs      # §4 algorithm → regenerates STANDALONE-PARITY-GAPS.md
    └── guarded-merge.sh    # plan-validate-execute; ABORTs loud, never pushes
```

### 5.1 Frontmatter

```yaml
---
name: merging-upstream
description: >-
  Fetches upstream, computes the additive-only drift gate against src/standalone,
  regenerates the parity-gap report, and performs a guarded merge of upstream/main.
  Use when syncing the fork with upstream, checking parity gaps, merging upstream/main,
  or regenerating STANDALONE-PARITY-GAPS. Triggers: "sync upstream", "parity gaps",
  "merge upstream/main", "check what features the fork is missing".
---
```

(Third person; states both *what* and *when*; packs the exact phrases the user says, since discovery depends almost entirely on this field. Gerund name. Lowercase/hyphens, ≤64 chars.)

### 5.2 SKILL.md body — ordered checklist (plan-validate-execute)

```
1. PRECONDITION   Run scripts/fetch-upstream.sh. Assert upstream/main resolves; record base + head.
2. DRIFT GATE     Run scripts/drift-gate.sh. If non-empty, classify each path:
                  - named in `git log base..HEAD -- <path>` → deliberate edit → propose "upstream it"
                  - empty log → merge-resolution drift → propose "re-merge"
                  NEVER auto-revert (panel-request-service.ts carries a correct Windows fix).
3. PARITY GAP     Run scripts/parity-gap.mjs. Read its output (gap list + auto-tags + degradations).
4. DRAFT REPORT   Regenerate docs-fork/STANDALONE-PARITY-GAPS.md from report-template.md.
                  Preserve existing bucket A–F structure; leave bucket/difficulty/Effect as TODO.
                  Newly-appeared upstream methods (diff vs previous run) get an explicit
                  "allowlist decision needed" flag.
5. ASK            Present the drift classification + gap delta. STOP and ask before merging.
6. GUARDED MERGE  On approval, run scripts/guarded-merge.sh on a NEW branch sync/upstream-<date>.
                  It validates the plan (no non-standalone changes introduced by the merge that
                  weren't already upstream) BEFORE committing, runs `npm run build:standalone`
                  (the FF-redirect self-guard), and ABORTs loud on conflict or gate failure.
7. VERIFY         Re-run scripts/drift-gate.sh; confirm empty. Report branch name. DO NOT push.
```

Each script is marked **"Run this"** (execute, not read). `guarded-merge.sh` must **solve, don't punt**: explicit verbose failures (`ABORT: merge would modify non-standalone path(s): <list>`), commented constants (no voodoo values), forward-slash paths even though the repo is on Windows/PowerShell.

### 5.3 Degrees of freedom

- **Low freedom (scripts, run exactly):** the deterministic, dangerous git plumbing — fetch, merge-base diff, set-difference, the build self-guard. Only output enters context, not the script body (token-cheap, consistent).
- **High freedom (inline prose, judgement):** drift classification (upstream-it vs re-merge), parity bucketing (A/B/D), the report narrative, conflict triage.

### 5.4 Safety properties

- **Never auto-pushes** (step 7 stops at a local branch; the human runs `git push -u origin sync/...` + opens the PR).
- **Never merges onto `main`** directly — always a `sync/upstream-<date>` branch.
- **Never auto-reverts** the legit `path.join` fix (`e3be742`); it proposes upstreaming it.
- **Surfaces conflicts** rather than auto-favoring a side (except a generated/lock file inside `src/standalone/`).
- **Build-as-gate:** runs `npm run build:standalone` so a constants rename that slips past pure git-diff is caught by the `onEnd` 0-redirect throw (`esbuild.mjs:38-45`).
- **Tooling caveat for the script author:** build automation on `git show <ref>:path` and `git diff` plumbing, not on reading the working tree.

---

## 6. Routine playbook (human, each upstream change)

```bash
# 0. one-time (idempotent)
git config --global rerere.enabled true
git remote get-url upstream || git remote add upstream https://github.com/microsoft/AI-Engineering-Coach.git

# 1. fetch + see what's missing
git fetch upstream
git log HEAD..upstream/main --oneline                       # commits you don't have
git log HEAD..upstream/main --oneline -- src/ ':(exclude)src/standalone/'   # touching shared core

# 2. invoke the skill (or run scripts by hand)
/merging-upstream

# 3. review the regenerated docs-fork/STANDALONE-PARITY-GAPS.md
#    - fill TODO buckets/difficulty for any NEW gap methods
#    - decide allowlist add vs defer for newly-appeared upstream methods

# 4. on a sync branch (the skill made it): resolve conflicts, leaning on rerere
git diff --check && git merge --continue

# 5. invariant must hold
base=$(git merge-base HEAD upstream/main)
git diff --quiet "$base" HEAD -- src/ ':(exclude)src/standalone/' && echo "INVARIANT OK"
npm run build:standalone                                     # FF-redirect self-guard must pass

# 6. publish (human does this — skill never pushes)
git push -u origin sync/upstream-$(date +%Y%m%d)
gh pr create --base main --fill

# 7. if a fork edit outside src/standalone is generically useful (e.g. the path.join fix):
#    open a PR to microsoft/AI-Engineering-Coach to retire the drift permanently.
```

---

## 7. References

**Sync mechanics (merge / rebase / rerere / strategies)**
- https://git-scm.com/docs/merge-strategies — `-X ours`/`-X theirs` options vs the `-s ours` strategy
- https://git-scm.com/book/en/v2/Git-Tools-Rerere — reuse recorded resolution; long-lived-branch use case
- https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/syncing-a-fork — merge as the default sync; baseline `git log HEAD..upstream/main`
- https://git-scm.com/docs/git-subtree — why subtree is the wrong topology here

**Drift enforcement (CI gate / GitHub controls)**
- https://git-scm.com/docs/git-diff — `--exit-code` / `--quiet`, path scoping (the CI primitive)
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets — Restrict file paths (push) + required status checks; layering
- https://docs.github.com/articles/about-code-owners — path-based review gate, last-match-wins carve-outs
- https://github.com/pre-commit/pre-commit-hooks — local advisory guard hooks

**Feature-gap detection (snapshot/diff patterns)**
- https://api-extractor.com/ — Microsoft API Extractor `.api.md` report (directly applicable to this TS fork)
- https://github.com/cargo-public-api/cargo-public-api — sorted-surface snapshot + Added/Removed diff pattern
- https://github.com/oasdiff/oasdiff — "contract file as source of truth" diffing
- https://github.com/siom79/japicmp — Removed-in-fork = missing-feature signal (conceptual template)
- https://difftastic.wilfred.me.uk/ — structural/AST diff as a second-pass noise filter on shared core
- https://graphite.dev/guides/how-to-maintain-fork — `git log HEAD..upstream/main` as a scheduled missing-feature report

**Skill authoring (Claude Code)**
- https://code.claude.com/docs/en/skills — project skill at `.claude/skills/<name>/SKILL.md`; commands merged into skills
- https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices — description as discovery signal, progressive disclosure, degrees-of-freedom, plan-validate-execute, "solve don't punt", forward-slash paths
