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
or pushing/opening PRs (this skill stops at a local branch — a human publishes).

## Workflow (plan → validate → execute)

Run the scripts — **execute them, do not read them**; only their stdout enters context.
Run everything from the repo root.

1. **PRECONDITION** — Run `bash .claude/skills/merging-upstream/scripts/fetch-upstream.sh`.
   Confirms `upstream/main` resolves; prints `merge_base` / `upstream_head` / `behind`.

2. **DRIFT GATE** — Run `bash .claude/skills/merging-upstream/scripts/drift-gate.sh`.
   It classifies every path outside `src/standalone/`:
   - `DELIBERATE` (named in `git log base..HEAD`) → propose **upstream it** (PR to
     microsoft/AI-Engineering-Coach) or move the behavior behind a `src/standalone/`
     build seam. **NEVER auto-revert** — `panel-request-service.ts` carries a correct
     Windows `path.join` fix (commit `e3be742`) that reverting would re-break.
   - `MERGE-DRIFT` (empty `base..HEAD` log) → propose **re-merge** /
     `git checkout upstream/main -- <file>`.
   A `PRECONDITION BREACH` (exit 1) is hard — fix before merging.

3. **PARITY GAP** — Run `node .claude/skills/merging-upstream/scripts/parity-gap.mjs`.
   Reads its output: counts (regression assertions), the `universe \ exposed` gap list,
   shipped-page degradation call sites, and any methods upstream added since the base
   ("allowlist decision needed").

4. **DRAFT REPORT** — Regenerate `docs-fork/STANDALONE-PARITY-GAPS.md` from
   `report-template.md`, filling the auto sections from step 3's output. **Preserve the
   existing bucket A–F structure**; leave bucket-letter / difficulty / Effect / Priority
   as `TODO` for a human. Flag newly-appeared upstream methods explicitly.

5. **ASK** — Present the drift classification + the gap delta. **STOP and ask the human
   before merging.** Preview with
   `bash .claude/skills/merging-upstream/scripts/guarded-merge.sh plan` (mutates nothing).

6. **GUARDED MERGE** — On approval, run
   `bash .claude/skills/merging-upstream/scripts/guarded-merge.sh execute`. It creates a
   fresh `sync/upstream-<date>` branch, merges `--no-commit`, surfaces conflicts (never
   auto-resolves), runs `npm run build:standalone` (the FF-redirect self-guard), and
   commits only if the gate passes. It **ABORTs loud** on any failure and **never pushes**.

7. **VERIFY** — Re-run `drift-gate.sh`; confirm `VERDICT: INVARIANT OK`. Report the branch
   name. **Do not push** — a human runs `git push -u origin sync/...` and opens the PR.

## Conflict policy (do not auto-favor a side)

- Conflict **inside `src/standalone/`** → resolve manually (your code vs an upstream
  rename/signature change — the signal you want).
- Conflict in a **generated/lock-style file** upstream also touches → `-X theirs`/`-X ours`
  for **that one path** only. Never blanket-apply.
- Conflict in **any other core file** → resolve toward upstream, then re-run `drift-gate.sh`
  to confirm the file ends byte-identical.

`rerere` is enabled by `fetch-upstream.sh`, so the same conflict resolves automatically on
the 2nd+ sync. Recover a bad recording with `git rerere forget <path>`.

## Safety properties (the scripts enforce these — keep them)

- **Never pushes** — the workflow stops at a local branch; a human publishes.
- **Never merges onto `main`** — always a `sync/upstream-<date>` branch.
- **Never auto-reverts** the `path.join` fix (`e3be742`) — it proposes upstreaming it.
- **Surfaces conflicts** rather than auto-favoring a side (except a generated/lock file).
- **Build-as-gate** — `npm run build:standalone` catches a `constants.ts` rename that a
  pure git-diff would miss (esbuild throws `0 redirects` on `onEnd`).

## Degrees of freedom

- **Low (scripts, run exactly):** the deterministic, dangerous git plumbing — fetch,
  merge-base diff, set-difference, the build self-guard. Only output enters context.
- **High (your judgment):** drift classification (upstream-it vs re-merge), parity
  bucketing (A–F), the report narrative, conflict triage.

## Scripts

| Script | Does | Mutates? |
|---|---|---|
| `scripts/fetch-upstream.sh` | add remote + rerere (idempotent), fetch, print refs | remote/global config only |
| `scripts/drift-gate.sh` | merge-base authorship gate + override preconditions; classifies drift | no |
| `scripts/parity-gap.mjs` | `universe \ exposed` gap, counts, degradations, new-method delta | no |
| `scripts/guarded-merge.sh` | `plan` (read-only) / `execute` (branch + guarded merge + build gate) | only on `execute` |

## Common mistakes

- **Gating on `upstream/main` instead of the merge-base** → ~16 false positives; the gate
  gets ignored. Always use `git merge-base HEAD upstream/main`.
- **Reverting `panel-request-service.ts`** → re-introduces the mixed-separator bug that
  broke `service-writes.test.ts` on Windows. Upstream it instead.
- **Editing a shared core file to change behavior** → breaks the invariant. Add a
  standalone-only re-export + an esbuild `onResolve` redirect (see `reference.md`).
- **Trusting an allowlist header comment for counts** → count the Set *literally*;
  `parity-gap.mjs` strips comments first so `require('vscode')` can't inflate the count.
- **Pushing or merging onto `main` from the skill** → never. Stop at the local branch.

For the invariant, the override seam, and the parity algorithm in full, read `reference.md`.
For the report format, use `report-template.md`.
