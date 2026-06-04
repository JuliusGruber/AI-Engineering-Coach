# Standalone Feature Parity Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the append-only **bucket ledger (A–E)** in `docs-fork/STANDALONE-PARITY-GAPS.md` and the `merging-upstream` skill with a **complete, code-grounded feature inventory** (✅/⚠️/❌/⛔ per upstream feature, rebuilt every sync), demoting `parity-gap.mjs` from "the doc's structure" to a supporting tripwire.

**Architecture:** This is a **documentation + skill-text refactor**, not application code. The only executable change is reconciling two regression baselines in `parity-gap.mjs` (which still runs unchanged otherwise) and updating its header comment. "Tests" here are (a) running `parity-gap.mjs` and confirming it prints `OK`, and (b) `git grep` assertions that bucket/ledger language is gone. Each task is self-contained and ends in a commit.

**Tech Stack:** Markdown (docs + skill files), one Node ESM script (`parity-gap.mjs`), `git grep` / `node` for verification. Repo is a Windows checkout; `node` runs cross-platform via PowerShell, and the `merging-upstream` `.sh` scripts run via the Bash tool / git-bash. Auto-memory files live **outside** the repo at `C:\Users\juliu\.claude\projects\C--Users-juliu-IdeaProjects-AI-Engineering-Coach\memory\` and are **not** committed to git.

**Source design:** `docs-fork/superpowers/spec/2026-06-04-standalone-feature-parity-redesign-design.md` (Status: Approved design). Read it before starting — this plan implements its sections 5–10 against acceptance criteria 1–6.

---

## Scope note & one deviation from the spec's literal "Affects" list

The design's **Affects** line names: `STANDALONE-PARITY-GAPS.md`, `SKILL.md`, `report-template.md`, `scripts/parity-gap.mjs`, and two auto-memories. **It omits `.claude/skills/merging-upstream/reference.md`.** But `reference.md` §5 ("Parity-gap algorithm") contains explicit append-only-bucket-ledger instructions, and `SKILL.md`'s last line tells the reader to *"read `reference.md`"* for the parity algorithm in full. Leaving it would directly contradict the new model and undermine acceptance criterion 4 ("no bucket/ledger instructions remain"). **Task 4 therefore updates `reference.md` §5** — a small, justified extension of the spec's scope. If the user wants `reference.md` left untouched, skip Task 4; everything else stands.

No other files are touched. The fetch/drift-gate/guarded-merge/land machinery and the additive-only invariant are **untouched** (design §3, §11).

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `.claude/skills/merging-upstream/scripts/parity-gap.mjs` | RPC-surface tripwire (counts / new methods / degradations) | Header comment reworded; `BASELINE` reconciled `service 12→15`, `exposed 65→68` |
| `.claude/skills/merging-upstream/report-template.md` | The blank template the skill fills each rebuild | Full rewrite: bucket A–E sections → feature-inventory template with `[AUTO]`/`[HUMAN/analysis]` marks |
| `.claude/skills/merging-upstream/SKILL.md` | The merge workflow | Step 4 rewritten; Degrees-of-freedom, Common-mistakes, Scripts-table, frontmatter updated |
| `.claude/skills/merging-upstream/reference.md` | The "why it's safe" detail | §5 bucket-ledger paragraph → feature-inventory; baseline `52/12/1/65 → 52/15/1/68` |
| `docs-fork/STANDALONE-PARITY-GAPS.md` | The parity doc itself | Full rebuild: bucket ledger → grouped feature inventory + tripwire appendix |
| `…/memory/parity-gaps-bucket-ledger.md` | Auto-memory describing the old model | Rewrite to feature-inventory model (filename + `name:` slug kept so `[[links]]` survive) |
| `…/memory/upstream-merge-strategy-and-skill.md` | Auto-memory: merge strategy + skill | Parity-gap bullet adjusted to tripwire + counts `65→68` |
| `…/memory/MEMORY.md` | Auto-memory index | Two pointer lines reworded |

---

## Task 1: Reconcile the `parity-gap.mjs` tripwire (baseline + header)

Do this first: the rebuilt doc's appendix pastes this script's output, so it must print `OK` (no stale `DRIFT`) before the rebuild.

**Files:**
- Modify: `.claude/skills/merging-upstream/scripts/parity-gap.mjs:11-13` (header comment) and `:25` (`BASELINE`)

- [ ] **Step 1: Confirm the live counts before bumping the baseline** (design §8 says "confirm before bumping")

Run (PowerShell or any shell, from repo root):

```
node .claude/skills/merging-upstream/scripts/parity-gap.mjs
```

Expected: the counts block shows `V1_SERVICE_ALLOWED = 15` and `exposed (union) = 68`, each currently flagged `DRIFT (baseline 12)` / `DRIFT (baseline 65)`. `V1_ALLOWED = 52` and `STANDALONE_NATIVE = 1` already read `OK`. If the live `service`/`exposed` numbers are **not** 15/68, STOP — use the live numbers in Step 3 instead and note the discrepancy.

> Requires `upstream/main` to resolve. If the script throws on `git merge-base`, first run `bash .claude/skills/merging-upstream/scripts/fetch-upstream.sh` to add the remote, then retry.

- [ ] **Step 2: Reword the header comment to the tripwire role**

Replace lines 11–13:

```js
// Prints a report to stdout. It does NOT overwrite docs-fork/STANDALONE-PARITY-GAPS.md —
// that doc carries human bucket A–F / difficulty / Effect curation; the skill drafts it
// from report-template.md using this output.
```

with:

```js
// Prints a report to stdout. It does NOT overwrite docs-fork/STANDALONE-PARITY-GAPS.md —
// that doc is a human feature inventory (✅/⚠️/❌/⛔ per upstream feature, grounded in code).
// This script is a TRIPWIRE / grounding signal (counts, new methods, silent degradations)
// feeding the feature-inventory rebuild; the skill pastes its counts into the doc's appendix.
```

- [ ] **Step 3: Reconcile the regression baselines**

Replace line 25:

```js
const BASELINE = { v1: 52, service: 12, native: 1, exposed: 65 };
```

with:

```js
const BASELINE = { v1: 52, service: 15, native: 1, exposed: 68 };
```

- [ ] **Step 4: Re-run to verify a clean tree reports `OK`** (acceptance criterion 5)

Run:

```
node .claude/skills/merging-upstream/scripts/parity-gap.mjs
```

Expected: **all four** count lines now read `OK` (no `DRIFT`). The `gap` list and `newly-appeared upstream methods` section are unchanged. Keep this stdout — Task 5 pastes its counts block into the doc appendix.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/merging-upstream/scripts/parity-gap.mjs
git commit -m "refactor(skill): demote parity-gap.mjs to a tripwire; reconcile baselines 15/68"
```

---

## Task 2: Rewrite `report-template.md` to the feature-inventory template

**Files:**
- Modify (full overwrite): `.claude/skills/merging-upstream/report-template.md`

- [ ] **Step 1: Replace the entire file with the feature-inventory template** (design §7)

Overwrite `.claude/skills/merging-upstream/report-template.md` with exactly:

````markdown
# Parity report template

The format for `docs-fork/STANDALONE-PARITY-GAPS.md`. This doc is a **complete, user-facing
feature inventory** of the upstream extension, **rebuilt from a full re-analysis of both repos
on every sync** — regenerated, not patched. There are **no buckets, no append-only ledger, and
no difficulty/Effect/Priority columns**.

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
````

- [ ] **Step 2: Verify no bucket/ledger language remains in the template**

Run:

```
git grep -n -i -e bucket -e "append-only" -e ledger -- .claude/skills/merging-upstream/report-template.md
```

Expected: **no output** (exit code 1 / "no matches").

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/merging-upstream/report-template.md
git commit -m "refactor(skill): rewrite report-template to a feature-inventory format"
```

---

## Task 3: Rewrite the `merging-upstream` SKILL.md (step 4 + supporting subsections)

**Files:**
- Modify: `.claude/skills/merging-upstream/SKILL.md` — frontmatter description, step 4, Degrees of freedom, Common mistakes, Scripts table

- [ ] **Step 1: Update the frontmatter description** (design §6, "Frontmatter description")

Replace (lines 3–9):

```yaml
description: >-
  Use when syncing this fork with upstream, merging upstream/main, checking
  standalone parity gaps, regenerating STANDALONE-PARITY-GAPS, or auditing whether
  fork-authored edits have leaked outside src/standalone/. Triggers: "sync upstream",
  "merge upstream/main", "parity gaps", "what features is the fork missing",
  "check the additive-only invariant", "drift gate".
```

with:

```yaml
description: >-
  Use when syncing this fork with upstream, merging upstream/main, checking
  standalone parity gaps, rebuilding the STANDALONE-PARITY-GAPS feature inventory,
  or auditing whether fork-authored edits have leaked outside src/standalone/.
  Triggers: "sync upstream", "merge upstream/main", "parity gaps",
  "what features is the fork missing", "check the additive-only invariant", "drift gate".
```

- [ ] **Step 2: Rewrite step 4 (DRAFT REPORT → REBUILD FEATURE INVENTORY)** (design §6, step 4)

Replace the entire step-4 block (lines 64–77, beginning `4. **DRAFT REPORT**` and ending `…by the implementing agent, never removed.`):

```markdown
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
```

with:

```markdown
4. **REBUILD FEATURE INVENTORY** — Regenerate `docs-fork/STANDALONE-PARITY-GAPS.md` from
   `report-template.md` by **re-analyzing both repos and rebuilding every feature row** (the
   inventory is regenerated, not patched — there are no buckets and no append-only history):
   a. **Tripwire** — read step 3's `parity-gap.mjs` output (new RPC methods? silent
      degradations? count drift?) and paste its counts block into the doc's appendix.
   b. **Enumerate upstream features** — re-read the whole upstream surface: nav/routes
      (`src/webview/panel-html.ts`), `src/webview/page-*.ts`, `package.json` `contributes.*`
      (commands / menus / viewsContainers / views), `src/chat/*`, `src/mcp/*`. List every
      user-facing capability.
   c. **Determine standalone status** — for each feature, read the standalone exposure
      (`v1-allowed.ts`, `v1-service-allowed.ts`, `standalone-native.ts`, the standalone
      pages/routes, `standalone-html.ts`, `vscode-stub.ts`) and mark it
      **✅ implemented / ⚠️ partial / ❌ not implemented / ⛔ VS Code-only**. **Never mark ✅
      from an allowlist entry alone — confirm a working UI path.** Never assume a status; read
      the code. Put the grounding source ref (or the degradation / blocker) in the Note.
   d. **Group by functional area**, one `## <area>` table per area (`Feature | Standalone |
      Note`). A row is a **user-facing capability**; bug fixes, refactors, dep bumps, tests,
      infra, and build details never get a row (a non-portable *feature* does, marked ⛔). Git
      *sync status* (how far behind upstream) is **not** a row — it's step 1's `behind` count
      + step 2's drift gate. Retain the **LLM data-flow / configuration transparency** note
      verbatim under the LLM provider tier.
```

- [ ] **Step 3: Update the "Degrees of freedom" High bullet**

Replace (lines 137–140):

```markdown
- **High (your judgment):** drift classification (upstream-it vs re-merge), **appending** a
  new feature bucket per surfaced upstream feature (append-only ledger — never renumber/delete),
  is-this-a-feature vs a fix/refactor when scanning the upstream delta, the report narrative,
  conflict triage.
```

with:

```markdown
- **High (your judgment):** drift classification (upstream-it vs re-merge), the **full feature
  inventory rebuild grounded in code** (enumerate upstream features, read the standalone
  exposure, assign ✅/⚠️/❌/⛔), the is-this-a-user-facing-feature judgment, the report
  narrative, conflict triage.
```

- [ ] **Step 4: Replace the two bucket-ledger "Common mistakes" bullets with feature-list mistakes**

Replace (lines 163–170, the two bullets beginning `- **Adding a "merge debt"…` and ending `…Never reorganize the ledger.`):

```markdown
- **Adding a "merge debt" / "fork is behind upstream" bucket to the parity report** → being
  behind is a *sync status* (step 1's `behind` count + the drift gate), not a standalone
  parity gap. Only add to `STANDALONE-PARITY-GAPS.md` when upstream shipped **new
  functionality** `src/standalone/` doesn't implement — and only *features*, never bug fixes,
  refactors, dep bumps, tests, infra, or VS Code-only surfaces.
- **Renumbering, merging, or deleting buckets** → the bucket list is an **append-only ledger**.
  Each new feature gets the next free letter (one bucket per feature); an implemented one is
  marked `SHIPPED (<date>)` **in place** by the implementing agent. Never reorganize the ledger.
```

with:

```markdown
- **Tracking "fork is behind upstream" as a feature row** → being behind is a *sync status*
  (step 1's `behind` count + the drift gate), not a parity gap. A feature row is a *user-facing
  capability*; bug fixes, refactors, dep bumps, tests, and infra never get a row.
- **Marking ✅ from an allowlist entry without confirming a working UI path** → an allowlisted
  method with no standalone caller is ⚠️ (exposed-but-unreachable), not ✅. Read the standalone
  page/route, not just the allowlist Set.
- **Assuming a status instead of reading code** → every ✅/⚠️/❌/⛔ must be grounded in code read
  in both repos during the rebuild. The Note carries the source ref so the next rebuild can
  re-check it.
```

- [ ] **Step 5: Update the Scripts-table row for `parity-gap.mjs`**

Replace (line 148):

```markdown
| `scripts/parity-gap.mjs` | `universe \ exposed` gap, counts, degradations, new-method delta | no |
```

with:

```markdown
| `scripts/parity-gap.mjs` | tripwire signal (counts / new methods / degradations) feeding the feature-inventory rebuild | no |
```

- [ ] **Step 6: Verify no bucket/ledger language remains in SKILL.md**

Run:

```
git grep -n -i -e bucket -e "append-only" -e ledger -- .claude/skills/merging-upstream/SKILL.md
```

Expected: **no output** (exit 1).

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/merging-upstream/SKILL.md
git commit -m "refactor(skill): SKILL.md step 4 rebuilds a feature inventory, drops bucket ledger"
```

---

## Task 4: Update `reference.md` §5 to the feature-inventory model

> Scope extension beyond the spec's literal Affects list — see the Scope note at the top. Skip this task if the user wants `reference.md` untouched.

**Files:**
- Modify: `.claude/skills/merging-upstream/reference.md` — §5 baseline mention (~line 109) and the "What stays human" paragraph (lines 118–127)

- [ ] **Step 1: Update the baseline tuple in the comment-strip bullet**

Replace (in §5, the sentence ending the comment-strip bullet):

```markdown
  the count and inflates it. The recorded baseline (`52 / 12 / 1 / 65`) is the regression
  assertion that proves the parser counted the Set *literally*, not the header comment.
```

with:

```markdown
  the count and inflates it. The recorded baseline (`52 / 15 / 1 / 68`) is the regression
  assertion that proves the parser counted the Set *literally*, not the header comment.
```

- [ ] **Step 2: Rewrite the "What stays human" bucket-ledger paragraph**

Replace the entire `- **What stays human:**` bullet (lines 118–127):

```markdown
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
```

with:

```markdown
- **What stays human:** the feature inventory itself — enumerating every user-facing upstream
  feature and assigning each a **✅/⚠️/❌/⛔** status grounded in code read in both repos, plus
  the portability calls and Note prose. New **non-RPC** upstream functionality is invisible to
  the allowlist diff — catch it by re-reading the upstream surface (nav, `page-*.ts`,
  `contributes.*`, `src/chat/*`, `src/mcp/*`) on every rebuild, not just the RPC delta. The
  inventory is **rebuilt every sync** (regenerated, not patched). How far behind upstream the
  fork is, is a *sync status* (`fetch-upstream.sh` / `drift-gate.sh`), **not** a feature row.
  This script **proposes** auto-signals (counts, new methods, degradations); a human grounds
  every row.
```

- [ ] **Step 3: Verify no bucket/ledger language remains in reference.md**

Run:

```
git grep -n -i -e bucket -e "append-only" -e ledger -- .claude/skills/merging-upstream/reference.md
```

Expected: **no output** (exit 1).

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/merging-upstream/reference.md
git commit -m "refactor(skill): reference.md §5 describes the feature inventory, not the ledger"
```

---

## Task 5: Rebuild `docs-fork/STANDALONE-PARITY-GAPS.md` as a grounded feature inventory

This is the substantive task. The draft below is **seeded** from the prior (code-grounded) doc, the allowlist contents, and the upstream nav/page enumeration — but per design acceptance criterion 2, **every status must be re-confirmed against code during this task**. Rows tagged `⟨verify⟩` are not yet confirmed against a working standalone UI path; resolve each before finalizing.

**Files:**
- Modify (full overwrite): `docs-fork/STANDALONE-PARITY-GAPS.md`

**Grounding sources to read while rebuilding (the analysis checklist):**

- **Upstream feature surfaces:** `src/webview/panel-html.ts` (nav groups: Observe/Measure/Improve + routes), `src/webview/page-*.ts` (26 page files: dashboard, patterns, output, burndown, timeline, antipatterns, antipatterns-editor, antipatterns-heatmap, rule-editor, skills, config, experiments, data-explorer, rule-playground, image-gallery, achievements, context-mgmt, dsl-reference, insights, learning, learning-snake, learning-state, learning-templates, peers, sdlc, workflows), `package.json` `contributes.*` (commands `open`/`reload`/`exportSummary`/`reviewLocalRules`; viewsContainers `aiEngineerCoach`; view `aiEngineerCoach.welcome`; chat participant `aiEngineerCoach.aicoach` + slash summary/improve/compare/flow; 12 `aiEngineerCoach_*` language-model tools), `src/chat/participant.ts` + `src/chat/system-prompt.ts`, `src/mcp/tools.ts` + `src/mcp/formatters.ts`.
- **Standalone exposure:** `src/standalone/v1-allowed.ts` (52 read/registry/NL-rule/rule-editor methods), `src/standalone/v1-service-allowed.ts` (15: 4 learning + 3 skill-triage + `generateSkillContent` + `reviewContextFiles` + `discoverCatalog` + `installSkill`/`installCatalogItem`/`exportSummary` + `getSdlcToolAnalysis`/`getSdlcRepoScan`/`getWorkspaceDeps`), `src/standalone/standalone-native.ts` (1: `openExternal`), `src/standalone/standalone-html.ts` (CSP/token/script swap + injected "Explore" nav group: Data Explorer + Rule Playground), `src/standalone/vscode-stub.ts` (stubs `Uri`/`workspace`/`window`/`env`/`lm`/`LanguageModelChatMessage`/`CancellationTokenSource`/`CancellationError`), `src/standalone/llm-provider.ts`, `src/standalone/llm-unavailable.ts`, `src/standalone/request-service-bridge.ts`, `src/standalone/image-route.ts`.

- [ ] **Step 1: Resolve the `⟨verify⟩` rows against code**

For each `⟨verify⟩` row in the Step 2 draft, read the standalone routing/exposure and confirm or correct the status. The known-uncertain rows are:
- **Insights** — `getInsights` is in `v1-allowed.ts`; confirm a standalone route reaches `page-insights.ts` (it is not in the upstream nav group list). ✅ only if reachable.
- **Peers / leaderboard** — `page-peers.ts` exists upstream; confirm whether any peer/leaderboard RPC method is in any allowlist tier (none was found in the enumeration). If none and no standalone route → **❌**; if it's a VS Code-only social surface → reconsider, but default **❌** unless code says otherwise.
- **Achievements / DSL reference / heatmap / learning sub-pages / context-mgmt / workflows** — confirm each is either reachable in standalone (✅) or has no standalone route (❌). Use `git grep -n data-page src/standalone/standalone-html.ts` and the standalone webview app routing to see which `page-*` the standalone build actually renders.

Record the resolved status + the grounding ref in each row's Note. Delete the `⟨verify⟩` tag once resolved.

- [ ] **Step 2: Overwrite the doc with the rebuilt inventory**

Overwrite `docs-fork/STANDALONE-PARITY-GAPS.md` with the following (correcting any `⟨verify⟩` rows per Step 1, and pasting the **live** `parity-gap.mjs` counts from Task 1 Step 4 into the appendix):

````markdown
# Standalone Feature Parity (upstream → fork)

A complete, user-facing **feature inventory** of the upstream `microsoft/AI-Engineering-Coach`
extension, each feature marked with its status in this fork's **standalone build**. Rebuilt
from a full re-analysis of both repos on every sync — the table is regenerated, not patched.
**Grounding:** every status below was established by reading code in both repos (the upstream
nav/pages/`contributes.*`/chat/mcp and the standalone allowlists, routes, pages, and stubs);
the grounding ref is in each Note.

**Staleness** — derived `89c7688` (merge-base **==** upstream/main) → re-verified `89c7688`,
**0 behind** (synced 2026-06-04). If `git rev-parse upstream/main` ≠ `89c7688`, regenerate
(run the `merging-upstream` skill, step 4).

**Legend** — ✅ implemented · ⚠️ partial · ❌ not implemented · ⛔ VS Code-only

> **Scope.** Functional parity only. Git **sync status** (how far behind `upstream/main` the
> fork is) is **not** a feature row — it's owned by `fetch-upstream.sh` (behind count) and
> `drift-gate.sh`. The fork is **purely additive**: all fork code lives in `src/standalone/`,
> so `git diff $(git merge-base HEAD upstream/main) HEAD -- src/ ':(exclude)src/standalone/'`
> is empty.

## Core dashboards & output
| Feature | Standalone | Note |
|---|---|---|
| Dashboard | ✅ | read getters in `v1-allowed.ts` (`getStats`/`getWorkspaces`/…); default nav route in `panel-html.ts` (Observe group) |
| Timeline | ✅ | `getDayTimeline`/`getSessions`/`getSessionDetail` (`v1-allowed.ts`) |
| Coding Moments (image gallery) | ✅ | `getImageGallery`/`getSessionImages` (`v1-allowed.ts`); standalone `image-route.ts` serves the images |
| Anti-Patterns (read view) | ✅ | `getAntiPatterns` (`v1-allowed.ts`); Improve nav group |
| Output (code production) | ✅ | `getCodeProduction` (`v1-allowed.ts`); Measure nav group |
| Context Health | ✅ | `getConfigHealth` (`v1-allowed.ts`); "Context Health" in Improve group |
| Context Management | ✅ | `getContextManagement`/`getWorkspaceContextSessions`/`getContextRangeAvailability` (`v1-allowed.ts`) |
| Workflows | ✅ | `getWorkflowOptimization` (`v1-allowed.ts`) |
| Level Up (experiments / achievements) | ✅ | read getters; SDLC badge populates (`page-experiments.ts:221`) |
| Insights | ✅ ⟨verify⟩ | `getInsights` allowlisted (`v1-allowed.ts`) — confirm a standalone route reaches `page-insights.ts` |
| Peers / leaderboard | ❌ ⟨verify⟩ | `page-peers.ts` upstream; no peer/leaderboard method found in any allowlist tier — confirm absent then mark ❌ |

## Token & cost reporting
| Feature | Standalone | Note |
|---|---|---|
| Burndown chart | ⚠️ | renders via the `FF_TOKEN_REPORTING_ENABLED` build override (`standalone-constants.ts` + esbuild `onResolve` redirect; published extension stays FF=false); model-budget save/load degraded — see Model-budget persistence row |
| Output Token-Usage tab | ✅ | same FF override flips the tab on in standalone |
| AI credits / credit burndown | ✅ | `getAiCredits`/`getAiCreditBurndown` (`v1-allowed.ts`) |
| Token coverage | ✅ | `getTokenCoverage` (`v1-allowed.ts`) |
| Model-budget persistence | ❌ | `saveModelBudgets`/`loadModelBudgets` NOT exposed (`page-burndown.ts:95,103`); chart works, budgets don't persist across reloads |

## Rules & anti-patterns authoring
| Feature | Standalone | Note |
|---|---|---|
| Rule Editor (create / edit / tune / live-test) | ✅ | `getRuleEditor`/`getRuleSource`/`getRulePreview`/`saveRule`/`updateRuleThreshold`/`testRuleLive` (`v1-allowed.ts`); `saveRule` writes via Node fs |
| Anti-Patterns Editor | ✅ | editable markdown rules + threshold tuning via `saveRule`/`updateRuleThreshold` (`page-antipatterns-editor.ts`) |
| Export Summary | ✅ | `exportSummary` (`v1-service-allowed.ts`) via request-service bridge (`COACH_EXPORT_DIR` / browser download) |
| Import registry rules | ⚠️ | `importRegistryRules` allowlisted (`v1-allowed.ts`) but exposed forward-only — no standalone UI page calls it yet; a write flow would reuse the shipped `saveRule` |
| Local-rule trust approval | ❌ | `reviewLocalRules` NOT exposed (verified absent from all three tiers); was a VS Code quick-pick (`extension.ts:79`) backed by a `globalState` Memento (`rule-trust.ts:44`). Degrades the shipped Anti-Patterns "review pending rules" button (`page-antipatterns.ts:1025`) — needs a browser modal + standalone trust store |

## Skills (install / discover / triage / generate)
| Feature | Standalone | Note |
|---|---|---|
| Skill install | ✅ | `installSkill`/`installCatalogItem` (`v1-service-allowed.ts`) via bridge |
| Skill discovery | ✅ | `discoverCatalog` (`v1-service-allowed.ts`) |
| Skill triage | ✅ | `triageSkills`/`triageCatalog` (`v1-service-allowed.ts`) |
| Skill content generation | ✅ | `generateSkillContent` (`v1-service-allowed.ts`) |
| Create skill | ⚠️ | `createSkill` opens VS Code chat — not an LLM call; degraded in standalone |

## Learning Center
| Feature | Standalone | Note |
|---|---|---|
| Learning quizzes | ✅ | `generateLearningQuiz` (`v1-service-allowed.ts`) via bridge |
| Code comparison | ✅ | `generateCodeComparison` (`v1-service-allowed.ts`) |
| Did-You-Know | ✅ | `generateDidYouKnow` (`v1-service-allowed.ts`) |
| Learning resources | ✅ | `generateLearningResources` (`v1-service-allowed.ts`) |
| Quiz personalization | ⚠️ | uses `getWorkspaceDeps` (`page-learning.ts:686`); real deps for all harnesses once a session records a directory (`workspaceRootPath`: `parser-claude.ts`/`parser-opencode.ts`/`parser-codex.ts`, upstream `cb61436`/#86), generic fallback when no resolvable directory was recorded |

## Data exploration & rule playground
| Feature | Standalone | Note |
|---|---|---|
| Data Explorer | ✅ | `getDataExplorer` (`v1-allowed.ts`) + nav link injected by `standalone-html.ts` (deep-link-only upstream) |
| Rule Playground (eval) | ✅ | `evaluateExpression` (`v1-allowed.ts`) + nav link injected (same injected "Explore" group) |
| NL→rule compile | ✅ | `compileNlRule` (`v1-allowed.ts`); degrades to a heuristic template offline (never errors) |
| Explain occurrence / generate rule | ✅ | `explainOccurrence`/`generateRule` (`v1-allowed.ts`); `generateRule` has a template fallback offline |

## LLM provider tier (cross-cutting enabler)
| Feature | Standalone | Note |
|---|---|---|
| LLM provider wiring | ✅ | `vscode.lm` implemented in `vscode-stub.ts` over `llm-provider.ts` (Anthropic/OpenAI, non-streaming, auto-detected by `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`); one seam lights up `panel-llm.ts` + `core/rule-compiler.ts` with zero core edits |
| AI context-file review | ✅ | `reviewContextFiles` (`v1-service-allowed.ts`) via bridge; the `reviewProgress` event is forwarded over WebSocket to the requesting socket |
| No-key fallback | ✅ | LLM methods surface a standalone hint ("Set ANTHROPIC_API_KEY or OPENAI_API_KEY to enable AI features.", `llm-unavailable.ts`) instead of the upstream Copilot string; `compileNlRule`/`generateRule` fall back to heuristic/template |

> **Data flow & configuration (transparency — retained verbatim).** AI features send your
> prompts, code snippets, and — for context review — your instruction-file contents
> (`CLAUDE.md` and friends) to the configured LLM provider; this is the same data flow as the
> VS Code extension's Copilot path. Provider and key are auto-detected from `ANTHROPIC_API_KEY`
> / `OPENAI_API_KEY`. `COACH_LLM_BASE_URL` redirects requests (carrying your API key) to that
> host — intended for proxies and local models, so point it only at a host you trust.
> `COACH_LLM_MODEL` / `COACH_LLM_MAX_TOKENS` / `COACH_LLM_TIMEOUT_MS` tune the model, output
> ceiling, and request timeout.

## Agentic SDLC
| Feature | Standalone | Note |
|---|---|---|
| SDLC local scans (tool analysis / repo scan / deps) | ✅ | `getSdlcToolAnalysis`/`getSdlcRepoScan`/`getWorkspaceDeps` (`v1-service-allowed.ts`) via bridge; the SDLC tab renders. Repo-scan + deps populate for all harnesses when the session recorded a resolvable directory (`workspaceRootPath`); the "No workspace repos resolved" empty state remains only for sessions with no resolvable root |
| SDLC GitHub data | ❌ | `getSdlcGitHubData` needs GitHub auth/network (`vscode.authentication.getSession('github', …)` + outbound fetch) and has no call site in `page-sdlc.ts` — the sole remaining deferred SDLC method |

## Project-scoped analysis
| Feature | Standalone | Note |
|---|---|---|
| Project-scoped rules (`coach --project <path>`) | ❌ | core `rule-loader` already accepts `workspaceRoot`; needs a standalone route to set it |

## VS Code-only surfaces (⛔ — structurally non-portable, intentionally out of scope)
| Feature | Standalone | Note |
|---|---|---|
| Activity-bar sidebar | ⛔ | `contributes.viewsContainers` `aiEngineerCoach` + `views` `aiEngineerCoach.welcome` (webview) — no browser equivalent |
| `@aicoach` chat participant | ⛔ | `src/chat/participant.ts` + slash commands (summary / improve / compare / flow) — requires the VS Code chat sidebar |
| MCP language-model tools | ⛔ | `src/mcp/tools.ts` (12 `aiEngineerCoach_*` tools) — requires an MCP host / the VS Code LM API |

## Appendix — RPC surface tripwire (machine signal)

Paste the live `parity-gap.mjs` header + counts (from Task 1) on every rebuild. Supporting
signal only — not the doc's structure.

```
<paste the parity-gap.mjs header line + counts block here>
V1_ALLOWED         = 52   OK
V1_SERVICE_ALLOWED = 15   OK
STANDALONE_NATIVE  = 1    OK
exposed (union)    = 68   OK
universe (upstream)= 75
gap                = 7   (universe \ exposed)
```

Newly-appeared upstream RPC methods needing an allowlist decision: **none** (the upstream RPC
surface is unchanged since the merge-base) — confirm against the script's "ALLOWLIST DECISION
NEEDED" section on each rebuild.
````

> Paste the **actual** stdout from Task 1 Step 4 into the appendix code block (header line + counts), replacing the illustrative block above if the live numbers differ.

- [ ] **Step 3: Verify the doc satisfies acceptance criteria 1 & 3**

Run, expecting **no output** (no bucket/ledger/Effect/Priority columns remain — criterion 1):

```
git grep -n -i -e bucket -e "append-only" -e ledger -e "Effect" -e "Priority" -- docs-fork/STANDALONE-PARITY-GAPS.md
```

Run, expecting matches for the legend, ⛔ rows, the transparency note, and a degradation (criterion 3) — each command should print ≥1 line:

```
git grep -n "VS Code-only" -- docs-fork/STANDALONE-PARITY-GAPS.md
git grep -n "⛔" -- docs-fork/STANDALONE-PARITY-GAPS.md
git grep -n "retained verbatim" -- docs-fork/STANDALONE-PARITY-GAPS.md
git grep -n "saveModelBudgets" -- docs-fork/STANDALONE-PARITY-GAPS.md
```

Confirm visually that **no `⟨verify⟩` tags remain** in the file (all resolved in Step 1):

```
git grep -n "verify" -- docs-fork/STANDALONE-PARITY-GAPS.md
```

Expected: no `⟨verify⟩` occurrences (the word may appear in prose, but no `⟨verify⟩` status tags).

- [ ] **Step 4: Commit**

```bash
git add docs-fork/STANDALONE-PARITY-GAPS.md
git commit -m "docs(fork): rebuild STANDALONE-PARITY-GAPS as a grounded feature inventory"
```

---

## Task 6: Update the two auto-memories + the memory index

> Auto-memory files live **outside the repo** at `C:\Users\juliu\.claude\projects\C--Users-juliu-IdeaProjects-AI-Engineering-Coach\memory\`. They are edited with Write/Edit but are **not** part of any git commit. No commit step for this task.

**Files:**
- Modify (overwrite body): `…/memory/parity-gaps-bucket-ledger.md` (keep filename + `name:` slug so `[[parity-gaps-bucket-ledger]]` links survive)
- Modify: `…/memory/upstream-merge-strategy-and-skill.md` (parity-gap bullet)
- Modify: `…/memory/MEMORY.md` (two index lines)

- [ ] **Step 1: Rewrite `parity-gaps-bucket-ledger.md`** (design §9)

Overwrite with (preserve the existing `originSessionId`):

```markdown
---
name: parity-gaps-bucket-ledger
description: "STANDALONE-PARITY-GAPS.md is a feature inventory (✅/⚠️/❌/⛔ per upstream feature), rebuilt from a full re-analysis of both repos every sync — NOT an append-only bucket ledger."
metadata:
  node_type: memory
  type: feedback
  originSessionId: 25668a46-9c30-4d29-9d45-fc3e1448bb6b
---

`docs-fork/STANDALONE-PARITY-GAPS.md` is a **complete, user-facing feature inventory** of the
upstream extension. Each upstream feature is one row grouped by functional area, marked with a
four-state status — **✅ implemented / ⚠️ partial / ❌ not implemented / ⛔ VS Code-only** — plus
a Note carrying the degradation, the grounding source ref, or the blocker. The inventory is
**rebuilt from a full re-analysis of both repos on every sync** (regenerated, not patched);
every status is grounded in code actually read in both repos — no assumptions, and never mark
✅ from an allowlist entry without a confirmed working UI path. `parity-gap.mjs` is kept as a
**tripwire** (counts / new RPC methods / silent degradations), demoted to a supporting signal
whose counts paste into the doc's appendix — it no longer defines the doc's structure.

**Why:** the old append-only **bucket ledger (A–E)** was RPC-centric and hard to read at a
glance — it couldn't see non-RPC user-facing features and required decoding method names. The
2026-06-04 redesign
(`docs-fork/superpowers/spec/2026-06-04-standalone-feature-parity-redesign-design.md`) replaced it
with the feature inventory. Buckets, the append-only ledger, and difficulty/Effect/Priority
columns are **gone**. Git *sync status* (how far behind upstream) is still NOT a row — it's
owned by `fetch-upstream.sh` / `drift-gate.sh`.

**How to apply:** Encoded in `.claude/skills/merging-upstream/` (SKILL.md step 4 "REBUILD
FEATURE INVENTORY" + Common mistakes, report-template.md feature-inventory template,
reference.md §5). The doc is fully regenerated each sync, not grown by appended buckets. See
[[upstream-merge-strategy-and-skill]] and [[fork-baseline-diverges-outside-standalone]].
```

- [ ] **Step 2: Adjust the parity-gap bullet in `upstream-merge-strategy-and-skill.md`** (design §9)

Replace the `- **Parity-gap algorithm:**` bullet:

```markdown
- **Parity-gap algorithm:** `gap = keyof ExtensionMethodMap (rpc-types.ts, read
  from `git show upstream/main:`) \ (V1_ALLOWED[52] ∪ V1_SERVICE_ALLOWED[12] ∪
  keys(STANDALONE_NATIVE)[1]) = 65 exposed`; layer FF/vscode/write/deep-link
  tags. Mechanical part regenerates STANDALONE-PARITY-GAPS.md; bucketing +
  difficulty stay human.
```

with:

```markdown
- **Parity-gap algorithm (now a tripwire):** `gap = keyof ExtensionMethodMap (rpc-types.ts,
  read from `git show upstream/main:`) \ (V1_ALLOWED[52] ∪ V1_SERVICE_ALLOWED[15] ∪
  keys(STANDALONE_NATIVE)[1]) = 68 exposed`. As of the 2026-06-04 redesign this is a
  **supporting signal** (counts / new methods / silent degradations), not the doc's structure:
  STANDALONE-PARITY-GAPS.md is now a **feature inventory** (✅/⚠️/❌/⛔ per upstream feature,
  rebuilt from a full re-analysis every sync) — see [[parity-gaps-bucket-ledger]].
```

- [ ] **Step 3: Update the two `MEMORY.md` index lines**

Replace the `parity-gaps-bucket-ledger.md` pointer line:

```markdown
- [Parity-gaps bucket ledger](parity-gaps-bucket-ledger.md) — STANDALONE-PARITY-GAPS.md buckets are append-only (one per surfaced upstream feature, marked SHIPPED in place); merging-upstream never adds merge-debt/"behind upstream" buckets, only new-feature buckets (2026-05-30).
```

with:

```markdown
- [Parity-gaps feature inventory](parity-gaps-bucket-ledger.md) — STANDALONE-PARITY-GAPS.md is a feature inventory (✅/⚠️/❌/⛔ per upstream feature), rebuilt from a full re-analysis of both repos every sync; parity-gap.mjs demoted to a tripwire (2026-06-04 redesign).
```

Then, in the `upstream-merge-strategy-and-skill.md` pointer line, replace `parity-gap algorithm (65 exposed)` with `parity-gap algorithm (68 exposed; now a tripwire feeding the feature inventory)`.

- [ ] **Step 4: Verify the memories no longer describe the bucket model**

Run (no commit — memory dir is outside git):

```
grep -ri -l "append-only" "C:/Users/juliu/.claude/projects/C--Users-juliu-IdeaProjects-AI-Engineering-Coach/memory/"
```

Expected: the two updated files (`parity-gaps-bucket-ledger.md`, `upstream-merge-strategy-and-skill.md`) and `MEMORY.md` do **not** appear. (Other memories such as `parity-gaps-bucket-ledger` references in `[[links]]` are fine; the assertion is specifically that these three no longer call the doc an append-only/bucket ledger.)

---

## Task 7: Final acceptance-criteria sweep

**Files:** none (verification only).

- [ ] **Step 1: Run the parity-gap tripwire one final time** (criterion 5)

```
node .claude/skills/merging-upstream/scripts/parity-gap.mjs
```

Expected: all four counts `OK`; the header comment (re-read the file head) reflects the tripwire role.

- [ ] **Step 2: Confirm no bucket/ledger language anywhere in the committed surface** (criteria 1 & 4)

```
git grep -n -i -e bucket -e "append-only" -e ledger -- docs-fork/STANDALONE-PARITY-GAPS.md .claude/skills/merging-upstream/
```

Expected: **no output** (exit 1).

- [ ] **Step 3: Walk the six acceptance criteria from the design** and confirm each:
  1. `STANDALONE-PARITY-GAPS.md` is a grouped feature inventory, 4-state legend, tripwire appendix; no bucket letters / difficulty / Effect / Priority. ✅ (Task 5)
  2. Every row's status grounded in code; spot-checkable via Note source refs; no `⟨verify⟩` left. ✅ (Task 5 Steps 1–3)
  3. Inventory complete: ⛔ VS Code-only rows present, ⚠️ partials with notes, degradations + LLM transparency text retained. ✅ (Task 5)
  4. `SKILL.md` + `report-template.md` (+ `reference.md`) carry the feature-inventory mechanic; no bucket/ledger instructions; fetch/drift/guarded-merge/land steps unchanged. ✅ (Tasks 2–4)
  5. `parity-gap.mjs` still runs and prints; comment reflects the tripwire role; baselines reconciled so a clean tree reports `OK`. ✅ (Task 1)
  6. The two memories reflect the new model. ✅ (Task 6)

- [ ] **Step 4: Confirm the merge machinery was untouched** (design §3 / §11)

```
git diff --stat main -- .claude/skills/merging-upstream/scripts/fetch-upstream.sh .claude/skills/merging-upstream/scripts/drift-gate.sh .claude/skills/merging-upstream/scripts/guarded-merge.sh
```

Expected: **no output** — none of the fetch/drift/guarded-merge scripts changed.

---

## Self-Review (completed by plan author)

**1. Spec coverage** — every design section maps to a task: §5 (doc structure) + §"Migration of existing curated content" → Task 5 (transparency + degradation notes retained verbatim); §6 (SKILL.md: step 4, frontmatter, degrees-of-freedom, common-mistakes, scripts table) → Task 3; §7 (report-template) → Task 2; §8 (parity-gap.mjs header + baselines) → Task 1; §9 (two memories) → Task 6; §10 acceptance criteria 1–6 → Task 7. `reference.md` is an author-added task (Task 4), flagged as a justified extension since the spec's Affects list omitted it but it carries contradicting ledger language.

**2. Placeholder scan** — the only intentional "fill-in" is the appendix counts block in Task 5 (pasted from Task 1's live stdout) and the `⟨verify⟩` rows, which Task 5 Step 1 explicitly resolves before finalizing. These are grounding actions, not placeholders — the design *requires* the inventory be rebuilt from a live read, so a hardcoded final table would contradict acceptance criterion 2.

**3. Type/identifier consistency** — counts are consistent throughout (`V1_ALLOWED=52`, `V1_SERVICE_ALLOWED=15`, `STANDALONE_NATIVE=1`, `exposed=68`, `universe=75`, `gap=7`); method names (`saveModelBudgets`, `getWorkspaceDeps`, `reviewLocalRules`, `getSdlcGitHubData`, `importRegistryRules`) match the allowlist enumeration and the prior doc; the four status markers ✅/⚠️/❌/⛔ are used identically in the doc, template, SKILL.md, reference.md, and the memory.
