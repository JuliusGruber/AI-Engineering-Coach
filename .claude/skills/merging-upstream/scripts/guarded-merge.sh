#!/usr/bin/env bash
# scripts/guarded-merge.sh — plan-validate-execute guarded merge of upstream/main.
#
# Safety properties (do not weaken):
#   - NEVER pushes (the human runs `git push -u origin sync/...` + opens the PR).
#   - NEVER merges onto main directly — always a fresh sync/upstream-<date> branch.
#   - NEVER auto-resolves conflicts — surfaces them for a human (lean on rerere).
#   - NEVER auto-reverts the legit path.join fix — it is a deliberate edit to upstream.
#   - Build-as-gate: runs `npm run build:standalone` so the esbuild onEnd 0-redirect
#     throw catches a constants rename that a pure git-diff would miss.
# Run this (do not read it) — only its stdout matters.
#
# Run from the repo root.
#
# Usage:
#   guarded-merge.sh plan      # safe: shows incoming commits + the core files upstream touches; mutates nothing
#   guarded-merge.sh execute   # creates sync/upstream-<date>, merges --no-commit, runs the build gate, commits
set -uo pipefail

MODE="${1:-plan}"
EXCLUDE=':(exclude)src/standalone/'
abort() { echo "ABORT: $*" >&2; exit 1; }

base=$(git merge-base HEAD upstream/main) || abort "no merge-base with upstream/main (run fetch-upstream.sh first)"
head=$(git rev-parse upstream/main)

# ---- PLAN (mutates nothing) --------------------------------------------------
if [ "$MODE" = "plan" ]; then
  echo "== guarded-merge PLAN (mutates nothing) =="
  echo "merge_base=$base  upstream_head=$head  behind=$(git rev-list --count HEAD..upstream/main)"
  echo
  echo "-- incoming commits (HEAD..upstream/main) --"
  git log --oneline HEAD..upstream/main | sed 's/^/  /'
  echo
  echo "-- incoming commits touching SHARED CORE (outside src/standalone/) --"
  core=$(git log --oneline HEAD..upstream/main -- src/ "$EXCLUDE")
  [ -n "$core" ] && echo "$core" | sed 's/^/  /' || echo "  (none — incoming changes are all outside shared core)"
  echo
  echo "-- current fork-authored drift to reconcile first (see drift-gate.sh) --"
  drift=$(git diff --name-only "$base" HEAD -- src/ "$EXCLUDE")
  [ -n "$drift" ] && echo "$drift" | sed 's/^/  /' || echo "  (none)"
  echo
  echo "Next: review the parity-gap report, then run 'guarded-merge.sh execute' on approval."
  exit 0
fi

[ "$MODE" = "execute" ] || abort "unknown mode '$MODE' (use: plan | execute)"

# ---- EXECUTE (guarded) -------------------------------------------------------
git diff --quiet && git diff --cached --quiet || abort "working tree not clean — commit or stash first"

branch="sync/upstream-$(date +%Y%m%d)"
git rev-parse --verify "$branch" >/dev/null 2>&1 && abort "branch $branch already exists — finish or delete it first"
git switch -c "$branch" || abort "could not create $branch"
echo "on branch $branch"

# Stage the merge WITHOUT committing so we validate before recording anything.
if ! git merge --no-ff --no-commit upstream/main; then
  if git ls-files -u | grep -q .; then
    echo "CONFLICTS — surfaced for a human (lean on rerere). Conflicted paths:"
    git diff --name-only --diff-filter=U | sed 's/^/  /'
    echo
    echo "Policy: a conflict INSIDE src/standalone/ -> resolve manually (your code vs an upstream"
    echo "rename/signature change — the signal you want). A generated/lock file -> deterministic"
    echo "side wins (-X theirs/ours for THAT path only). Any other core file -> resolve toward"
    echo "upstream, then re-run drift-gate.sh. Then: git diff --check && git merge --continue."
    echo "NOT auto-resolving. Merge left in progress."
    exit 3
  fi
  abort "merge failed for a non-conflict reason"
fi

# VALIDATE before committing: staged tree outside src/standalone/ should match upstream/main.
# A non-empty list is EXPECTED only for deliberate carried edits (e.g. the path.join fix) —
# surface it, do not silently proceed, do not auto-revert.
offenders=$(git diff --name-only --cached upstream/main -- src/ "$EXCLUDE")
if [ -n "$offenders" ]; then
  echo "REVIEW: staged tree differs from upstream/main outside src/standalone/:"
  echo "$offenders" | sed 's/^/  /'
  echo "        (OK only if these are deliberate carried fork edits; otherwise resolve toward upstream)"
fi

# BUILD GATE — the FF-redirect onEnd self-guard (esbuild.mjs) throws on 0 redirects,
# catching a constants rename that a pure git-diff would miss.
echo "running build gate: npm run build:standalone"
if ! npm run build:standalone; then
  echo "ABORT: build:standalone failed — leaving the merge staged & uncommitted for inspection." >&2
  exit 4
fi

git commit --no-edit
echo
echo "merged upstream/main into $branch and committed. DID NOT PUSH."
echo "verify : bash .claude/skills/merging-upstream/scripts/drift-gate.sh   (expect VERDICT: INVARIANT OK)"
echo "publish: git push -u origin $branch && gh pr create --base main --fill   (human does this)"
