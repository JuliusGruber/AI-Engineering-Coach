#!/usr/bin/env bash
# scripts/guarded-merge.sh — plan-validate-execute guarded merge of upstream/main.
#
# Safety properties (do not weaken):
#   - NEVER pushes (the human runs `git push -u origin sync/...` + opens the PR).
#   - NEVER merges onto main directly — always a fresh sync/upstream-<date> branch.
#   - NEVER auto-resolves conflicts — surfaces them for a human (lean on rerere).
#   - NEVER auto-reverts the fork's deliberate edits (44e9532) — they are upstream-it candidates.
#   - NEVER syncs README.md from upstream — always keeps the fork's committed README (KEEP_FROM_FORK).
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

# Files that must NEVER be synced from upstream — always keep the fork's committed version.
# README lives at the repo root, OUTSIDE the src/ drift gate, so pinning it touches nothing the
# additive-only invariant checks. Add more repo-root docs here if the fork pins more of them.
KEEP_FROM_FORK=(README.md)

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
  echo "-- pinned fork files that 'execute' will KEEP (upstream changes to these are discarded) --"
  for keep in "${KEEP_FROM_FORK[@]}"; do
    if git diff --quiet HEAD upstream/main -- "$keep" 2>/dev/null; then
      echo "  $keep (upstream identical — nothing to discard)"
    else
      echo "  $keep (upstream differs — fork's version will be kept, not synced)"
    fi
  done
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
# Capture the merge's exit code and the conflicts it produced rather than failing on it: a
# README-only conflict is resolved (to ours) below, not surfaced to a human.
git merge --no-ff --no-commit upstream/main
merge_rc=$?
unmerged_before=$(git ls-files -u)

# KEEP THE FORK'S README (and any other KEEP_FROM_FORK doc): never sync it from upstream.
# Reset each pinned file to the fork's committed version and re-stage it. This both resolves a
# README-only conflict to ours AND undoes a silent adoption of upstream's README on a clean merge.
for keep in "${KEEP_FROM_FORK[@]}"; do
  git cat-file -e "HEAD:$keep" 2>/dev/null || continue   # skip if the fork doesn't track it
  git checkout HEAD -- "$keep" && git add -- "$keep" \
    && echo "kept fork's $keep (upstream version discarded — never synced)"
done

# Surface only the conflicts that REMAIN after pinning (README, if it conflicted, is gone).
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

# A non-zero merge with no remaining unmerged files is OK only when the lone conflict was a
# pinned file we deliberately resolved to ours; otherwise it was a genuine merge failure.
if [ "$merge_rc" -ne 0 ] && [ -z "$unmerged_before" ]; then
  abort "merge failed for a non-conflict reason"
fi

# VALIDATE before committing: staged tree outside src/standalone/ should match upstream/main.
# A non-empty list is EXPECTED only for deliberate carried edits (e.g. the 44e9532 core edits) —
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
