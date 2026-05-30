# merging-upstream — reference

The additive-only invariant, the build-seam override pattern, and the parity-gap
algorithm in full. SKILL.md is the workflow; this is the "why it's safe" detail.

## Contents

1. [The additive-only invariant](#1-the-additive-only-invariant)
2. [The exact drift gate](#2-the-exact-drift-gate)
3. [Behavior change WITHOUT editing core (the build seam)](#3-behavior-change-without-editing-core-the-build-seam)
4. [Remediating already-drifted files](#4-remediating-already-drifted-files)
5. [Parity-gap algorithm](#5-parity-gap-algorithm)
6. [Layered GitHub controls (defense-in-depth)](#6-layered-github-controls-defense-in-depth)

---

## 1. The additive-only invariant

The fork = **upstream tree at the repo root + one added directory `src/standalone/`**.
Nothing fork-authored lives outside `src/standalone/`. That structural fact is what makes
each sync a plain `git merge upstream/main` (never rebase — `main` is published; never
subtree — wrong topology; never `-s ours` — it silently drops upstream changes). The
`upstream/main` remote-tracking ref *is* the pristine vendor line; `origin/main` is the
customized line that merges from it. No separate vendor branch needed.

## 2. The exact drift gate

```bash
# AUTHORSHIP GATE — must be EMPTY
base=$(git merge-base HEAD upstream/main)
git diff --quiet "$base" HEAD -- src/ ':(exclude)src/standalone/' \
  || echo "INVARIANT VIOLATED: fork-authored edits outside src/standalone/"
```

**Why merge-base, not `upstream/main`:** gating on `git diff upstream/main` reports ~16
files (mostly behind-upstream noise) and mis-implicates `panel.ts` / `page-burndown.ts` /
`panel-sidebar.ts`, whose `$base..HEAD` log is empty — they are merge-resolution noise, not
fork authorship. The merge-base diff isolates fork authorship from behind-upstream noise.
**A noisy gate gets ignored.**

Classification, per path in the gate output:
- **named in `git log $base..HEAD -- <path>`** → deliberate fork edit in shared `src/`. It
  **violates the invariant**; remediate (move behind a build seam / upstream it / revert to
  upstream). Surface the choice — never *silently* auto-revert a real fix.
- **empty `$base..HEAD` log** → merge-resolution drift → re-merge /
  `git checkout upstream/main -- <path>`.

### Override preconditions (hard — `drift-gate.sh` enforces)

```bash
git diff --quiet upstream/main -- src/core/constants.ts        # must be byte-identical
git grep -c makeConstantsRedirectPlugin -- esbuild.mjs          # must be >= 2 (redirect wired)
git grep -n 'standalone/standalone-constants' -- src/ ':(exclude)src/standalone/'  # must be EMPTY
```

## 3. Behavior change WITHOUT editing core (the build seam)

This is the load-bearing pattern that makes the invariant possible. To flip
`FF_TOKEN_REPORTING_ENABLED` on for standalone builds only:

- `src/core/constants.ts` → `FF_TOKEN_REPORTING_ENABLED = false` — **upstream value, never touched.**
- `src/standalone/standalone-constants.ts` (~11 lines): `export * from '../core/constants'`
  then `export const FF_TOKEN_REPORTING_ENABLED = true` (the local export shadows the re-export).
- `esbuild.mjs` `makeConstantsRedirectPlugin`: an `onResolve` filter `/constants$/` returns
  the standalone path when the resolved file is `src/core/constants.ts`. A recursion guard
  lets `standalone-constants.ts`'s own `export *` reach real core.
- Attached **only** to standalone bundles (CLI + standalone webview + watch mode). The
  extension bundle, workers, and the shared `dist/webview/app.js` get **no** plugin → stay
  FF=false. That is why webview source keeps
  `import { FF_TOKEN_REPORTING_ENABLED } from '../core/constants'` with zero core edits.
- **Self-defending:** an `onEnd` hook throws `standalone-constants-redirect: 0 redirects` if
  the filter ever stops matching (e.g. upstream renames `constants.ts`). So
  `npm run build:standalone` fails loud instead of silently shipping FF=false — **running
  the build is itself a parity gate** a pure git-diff would miss.

**Any future fork behavior change uses this same seam:** a standalone-only re-export + an
`onResolve` redirect — never an edit to the shared file. The `vscode` alias
(esbuild → `src/standalone/vscode-stub.ts`, scoped to the CLI entry) is the analogous seam
for VS Code APIs, so the stub never leaks into the published extension.

## 4. Remediating drift outside `src/standalone/`

The naive `git diff upstream/main -- src/` over-reports. The **merge-base** diff is the truth.
The invariant is **zero** fork-authored drift in shared `src/`, and the fork currently carries
none. If `drift-gate.sh` ever flags a path:
- **deliberate** (named in `git log $base..HEAD -- <path>`) → it violates the invariant.
  Remediate: a behavior override goes behind a build seam (§3); a portable bug fix is upstreamed
  (PR to `microsoft/AI-Engineering-Coach`); otherwise revert to upstream and accept upstream's
  behavior locally. Surface the choice — never *silently* revert a real fix.
- **merge-resolution drift** (empty `$base..HEAD` log) → re-merge / `git checkout upstream/main -- <path>`.

`drift-gate.sh` classifies each live — trust its output over any snapshot in prose (the live
state moves). `land` refuses to advance `main` while any drift remains.

## 5. Parity-gap algorithm

`parity-gap.mjs` computes `gap = universe \ exposed`.

- **universe** = `keyof ExtensionMethodMap` (which `extends RpcMethodMap`), parsed from
  `git show upstream/main:src/core/types/rpc-types.ts` — read at the **upstream ref** so the
  fork's own additive edits never fold into the universe. Every member matches
  `/^\s+(\w+):\s*\{\s*params/` after comments are stripped.
- **exposed** = `V1_ALLOWED` (`src/standalone/v1-allowed.ts`) ∪ `V1_SERVICE_ALLOWED`
  (`v1-service-allowed.ts`) ∪ keys of `STANDALONE_NATIVE` (`standalone-native.ts`), all read
  at HEAD. The service-bridge adds **no** keys (it is gated by `V1_SERVICE_ALLOWED`).
- **Comment-strip before extracting literals** — `v1-allowed.ts` contains
  `require('vscode')` and method names *in comments*; without stripping, `vscode` leaks into
  the count and inflates it. The recorded baseline (`52 / 12 / 1 / 65`) is the regression
  assertion that proves the parser counted the Set *literally*, not the header comment.
- **Two pitfalls the naive diff must correct:**
  - *Over-reports forward-only entries* — e.g. `importRegistryRules` is allowlisted but has
    no standalone UI caller; `calibrateRule` / `runRuleTests` are off-allowlist and
    deliberately omitted (no shipped page reaches them). → a reachable-from-a-shipped-page
    filter or explicit ignore list.
  - *Under-reports called-but-unallowlisted degradations* — `saveModelBudgets` /
    `getWorkspaceDeps` are *called* by shipped pages yet not allowlisted, so they degrade
    silently. → the call-site cross-reference (the degradations table) catches these.
- **What stays human:** feature-bucket assignment, difficulty/severity, portability
  (shimmable vs vscode-only), the scope-exclusion list, and all Effect/Priority prose. New
  **non-RPC** upstream functionality is invisible to the allowlist diff — catch it with a
  **features-only** scan of `git diff <base> upstream/main` (exclude bug fixes, refactors,
  dep bumps, tests, infra, VS Code-only surfaces) and **append it as a new lettered bucket**.
  The bucket list is an **append-only ledger**: never renumber or delete a bucket; one bucket
  per feature; an implemented bucket is marked `SHIPPED (<date>)` **in place** by the
  implementing agent. **Never a "merge debt" bucket** — how far behind upstream the fork is,
  is a *sync status* (`fetch-upstream.sh` / `drift-gate.sh`), not a parity gap. The script
  **proposes** from auto-signals; a human finalizes.
- **Staleness:** the script banners `derived <base> → re-verified <upstream_head>, <n> behind`.
  If `git rev-parse upstream/main` ≠ the doc's derived SHA, regenerate.

## 6. Layered GitHub controls (defense-in-depth)

1. **Required status check** running the §2 gate — divergence cannot merge even with
   approvals (`git diff --exit-code` is the CI primitive).
2. **CODEOWNERS** soft gate (human checkpoint that fits the reality that core files *do*
   change during sanctioned syncs):
   ```
   /src/             @JuliusGruber       # guardian on all core
   /src/standalone/  @fork-team          # last-match-wins re-assigns the added dir
   ```
   Combine with branch protection "Require review from Code Owners".
3. **Path restriction (rulesets)** only on paths you *never* touch — *not* a blanket
   `src/**`, which would also block legitimate sync merges.
4. **Optional advisory `pre-commit` hook** failing on staged paths outside `src/standalone/`
   — early warning only; bypassable, so CI stays authoritative.
