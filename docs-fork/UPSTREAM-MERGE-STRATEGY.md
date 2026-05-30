# Continuous Upstream Sync for an Additive-Only Fork: Strategy + Skill Design

> Originally derived 2026-05-30 against `upstream/main` = `3a41450` from a
> codebase-grounded + web-researched, adversarially-verified workflow.
> **Reconciled 2026-05-30 to the live `merging-upstream` skill**, which evolved past the
> original design in three ways — all reflected below: (1) the fork carries **zero** drift —
> the former `44e9532` core edits were reverted (commit `adcb185`); (2) the skill **lands on
> local `main`** by fast-forward, it does not push or open a PR; (3) the parity report is an
> **append-only feature-bucket ledger** with **no "merge debt" bucket**. HEAD is now `0` behind
> (merge-base == `upstream/main`). The live source of truth is the skill at
> `.claude/skills/merging-upstream/`; this doc is the rationale.

## 1. TL;DR

- **Use plain `git merge upstream/main`** (never rebase, subtree, or `-s ours`). The fork's shape — upstream tree at the repo root plus one added directory `src/standalone/` — makes merge the only mechanism that keeps `git diff upstream/main` meaningful and conflict-free. The `upstream/main` remote-tracking ref *is* your vendor branch for free.
- **Enforce the invariant against the merge-base, not `upstream/main`.** The reliable authorship gate is `git diff --name-only $(git merge-base HEAD upstream/main) HEAD -- src/ ':(exclude)src/standalone/'` — it must be empty. Gating on `upstream/main` directly reports ~16 false positives (behind-upstream noise).
- **Behavior overrides live in the build, not in core.** `esbuild.mjs:19-49` redirects `core/constants` → `src/standalone/standalone-constants.ts` to flip `FF_TOKEN_REPORTING_ENABLED` for standalone bundles only, so `src/core/constants.ts:127` stays byte-identical to upstream. Any future override follows this pattern — never edit core.
- **Parity gaps are a set-difference + four secondary signals.** `unexposed = keyof ExtensionMethodMap \ (V1_ALLOWED ∪ V1_SERVICE_ALLOWED ∪ keys(STANDALONE_NATIVE))`, then layer FF-gate / call-site / deep-link / write-path tags. The mechanical diff regenerates the bulk of `docs-fork/STANDALONE-PARITY-GAPS.md`; bucketing/difficulty stay human.
- **Ship one project skill `merging-upstream`** with low-freedom helper scripts for the dangerous git plumbing and high-freedom prose for triage. It **never pushes** and **never auto-merges onto `main`** (it lands on a `sync/upstream-<date>` branch; `main` advances only via an explicit, separately-approved fast-forward `land`, never a push or PR), **never *silently* reverts** a fork edit, and surfaces conflicts for a human. The fork carries **zero** drift outside `src/standalone/`.

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
git rev-parse --verify upstream/main          # = 3a41450; HEAD now 0 behind (merge-base == upstream/main)

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

### 2.4 Drift outside `src/standalone/` — currently zero

The invariant is **zero** fork-authored drift in shared `src/`, and the fork carries none — the
merge-base diff is empty:

```bash
base=$(git merge-base HEAD upstream/main)
git diff --name-only "$base" HEAD -- src/ ':(exclude)src/standalone/'   # -> (empty)
```

The two edits this section once tracked — `src/core/metric-engine.ts` (`toLocaleString('en-US')`
locale pin) and `src/core/parser-codex.test.ts` (120s `>MAX_FILE_SIZE` timeout), both commit
`44e9532` — were **reverted byte-identical to upstream** (commit `adcb185`) to make the invariant
absolute. The accepted cost: `metric-engine.test.ts:435` goes red on non-en-US locales (this
machine's Node formats `1234` as `1 234`, not `1,234`) and the codex large-file test can time out
on Windows/slow disks. Those are **upstream test-robustness gaps to PR upstream**, not fork-carried
edits.

**If `drift-gate.sh` ever flags a path again**, remediate before landing — never carry it:

| Classification | Signal | Remediation |
|---|---|---|
| **Deliberate** | named in `git log $base..HEAD -- <path>` | a behavior override goes behind the build seam (§3.3); a portable bug fix is upstreamed (PR to microsoft/AI-Engineering-Coach); otherwise revert to upstream and accept upstream's behavior locally. Surface the choice — never *silently* revert a real fix. |
| **Merge-resolution noise** | empty `$base..HEAD` log | re-merge / `git checkout upstream/main -- <path>`; not an authorship breach. The webview files that show up only in the naive `git diff upstream/main` (`panel.ts`, `page-burndown.ts`, `panel-sidebar.ts`) are this — behind/merge-resolved noise, not fork authorship. |

**There is no fork code sitting in the wrong directory** — the standalone strategy is structurally
clean, and `guarded-merge.sh land` refuses to advance `main` while any drift remains (drift-gate
exit 1 *or* 2).

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
STEP 8  drift gate  git diff --stat <base> HEAD -- src/ ':(exclude)src/standalone/' ; MUST be empty (sync status, never a parity bucket)
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

Bucket assignment (the ledger is **append-only** — A–E today; a new lettered bucket per newly-surfaced upstream **feature**, never renumbered or deleted, marked `SHIPPED` in place when implemented), difficulty/severity tags (`Med`/`Hard`/`HIGH`), portability (shimmable vs fundamentally vscode-only), the scope-exclusion list (`src/chat/*`, `src/mcp/*`, devcontainer/CI/CSP), and all Effect/Priority prose. The skill **proposes** buckets from the auto-signals; a human finalizes. **There is no "merge debt" bucket** — how far behind `upstream/main` the fork is, is a *sync status* (the STEP 8 drift gate, which must be empty, + `fetch-upstream.sh`'s behind count), never a parity gap. Genuinely **new non-RPC** upstream functionality (invisible to the allowlist diff) is caught by a features-only scan of `git diff <base> upstream/main` — excluding bug fixes, refactors, dep bumps, tests, infra, VS Code-only surfaces — and appended as a new bucket.

### 4.6 Regenerating the doc

Render gap list + auto-tags + degradations table + staleness banner; leave bucket-letter, difficulty, and Effect/Priority as `TODO` placeholders. **Staleness trigger:** the live parity doc is derived against the current `upstream/main` (now `3a41450`, HEAD `0` behind, merge-base == `upstream/main`); if `git rev-parse upstream/main` ≠ the doc's derived SHA, regenerate. Always read `rpc-types.ts` from `git show upstream/main:` so the fork's own additive edits don't fold into the universe.

---

## 5. The skill design

Project skill, committed to the fork so it is versioned next to the code it guards and the team gets it. Directory name == frontmatter name. Follows progressive disclosure (only `name`+`description` preloaded; body loads on trigger; references one level deep).

```
.claude/skills/merging-upstream/
├── SKILL.md
├── reference.md            # the additive-only invariant in detail (TOC if >100 lines)
├── report-template.md      # the parity-gap report format (append-only bucket ledger)
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
  Use when syncing this fork with upstream, merging upstream/main, checking
  standalone parity gaps, regenerating STANDALONE-PARITY-GAPS, or auditing whether
  fork-authored edits have leaked outside src/standalone/. Triggers: "sync upstream",
  "merge upstream/main", "parity gaps", "what features is the fork missing",
  "check the additive-only invariant", "drift gate".
---
```

(Third person; states both *what* and *when*; packs the exact phrases the user says, since discovery depends almost entirely on this field. Gerund name. Lowercase/hyphens, ≤64 chars.)

### 5.2 SKILL.md body — ordered checklist (plan-validate-execute)

```
1. PRECONDITION   Run scripts/fetch-upstream.sh. Assert upstream/main resolves; record base + head + behind.
2. DRIFT GATE     Run scripts/drift-gate.sh. Must be clean (exit 0). If it flags a path:
                  - named in `git log base..HEAD -- <path>` → deliberate edit → VIOLATES the
                    invariant; remediate (build seam / upstream-it / revert), never carry it.
                  - empty log → merge-resolution drift → re-merge / checkout upstream.
                  Surface the choice; NEVER silently auto-revert a real fix.
3. PARITY GAP     Run scripts/parity-gap.mjs. Read its output (gap list + auto-tags + degradations).
4. DRAFT REPORT   Regenerate docs-fork/STANDALONE-PARITY-GAPS.md from report-template.md.
                  Bucket ledger is append-only (A–E today; one new lettered bucket per surfaced
                  feature; NO merge-debt bucket); leave bucket/difficulty/Effect as TODO.
                  Newly-appeared upstream methods get an explicit "allowlist decision needed" flag.
5. ASK            Present the drift classification + gap delta. STOP and ask before merging.
6. GUARDED MERGE  On approval, run scripts/guarded-merge.sh execute. It creates sync/upstream-<date>,
                  merges --no-commit, keeps the fork's README (KEEP_FROM_FORK), runs
                  `npm run build:standalone` (the FF-redirect self-guard), ABORTs loud on conflict
                  or gate failure, and commits only if the gate passes.
7. VERIFY         Re-run scripts/drift-gate.sh; confirm exit 0. Report the branch; ask the human to
                  review it (git log/diff main..<branch>). DO NOT push. Offer the land follow-up.
8. LAND           On explicit approval, run scripts/guarded-merge.sh land <branch>. It re-checks the
                  drift gate (blocks on exit 1 AND exit 2) and FAST-FORWARDS LOCAL main (--ff-only).
                  Never pushes; never opens a PR. The sync branch is kept as an audit trail.
```

Each script is marked **"Run this"** (execute, not read). `guarded-merge.sh` must **solve, don't punt**: explicit verbose failures (`ABORT: merge would modify non-standalone path(s): <list>`), commented constants (no voodoo values), forward-slash paths even though the repo is on Windows/PowerShell.

### 5.3 Degrees of freedom

- **Low freedom (scripts, run exactly):** the deterministic, dangerous git plumbing — fetch, merge-base diff, set-difference, the build self-guard. Only output enters context, not the script body (token-cheap, consistent).
- **High freedom (inline prose, judgement):** drift classification (upstream-it vs re-merge), parity bucketing (A/B/D), the report narrative, conflict triage.

### 5.4 Safety properties

- **Never pushes** — every step stays local; nothing is published to a remote.
- **Never *auto*-merges onto `main`** — `execute` only ever lands on a `sync/upstream-<date>` branch; `main` advances solely through the explicit, separately-approved `land` step, and only by fast-forward (`--ff-only`). No push, no PR.
- **Never *silently* reverts** a fork edit — it surfaces drift outside `src/standalone/` and the remediation choice (build seam / upstream-it / revert) for the human. The fork currently carries zero drift; `land` refuses to advance `main` while any remains (drift-gate exit 1 *or* 2).
- **Never syncs `README.md`** — the fork's README is always kept and upstream's discarded (the `KEEP_FROM_FORK` pin); README is outside the `src/` gate, so this never affects the invariant.
- **Surfaces conflicts** rather than auto-favoring a side (except a generated/lock file).
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

# 5. invariant must hold (exit 0)
base=$(git merge-base HEAD upstream/main)
git diff --quiet "$base" HEAD -- src/ ':(exclude)src/standalone/' && echo "INVARIANT OK"
npm run build:standalone                                     # FF-redirect self-guard must pass

# 6. review the sync branch, then LAND on LOCAL main (skill never pushes, never opens a PR)
git log main..sync/upstream-$(date +%Y%m%d) --oneline        # what would land
bash .claude/skills/merging-upstream/scripts/guarded-merge.sh land sync/upstream-$(date +%Y%m%d)
#    -> re-gates (blocks on drift, exit 1 or 2), fast-forwards LOCAL main (--ff-only),
#       keeps the sync branch as an audit trail. Nothing is pushed.

# 7. if drift outside src/standalone is ever needed as a behavior change, it goes behind the
#    build seam (§3.3) — never a shared-core edit. A portable bug fix is PR'd to upstream.
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
