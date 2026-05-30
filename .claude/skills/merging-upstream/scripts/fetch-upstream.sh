#!/usr/bin/env bash
# scripts/fetch-upstream.sh — PRECONDITION step of the merging-upstream skill.
#
# Idempotent: adds the `upstream` remote and enables rerere if missing, fetches,
# then prints the three refs the rest of the workflow keys off of. Run this (do
# not read it) — only its stdout enters context.
#
# Run from the repo root.
set -uo pipefail

UPSTREAM_URL="https://github.com/microsoft/AI-Engineering-Coach.git"

# 1. upstream remote (idempotent — `upstream/main` is the pristine vendor line)
git remote get-url upstream >/dev/null 2>&1 || git remote add upstream "$UPSTREAM_URL"

# 2. rerere — reuse recorded conflict resolutions across syncs. Additive: it only
#    writes .git/rr-cache and has zero history impact. Recover a bad recording
#    with `git rerere forget <path>`. (Global per the documented strategy §2.2.)
if [ "$(git config --global rerere.enabled || echo unset)" != "true" ]; then
  git config --global rerere.enabled true
  echo "note: enabled rerere globally (git config --global rerere.enabled true)"
fi

# 3. fetch the vendor line
git fetch --quiet upstream

# 4. assert upstream/main resolves, then publish the refs
UPSTREAM_HEAD=$(git rev-parse --verify upstream/main) \
  || { echo "FATAL: upstream/main does not resolve after fetch" >&2; exit 1; }
BASE=$(git merge-base HEAD upstream/main)
LOCAL_HEAD=$(git rev-parse HEAD)
BEHIND=$(git rev-list --count HEAD..upstream/main)

echo "upstream_head=$UPSTREAM_HEAD"
echo "merge_base=$BASE"
echo "local_head=$LOCAL_HEAD"
echo "behind=$BEHIND"
if [ "$BASE" = "$UPSTREAM_HEAD" ]; then
  echo "status=up-to-date"
else
  echo "status=behind"
fi
