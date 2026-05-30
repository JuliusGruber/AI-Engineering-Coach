#!/usr/bin/env bash
# scripts/drift-gate.sh — the additive-only gate (§3.1 authorship + §3.2 preconditions).
#
# Enforces the invariant against the MERGE-BASE, not upstream/main: gating on
# upstream/main reports ~16 behind-upstream false positives, so a noisy gate gets
# ignored. The merge-base diff isolates FORK AUTHORSHIP from behind-upstream noise.
# Run this (do not read it) — only its stdout matters.
#
# Run from the repo root.
#
# Exit codes:
#   0  invariant holds (no authorship drift, all preconditions pass)
#   1  HARD precondition breach (constants drifted / redirect unwired / core leaks shadow)
#   2  authorship drift present (fork-authored edits outside src/standalone/) — classified below
set -uo pipefail

EXCLUDE=':(exclude)src/standalone/'
base=$(git merge-base HEAD upstream/main) \
  || { echo "FATAL: no merge-base with upstream/main (run fetch-upstream.sh first)"; exit 1; }
echo "merge_base=$base"
echo "upstream_head=$(git rev-parse upstream/main)"
echo

hard_fail=0
drift=0

# ---- §3.1 AUTHORSHIP GATE (must be empty) ------------------------------------
echo "== authorship gate: git diff \$base..HEAD -- src/ (excluding src/standalone/) =="
files=$(git diff --name-only "$base" HEAD -- src/ "$EXCLUDE")
if [ -z "$files" ]; then
  echo "  clean — no fork-authored edits outside src/standalone/"
else
  drift=1
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    log=$(git log --oneline "$base"..HEAD -- "$f")
    if [ -n "$log" ]; then
      echo "  DELIBERATE   $f"
      echo "               introduced by: $(echo "$log" | tail -1)"
      echo "               -> propose: UPSTREAM IT (PR to microsoft/AI-Engineering-Coach), or move"
      echo "                  the behaviour behind a src/standalone/ build seam. NEVER auto-revert"
      echo "                  (panel-request-service.ts carries a correct Windows path.join fix)."
    else
      echo "  MERGE-DRIFT  $f"
      echo "               (empty \$base..HEAD log — behind-upstream / merge-resolution noise)"
      echo "               -> propose: re-merge, or  git checkout upstream/main -- \"$f\""
    fi
  done <<< "$files"
fi
echo

# ---- §3.2 OVERRIDE PRECONDITIONS (hard) --------------------------------------
echo "== override preconditions (the FF_TOKEN_REPORTING redirect depends on these) =="

if git diff --quiet upstream/main -- src/core/constants.ts; then
  echo "  OK    src/core/constants.ts byte-identical to upstream"
else
  echo "  FAIL  src/core/constants.ts drifted — the FF override assumes core stays pristine"
  hard_fail=1
fi

# `git grep -c` prints "esbuild.mjs:<n>" — take the count after the colon.
redirects=$(git grep -c makeConstantsRedirectPlugin -- esbuild.mjs 2>/dev/null | cut -d: -f2)
redirects=${redirects:-0}
if [ "$redirects" -ge 2 ] 2>/dev/null; then
  echo "  OK    esbuild constants-redirect wired ($redirects refs in esbuild.mjs)"
else
  echo "  FAIL  esbuild constants-redirect missing/unwired (found '$redirects' refs, need >=2)"
  hard_fail=1
fi

if git grep -n 'standalone/standalone-constants' -- src/ "$EXCLUDE" >/dev/null 2>&1; then
  echo "  FAIL  core code references the shadow constants (the redirect must be esbuild-only):"
  git grep -n 'standalone/standalone-constants' -- src/ "$EXCLUDE" | sed 's/^/          /'
  hard_fail=1
else
  echo "  OK    no core reference to src/standalone/standalone-constants"
fi
echo

# ---- verdict -----------------------------------------------------------------
if [ "$hard_fail" -ne 0 ]; then
  echo "VERDICT: PRECONDITION BREACH — fix before any merge."
  exit 1
fi
if [ "$drift" -ne 0 ]; then
  echo "VERDICT: AUTHORSHIP DRIFT — classified above. Remediate (upstream-it / re-merge)"
  echo "         before claiming additive-only. The build self-guard still runs in guarded-merge.sh."
  exit 2
fi
echo "VERDICT: INVARIANT OK — additive-only holds, override preconditions intact."
exit 0
