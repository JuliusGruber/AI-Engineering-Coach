# Parity report template

The format for `docs-fork/STANDALONE-PARITY-GAPS.md`. This doc is a **complete, user-facing
feature inventory** of the upstream extension, **rebuilt from a full re-analysis of both repos
on every sync** — regenerated, not patched. There are **no per-feature letter codes, no
carried-forward history rows, and no difficulty/Effect/Priority columns**.

Sections marked **[AUTO]** are pasted verbatim from `scripts/parity-gap.mjs` output. Sections
marked **[HUMAN/analysis]** are the feature rows and statuses — these are produced by reading
code in both repos during the rebuild and the script must not invent them.

---

# Standalone Feature Parity (upstream → fork)

A complete, user-facing **feature inventory** of the upstream `microsoft/AI-Engineering-Coach`
extension, each feature marked with its status in this fork's **standalone build**. Rebuilt
from a full re-analysis of both repos on every sync. **Grounding:** every status below was
established by reading code in both repos (upstream nav/pages/`contributes.*`/chat/mcp and the
standalone allowlists, routes, pages, and stubs); the grounding ref is in each Note.

**[AUTO] Staleness banner** — paste the `parity-gap.mjs` header line, e.g.:
> Derived `<merge-base>` → re-verified `<upstream_head>`, `<n>` behind. If
> `git rev-parse upstream/main` ≠ this SHA, regenerate.

**[HUMAN/analysis] Legend** — ✅ implemented · ⚠️ partial · ❌ not implemented · ⛔ VS Code-only

> **Scope.** Functional parity only. Git **sync status** (how far behind `upstream/main` the
> fork is) is **not** a feature row — it's owned by `fetch-upstream.sh` (behind count) and
> `drift-gate.sh`. The fork is **purely additive**: all fork code lives in `src/standalone/`,
> so the merge-base diff of shared `src/` is empty.

---

## [HUMAN/analysis] <Functional area>

One `## ` section per functional area (group by capability, not by RPC method). Suggested
areas — adjust to what the upstream repo actually contains:
*Core dashboards & output · Token & cost reporting · Rules & anti-patterns authoring ·
Skills (install/discover/triage/generate) · Learning Center · Data exploration & rule
playground · LLM provider tier · Agentic SDLC · Project-scoped analysis · VS Code-only
surfaces.*

| Feature | Standalone | Note |
|---|---|---|
| <user-facing capability> | <✅/⚠️/❌/⛔> | <degradation / grounding source ref / blocker> |

**Rules for a row:**
- A row is a **user-facing capability** (page, panel, nav route, command, major flow). Bug
  fixes, refactors, dep bumps, tests, and infra **never** get a row.
- A **structurally non-portable feature** (activity-bar sidebar, `@aicoach` chat participant,
  MCP tools) **does** get a row, marked **⛔**.
- Never mark **✅** from an allowlist entry alone — confirm a working UI path. An allowlisted
  method with no standalone caller is **⚠️** (exposed-but-unreachable).
- The **LLM data-flow / configuration transparency** note is **retained verbatim** as a
  block-quote under the LLM provider tier (it is not cheaply re-derivable from a quick scan).

## [AUTO] Appendix — RPC surface tripwire (machine signal)

Paste `parity-gap.mjs`'s counts block and any "ALLOWLIST DECISION NEEDED" methods here. This
is a supporting signal, **not** the doc's structure.

```
V1_ALLOWED         = NN   OK|DRIFT
V1_SERVICE_ALLOWED = NN   OK|DRIFT
STANDALONE_NATIVE  = NN   OK|DRIFT
exposed (union)    = NN   OK|DRIFT
universe (upstream)= NN
gap                = NN
```
