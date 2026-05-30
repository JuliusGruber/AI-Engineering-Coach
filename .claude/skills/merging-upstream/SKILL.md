---
name: merging-upstream
description: >-
  Use when syncing this fork with upstream, merging upstream/main, checking
  standalone parity gaps, regenerating STANDALONE-PARITY-GAPS, or auditing whether
  fork-authored edits have leaked outside src/standalone/. Triggers: "sync upstream",
  "merge upstream/main", "parity gaps", "what features is the fork missing",
  "check the additive-only invariant", "drift gate".
---

# Merging Upstream

## Overview

This repo is an **additive-only fork** of `microsoft/AI-Engineering-Coach`: upstream's
tree sits at the repo root, and all fork code lives in **one added directory** —
`src/standalone/`. Keeping that shape is what makes `git diff upstream/main` meaningful
and every upstream sync a conflict-light `git merge`.

**Core principle: behavior overrides live in the build, never in core.** `esbuild.mjs`
redirects `core/constants` → `src/standalone/standalone-constants.ts` for standalone
bundles only, so `src/core/constants.ts` stays byte-identical to upstream. Any future
override uses the same seam — you never edit a shared file. See `reference.md`.

**The one rule:** `git diff $(git merge-base HEAD upstream/main) HEAD -- src/ ':(exclude)src/standalone/'`
must be empty. Gate against the **merge-base**, not `upstream/main` (the latter reports
~16 behind-upstream false positives and gets ignored).

## When to use

- Syncing the fork: "merge upstream/main", "pull upstream", "sync the fork".
- Parity: "what features is the fork missing", "regenerate the parity gaps", "parity gaps".
- Auditing the invariant: "did anything leak outside src/standalone", "drift gate".

Not for: ordinary feature work inside `src/standalone/` (that's just normal development),
or pushing/opening PRs — this skill never touches a remote. It ends at a reviewed local
`sync/upstream-<date>` branch and, on your explicit approval, fast-forwards your *local* `main`.

## Workflow (plan → validate → execute → review → land)

Run the scripts — **execute them, do not read them**; only their stdout enters context.
Run everything from the repo root.

1. **PRECONDITION** — Run `bash .claude/skills/merging-upstream/scripts/fetch-upstream.sh`.
   Confirms `upstream/main` resolves; prints `merge_base` / `upstream_head` / `behind`.

2. **DRIFT GATE** — Run `bash .claude/skills/merging-upstream/scripts/drift-gate.sh`.
   It classifies every path outside `src/standalone/`:
   - `DELIBERATE` (named in `git log base..HEAD`) → a fork commit edited shared `src/`. This
     **violates the additive-only invariant** and must be remediated before landing: move the
     behavior behind a `src/standalone/` build seam, **upstream it** (PR to
     microsoft/AI-Engineering-Coach), or revert it to upstream and accept upstream's behavior
     locally. Surface the choice to the human — **never *silently* auto-revert** a real fix.
     The fork currently carries **zero** such edits; keep it that way.
   - `MERGE-DRIFT` (empty `base..HEAD` log) → propose **re-merge** /
     `git checkout upstream/main -- <file>`.
   A `PRECONDITION BREACH` (exit 1) is hard — fix before merging.

3. **PARITY GAP** — Run `node .claude/skills/merging-upstream/scripts/parity-gap.mjs`.
   Reads its output: counts (regression assertions), the `universe \ exposed` gap list,
   shipped-page degradation call sites, and any methods upstream added since the base
   ("allowlist decision needed").

4. **DRAFT REPORT** — Regenerate `docs-fork/STANDALONE-PARITY-GAPS.md` from
   `report-template.md`, filling the auto sections from step 3's output. The report tracks
   **functional parity only** — upstream functionality not exposed/implemented in
   `src/standalone/`. **Preserve every existing bucket** (the ledger is append-only — A–E
   today, more as merges surface features); leave bucket-letter / difficulty / Effect /
   Priority as `TODO` for a human. Flag newly-appeared upstream methods
   explicitly. **Never add a "merge debt" / "fork is behind upstream" bucket** — being behind
   is a *sync status* (step 1's `behind` count, step 2's drift gate), not a parity gap. When
   upstream is ahead, scan the delta (`git diff <merge-base> upstream/main`) for genuinely
   **new functionality** — features only, **excluding** bug fixes, refactors, dep bumps,
   tests, infra, and VS Code-only surfaces — and, for each new feature `src/standalone/`
   doesn't implement, **append a new lettered bucket**. The bucket list is an **append-only
   ledger**: never renumber or delete a bucket; one bucket per feature; an implemented bucket
   is marked `SHIPPED (<date>)` **in place** by the implementing agent, never removed.

5. **ASK** — Present the drift classification + the gap delta. **STOP and ask the human
   before merging.** Preview with
   `bash .claude/skills/merging-upstream/scripts/guarded-merge.sh plan` (mutates nothing).

6. **GUARDED MERGE** — On approval, run
   `bash .claude/skills/merging-upstream/scripts/guarded-merge.sh execute`. It creates a
   fresh `sync/upstream-<date>` branch, merges `--no-commit`, surfaces conflicts (never
   auto-resolves), runs `npm run build:standalone` (the FF-redirect self-guard), and
   commits only if the gate passes. It **keeps the fork's `README.md`** — upstream's README
   is always discarded, never synced (the `KEEP_FROM_FORK` pin in `guarded-merge.sh`). It
   **ABORTs loud** on any failure and **never pushes**.

7. **VERIFY & HAND BACK FOR REVIEW** — Re-run `drift-gate.sh`. Report the
   `sync/upstream-<date>` branch name and **ask the human to review it** before anything lands —
   point them at `git log main..<branch>` and `git diff main..<branch>`. **Never push.** Then
   **offer the follow-up explicitly**: *"Want me to merge this onto your local `main`?"*

8. **LAND (only on explicit approval)** — When the human approves, run
   `bash .claude/skills/merging-upstream/scripts/guarded-merge.sh land <branch>`. It requires a
   clean tree, re-checks the drift gate (blocking on **any** drift it finds — a **HARD
   precondition breach** *or* fork-authored drift outside `src/standalone/`; the additive-only
   invariant requires **zero** drift before `main` moves), and **fast-forwards
   LOCAL `main`** onto the reviewed branch (`--ff-only`: it refuses, never force-merges, if
   `main` has moved). It **never pushes**. The sync branch is kept as an audit trail until the
   human deletes it (`git branch -d <branch>`).

## Conflict policy (do not auto-favor a side)

- Conflict **inside `src/standalone/`** → resolve manually (your code vs an upstream
  rename/signature change — the signal you want).
- Conflict in a **generated/lock-style file** upstream also touches → `-X theirs`/`-X ours`
  for **that one path** only. Never blanket-apply.
- Conflict in **any other core file** → resolve toward upstream, then re-run `drift-gate.sh`
  to confirm the file ends byte-identical.
- Conflict in **`README.md`** → never surfaced: `guarded-merge.sh` auto-resolves it to the
  fork's version (a `KEEP_FROM_FORK` pin), so the fork README is never synced from upstream.

`rerere` is enabled by `fetch-upstream.sh`, so the same conflict resolves automatically on
the 2nd+ sync. Recover a bad recording with `git rerere forget <path>`.

## Safety properties (the scripts enforce these — keep them)

- **Never pushes** — every step stays local; nothing is published to a remote.
- **Never *auto*-merges onto `main`** — `execute` only ever lands on a `sync/upstream-<date>`
  branch. `main` advances solely through the explicit, separately-approved `land` step, and
  only by **fast-forward** (`--ff-only`) — never a force, never an auto-merge.
- **Never *silently* reverts** a fork edit — it surfaces drift outside `src/standalone/` and the
  remediation choice (build seam / upstream-it / revert-to-upstream) for the human to decide.
- **Never syncs `README.md`** — the fork's README is always kept and upstream's discarded (the
  `KEEP_FROM_FORK` pin). README is outside the `src/` drift gate, so this never affects the invariant.
- **Surfaces conflicts** rather than auto-favoring a side (except a generated/lock file).
- **Build-as-gate** — `npm run build:standalone` catches a `constants.ts` rename that a
  pure git-diff would miss (esbuild throws `0 redirects` on `onEnd`).

## Degrees of freedom

- **Low (scripts, run exactly):** the deterministic, dangerous git plumbing — fetch,
  merge-base diff, set-difference, the build self-guard. Only output enters context.
- **High (your judgment):** drift classification (upstream-it vs re-merge), **appending** a
  new feature bucket per surfaced upstream feature (append-only ledger — never renumber/delete),
  is-this-a-feature vs a fix/refactor when scanning the upstream delta, the report narrative,
  conflict triage.

## Scripts

| Script | Does | Mutates? |
|---|---|---|
| `scripts/fetch-upstream.sh` | add remote + rerere (idempotent), fetch, print refs | remote/global config only |
| `scripts/drift-gate.sh` | merge-base authorship gate + override preconditions; classifies drift | no |
| `scripts/parity-gap.mjs` | `universe \ exposed` gap, counts, degradations, new-method delta | no |
| `scripts/guarded-merge.sh` | `plan` (read-only) / `execute` (branch + guarded merge + build gate) / `land` (ff-only sync→local main, re-gates) | `execute`, `land` |

## Common mistakes

- **Gating on `upstream/main` instead of the merge-base** → ~16 false positives; the gate
  gets ignored. Always use `git merge-base HEAD upstream/main`.
- **Carrying a fork fix in shared `src/` (outside `src/standalone/`)** → breaks the additive-only
  invariant; `drift-gate.sh` flags it and `land` refuses it. A behavior override belongs behind a
  build seam; a portable bug fix should be upstreamed (PR to microsoft/AI-Engineering-Coach). If
  neither fits, revert to upstream and accept upstream's behavior locally — don't carry the edit.
- **Editing a shared core file to change behavior** → breaks the invariant. Add a
  standalone-only re-export + an esbuild `onResolve` redirect (see `reference.md`).
- **Trusting an allowlist header comment for counts** → count the Set *literally*;
  `parity-gap.mjs` strips comments first so `require('vscode')` can't inflate the count.
- **Adding a "merge debt" / "fork is behind upstream" bucket to the parity report** → being
  behind is a *sync status* (step 1's `behind` count + the drift gate), not a standalone
  parity gap. Only add to `STANDALONE-PARITY-GAPS.md` when upstream shipped **new
  functionality** `src/standalone/` doesn't implement — and only *features*, never bug fixes,
  refactors, dep bumps, tests, infra, or VS Code-only surfaces.
- **Renumbering, merging, or deleting buckets** → the bucket list is an **append-only ledger**.
  Each new feature gets the next free letter (one bucket per feature); an implemented one is
  marked `SHIPPED (<date>)` **in place** by the implementing agent. Never reorganize the ledger.
- **Pushing, or *auto*-merging onto `main`** → never. The skill stops at a reviewed
  `sync/upstream-<date>` branch; `main` only moves via the explicit `land` follow-up
  (fast-forward, local-only) after the human approves. Never push.
- **Letting `land` wave through drift outside `src/standalone/`** → the additive-only invariant
  requires **zero** drift before `main` moves. `land` blocks on `drift-gate.sh` exit `1` (HARD
  precondition breach) **and** exit `2` (fork-authored drift). Remediate the drift (build seam /
  upstream-it / revert) before landing — never land over it.

For the invariant, the override seam, and the parity algorithm in full, read `reference.md`.
For the report format, use `report-template.md`.
