# Standalone Feature Parity — replacing the bucket ledger with a feature inventory

**Date:** 2026-06-04
**Status:** Approved design, pending implementation plan
**Affects:** `docs-fork/STANDALONE-PARITY-GAPS.md`, `.claude/skills/merging-upstream/` (SKILL.md, report-template.md, scripts/parity-gap.mjs), two auto-memories

---

## 1. Motivation

`docs-fork/STANDALONE-PARITY-GAPS.md` and the `merging-upstream` skill currently track
parity as an **append-only ledger of lettered buckets (A–E)** built around the upstream
**RPC method surface** (`keyof ExtensionMethodMap`, ~75 methods, machine-derived by
`scripts/parity-gap.mjs`). Each bucket carries human-curated difficulty / Effect / Priority,
and the ledger is never renumbered or deleted.

This is hard to read at a glance and is RPC-centric: it can't see non-RPC, user-facing
features, and "what does the standalone build actually do vs. upstream" requires decoding
method names and allowlist membership.

**The change:** replace the bucket ledger with a **complete, user-facing feature inventory**
that is **rebuilt from a full re-analysis of both repos on every sync**. Each upstream
feature is one row with a four-state status. No buckets, no append-only ledger, no
difficulty/Effect/Priority columns.

## 2. Goals

- A single, readable inventory of **every user-facing feature** the upstream extension has.
- Each feature marked with its standalone status: **✅ implemented / ⚠️ partial / ❌ not
  implemented / ⛔ VS Code-only**.
- The skill **re-analyzes the whole upstream repo and the whole standalone UI on every sync**
  and **rebuilds every row** — the inventory is regenerated, not patched.
- Every status is **grounded in code actually read in both repos** — no assumptions.
- `parity-gap.mjs` is **kept as an automated tripwire** (new RPC methods, silent
  degradations, count drift), demoted from "the doc's structure" to "a supporting signal."

## 3. Non-goals

- Renaming the doc file (stays `docs-fork/STANDALONE-PARITY-GAPS.md`; only the H1 title
  changes to "Standalone Feature Parity").
- Changing the merge/drift/land machinery: skill steps 1–3 and 5–8 (fetch, drift gate,
  ASK/STOP, guarded merge, verify, land) are untouched. Only the parity/report step changes.
- Keeping the append-only ledger, bucket letters, or difficulty/Effect/Priority columns —
  these are removed.
- Tracking git *sync status* (how far behind upstream) as a feature row — that remains a
  sync concern owned by `fetch-upstream.sh` / `drift-gate.sh`.

## 4. Locked decisions (from brainstorming)

1. **Feature unit:** user-facing capabilities (pages, panels, nav routes, commands, major
   flows) — not RPC methods.
2. **Scope:** the **complete** upstream feature set, including features that can't run in a
   browser. VS Code-only surfaces appear as rows marked ⛔, not excluded.
3. **States:** four markers + a Note column —
   - **✅ implemented** — the standalone UI exposes a working version of the feature.
   - **⚠️ partial** — the feature renders/works but a sub-capability is degraded (e.g.
     Burndown chart renders but model-budgets don't persist; Learning quizzes work but
     personalization is generic when no workspace root resolves; `createSkill` opens VS Code
     chat rather than an LLM call).
   - **❌ not implemented** — upstream has it; the standalone UI does not expose it.
   - **⛔ VS Code-only** — the feature is structurally non-portable (activity-bar sidebar,
     `@aicoach` chat participant, MCP language-model tools) and intentionally not in scope to
     implement.
   - **Note** — short prose: the degradation, the grounding source ref, or why it's blocked.
4. **Engine:** keep `parity-gap.mjs` as a tripwire **and** re-analyze the whole upstream repo
   every sync; rebuild every feature row.

### Defaults confirmed by the user

- **Grouping:** features grouped by functional area (not one flat sorted table).
- **Filename:** keep `STANDALONE-PARITY-GAPS.md`; update the H1 to "Standalone Feature Parity."
- **Tripwire appendix:** keep `parity-gap.mjs`'s counts as a small machine-signal appendix.

## 5. New doc structure (`docs-fork/STANDALONE-PARITY-GAPS.md`)

```
# Standalone Feature Parity (upstream → fork)

<intro: what this is — a complete user-facing feature inventory of upstream, each marked with
its standalone status; rebuilt from a full re-analysis of both repos on every sync. Grounding:
every status was established by reading code in both repos.>

**Staleness banner** — derived <merge-base> → re-verified <upstream/main>, N behind.
If `git rev-parse upstream/main` ≠ this SHA, regenerate.

**Legend** — ✅ implemented · ⚠️ partial · ❌ not implemented · ⛔ VS Code-only

## <Functional area>
| Feature | Standalone | Note |
|---|---|---|
| <feature> | <✅/⚠️/❌/⛔> | <degradation / grounding ref / blocker> |
...

(one ## section per functional area)

## Appendix — RPC surface tripwire (machine signal)
<paste parity-gap.mjs header + counts block: universe N / exposed M / gap K, OK|DRIFT flags;
any newly-appeared upstream RPC methods needing an allowlist decision>
```

### Proposed functional areas (final list determined during implementation by the analysis)

Token & cost reporting · Rules & anti-patterns authoring · Skills (install/discover/triage/
generate) · Learning Center · Data exploration & rule playground · Agentic SDLC · Project-scoped
analysis · Core dashboards & output · VS Code-only surfaces. The implementing analysis may add
or rename areas based on what the upstream repo actually contains — areas are descriptive, not a
fixed schema.

### Migration of existing curated content

The current doc holds substantive prose worth preserving as feature-row notes (not lost in the
rebuild): the per-method degradation call sites (`saveModelBudgets`/`loadModelBudgets`,
`reviewLocalRules`, `getWorkspaceDeps`), the per-harness `workspaceRootPath` caveat, and the
**LLM data-flow / configuration transparency** paragraph (what data AI features send, env-var
config). The transparency block is not cheaply re-derivable from a quick scan — it is **retained
verbatim** as a note attached to the LLM feature area. Everything else is re-grounded from code.

## 6. Skill changes (`.claude/skills/merging-upstream/SKILL.md`)

**Step 4 (currently "DRAFT REPORT") is rewritten** to the full-re-analysis mechanic:

1. Run `parity-gap.mjs` → tripwire (new RPC methods? silent degradations? count drift?).
2. Re-analyze the **whole upstream repo** → enumerate every user-facing feature (nav/routes,
   `src/webview/page-*.ts`, panels, commands, `src/chat/*`, `src/mcp/*`).
3. Re-analyze the **whole standalone UI** (`src/standalone/`) → for each feature, determine
   ✅/⚠️/❌/⛔ by reading the allowlist (`v1-allowed.ts`, `v1-service-allowed.ts`,
   `standalone-native.ts`), the standalone pages/routes, `standalone-html.ts`, and
   `vscode-stub.ts`.
4. **Rebuild every feature row** from that analysis (no append-only preservation). Paste the
   tripwire counts into the appendix.

**Remove from SKILL.md:** all append-only-ledger language, bucket-letter rules, the
"never add a merge-debt bucket / mark SHIPPED in place / never renumber" convention, and the
"Appending new buckets" framing. **Keep** the features-only scoping rule (exclude bug fixes,
refactors, dep bumps, tests, infra) — reframed as "a feature row is a user-facing capability;
these non-features never get a row."

**Update these SKILL.md subsections accordingly:**
- "Workflow" step 4 (above).
- "Degrees of freedom" — drop "appending a new feature bucket / append-only ledger"; add
  "full feature inventory rebuild grounded in code; is-this-a-user-facing-feature judgment."
- "Common mistakes" — drop the two bucket-ledger mistakes; add feature-list mistakes (e.g.
  "marking ✅ from an allowlist entry without confirming a working UI path"; "assuming status
  instead of reading code").
- "Scripts" table — `parity-gap.mjs` description changes to "tripwire signal (counts / new
  methods / degradations) feeding the feature-inventory rebuild."

**Frontmatter description:** update wording from "regenerating STANDALONE-PARITY-GAPS"
(bucket ledger) to the feature-inventory framing; keep the same triggers.

## 7. `report-template.md` rewrite

Replace the bucket sections (A–E) and "Appending new buckets" rules with the feature-inventory
template: status legend, staleness banner placeholder, one grouped table per functional area
(`Feature | Standalone | Note`), and the tripwire appendix placeholder. Mark which parts are
**[AUTO]** (tripwire counts banner) vs **[HUMAN/analysis]** (the feature rows and statuses).

## 8. `parity-gap.mjs` changes

Functionally **kept** — its universe/exposed/gap computation, new-method detection, and
degradation cross-reference remain valuable as a tripwire. Changes:
- Update the header comment (lines ~11–13) to state it is now a **tripwire/grounding signal**
  feeding the feature-inventory rebuild, not the doc's structure.
- Reconcile the regression baselines that the current doc already flags as expected drift:
  `V1_SERVICE_ALLOWED` baseline 12 → 15, `exposed` baseline 65 → 68 (so the tripwire reports
  `OK` instead of stale `DRIFT`). Confirm the live counts during implementation before bumping.

## 9. Memory updates

After implementation, update the two auto-memories that describe the old system so they don't
mislead future sessions:
- `parity-gaps-bucket-ledger.md` — rewrite to describe the feature-inventory model (no buckets,
  rebuilt every sync, four-state status).
- `upstream-merge-strategy-and-skill.md` — adjust the parity-gap sentence to the new model.

## 10. Acceptance criteria

1. `STANDALONE-PARITY-GAPS.md` contains **no** bucket letters, append-only-ledger language, or
   difficulty/Effect/Priority columns; it is a grouped feature inventory with the 4-state
   legend and a tripwire appendix.
2. Every feature row's status is grounded in code read in both repos during the rebuild — no
   assumed statuses. Spot-checkable via the Note column's source refs.
3. The inventory is **complete**: VS Code-only features appear as ⛔ rows; partial features as
   ⚠️ with a note; the preserved degradations and LLM transparency text are present.
4. `SKILL.md`, `report-template.md` carry the feature-inventory mechanic; no bucket/ledger
   instructions remain. The fetch/drift/guarded-merge/land steps are unchanged.
5. `parity-gap.mjs` still runs and prints; its comment reflects the tripwire role; baselines
   reconciled so a clean tree reports `OK`.
6. The two memories reflect the new model.

## 11. Out of scope

- Renaming the doc file.
- Any change to fetch/drift-gate/guarded-merge logic or the additive-only invariant.
- Implementing any of the ❌ features themselves (this is about the tracking system, not
  closing gaps).
