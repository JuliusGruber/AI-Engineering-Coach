#!/usr/bin/env bash
# scripts/guarded-merge.sh — plan-validate-execute guarded merge of upstream/main.
#
# Safety properties (do not weaken):
#   - NEVER pushes — every step stays local; nothing is published to a remote.
#   - NEVER auto-merges onto main — `execute` always lands on a fresh sync/upstream-<date>
#     branch. main advances ONLY via the explicit, separately-approved `land` step, and only
#     by fast-forward (--ff-only) — never a force, never an auto-merge.
#   - NEVER auto-resolves conflicts — surfaces them for a human (lean on rerere).
#   - NEVER *silently* reverts a fork edit — it surfaces drift outside src/standalone/ and the
#     remediation choice (build seam / upstream-it / revert) for the human; never auto-destroys a fix.
#   - NEVER syncs README.md from upstream — always keeps the fork's committed README (KEEP_FROM_FORK).
#   - Build-as-gate: runs `npm run build:standalone` so the esbuild onEnd 0-redirect
#     throw catches a constants rename that a pure git-diff would miss.
# Run this (do not read it) — only its stdout matters.
#
# Run from the repo root.
#
# Usage:
#   guarded-merge.sh plan                          # safe: shows incoming commits + the core files upstream touches; mutates nothing
#   guarded-merge.sh execute                       # creates sync/upstream-<date>, merges --no-commit, runs the build gate, commits
#   guarded-merge.sh land [sync/upstream-<date>]   # fast-forward LOCAL main onto the reviewed sync branch (ff-only); never pushes
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
  echo "-- current fork-authored drift to reconcile first (must be empty — see drift-gate.sh) --"
  drift=$(git diff --name-only "$base" HEAD -- src/ "$EXCLUDE")
  [ -n "$drift" ] && echo "$drift" | sed 's/^/  /' || echo "  (none)"
  echo
  echo "Next: review the parity-gap report, then run 'guarded-merge.sh execute' on approval."
  exit 0
fi

# ---- LAND (fast-forward LOCAL main onto the reviewed sync branch) -------------
# Separate, explicitly-approved follow-up: the human reviewed the sync branch and chose to land it.
# Fast-forward ONLY and LOCAL ONLY — never a force-merge, never a push.
if [ "$MODE" = "land" ]; then
  sync_branch="${2:-$(git branch --show-current)}"
  case "$sync_branch" in
    sync/upstream-*) : ;;
    *) abort "refusing to land '$sync_branch' — expected a sync/upstream-<date> branch (pass it: guarded-merge.sh land sync/upstream-YYYYMMDD)" ;;
  esac
  git rev-parse --verify "$sync_branch" >/dev/null 2>&1 || abort "no such branch: $sync_branch"
  git diff --quiet && git diff --cached --quiet || abort "working tree not clean — commit or stash first"

  # Re-check the additive-only gate on the branch we're about to land. The invariant requires
  # ZERO drift before main moves, so block on ANYTHING the gate flags:
  #   exit 1 = HARD precondition breach (constants drift / redirect unwired / shadow leak)
  #   exit 2 = fork-authored drift outside src/standalone/ (remediate: build seam / upstream-it / revert)
  git switch "$sync_branch" || abort "could not switch to $sync_branch"
  echo "== drift-gate on $sync_branch (precondition re-check before landing) =="
  bash "$(dirname "$0")/drift-gate.sh"; gate_rc=$?
  if [ "$gate_rc" -eq 1 ]; then
    echo "ABORT: drift-gate HARD precondition breach on $sync_branch — main NOT touched. Fix before landing." >&2
    exit 1
  fi
  if [ "$gate_rc" -eq 2 ]; then
    echo "ABORT: fork-authored drift outside src/standalone/ on $sync_branch — the additive-only" >&2
    echo "       invariant requires zero drift before main moves. Remediate (move the behaviour behind a" >&2
    echo "       src/standalone/ build seam, upstream it, or revert to upstream), then land. main NOT touched." >&2
    exit 2
  fi

  git switch main || abort "could not switch to main (main NOT touched)"
  if ! git merge --ff-only "$sync_branch"; then
    echo "ABORT: cannot fast-forward main to $sync_branch — main has diverged since the branch was cut." >&2
    echo "       Re-run fetch-upstream.sh + 'guarded-merge.sh execute' from current main so the new" >&2
    echo "       sync branch includes main's commits, then land that. main NOT moved." >&2
    exit 5
  fi
  echo
  echo "fast-forwarded LOCAL main -> $sync_branch. DID NOT PUSH."
  echo "verify : bash .claude/skills/merging-upstream/scripts/drift-gate.sh"
  echo "cleanup: git branch -d $sync_branch   (sync branch kept as an audit trail until you delete it)"
  exit 0
fi

[ "$MODE" = "execute" ] || abort "unknown mode '$MODE' (use: plan | execute | land)"

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

# VALIDATE before committing: the staged tree outside src/standalone/ MUST match upstream/main.
# The fork is additive, so this should be EMPTY. A non-empty list means a core conflict was
# resolved toward the fork (or pre-existing drift slipped in) — resolve toward upstream now;
# `land` re-runs the drift gate and refuses to land any drift.
offenders=$(git diff --name-only --cached upstream/main -- src/ "$EXCLUDE")
if [ -n "$offenders" ]; then
  echo "REVIEW: staged tree differs from upstream/main outside src/standalone/ (must be empty):"
  echo "$offenders" | sed 's/^/  /'
  echo "        Resolve these toward upstream before committing — land will refuse the drift."
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
echo "verify : bash .claude/skills/merging-upstream/scripts/drift-gate.sh"
echo "review : inspect the branch — git log main..$branch ; git diff main..$branch"
echo "land   : on your approval, bash .claude/skills/merging-upstream/scripts/guarded-merge.sh land $branch"
echo "         (fast-forwards LOCAL main onto $branch; never pushes)"
