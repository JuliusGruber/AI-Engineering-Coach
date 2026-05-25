# Implementation prompt

Paste the block below to drive the standalone-UI implementation plans in
`docs-fork/plans/` to code. It implements exactly one plan per invocation, in
dependency order, on the current branch, and stops for review after each.

It does **not** pick the execution skill itself — it obeys the `REQUIRED SUB-SKILL`
header line inside each plan (currently `superpowers:subagent-driven-development`,
falling back to `superpowers:executing-plans`). It only implements a plan once that
plan is marked `[x]` grilled in `GRILLING-QUEUE.md`.

---

```
Implement ONE standalone-UI plan from docs-fork/plans/ per invocation, on the
CURRENT branch, then STOP for my review. Do not begin the next plan.

GOAL OF EACH RUN:
  Take the next pending, already-grilled plan and turn it into working, committed,
  tested code on the current branch — following the plan's own tasks exactly — then
  stop so I can review the diff before the next plan.

EXECUTION SKILL — do NOT choose it yourself:
  Read the target plan's "REQUIRED SUB-SKILL" header line (near the top of every
  .plan.md) and use whatever skill it names. Today that is
  superpowers:subagent-driven-development (recommended), with
  superpowers:executing-plans as the fallback. If a plan ever names a different
  skill, obey the plan.

BRANCH + CONSENT — this is your explicit consent to implement on the CURRENT branch:
  Do NOT create a new branch or worktree. Do NOT switch branches. Work on whatever
  branch is currently checked out. (If the execution skill warns about implementing
  on main/master, treat THIS instruction as the required explicit consent and
  proceed.)

FINISHING OVERRIDE — do NOT run superpowers:finishing-a-development-branch:
  The execution skills normally end by invoking finishing-a-development-branch to
  merge/PR a feature branch. Skip that entirely. There is no per-plan merge. The
  per-plan STOP below IS the review checkpoint; I handle integration myself.

QUEUE FILES:
  docs-fork/plans/IMPLEMENTATION-QUEUE.md   (what to implement, and what's done)
  docs-fork/plans/GRILLING-QUEUE.md         (the grill gate — read-only here)
If IMPLEMENTATION-QUEUE.md does not exist, create it first with one checkbox line
per spec in the dependency order below (same topological order as PLAN-QUEUE.md):
  # Implementation queue (dependency order)
  - [ ] 06-state
  - [ ] 02-dispatcher
  - [ ] 04-webview-shim
  - [ ] 03-standalone-html
  - [ ] 01-server
  - [ ] 05-cli
  - [ ] 07-build
  - [ ] 08-testing

EACH RUN:
  1. Read docs-fork/plans/IMPLEMENTATION-QUEUE.md. Pick the FIRST entry still
     marked [ ]. That entry — and only that entry — is this run's candidate.
     Do NOT skip ahead to a later entry; dependency order is strict.
  2. GRILL GATE. Read docs-fork/plans/GRILLING-QUEUE.md. If the candidate plan is
     NOT marked [x] grilled there (or its docs-fork/plans/<spec-basename>.plan.md
     does not exist), STOP immediately. Report: "BLOCKED — <plan> is not yet
     grilled; nothing to implement." Do not touch any files. Wait.
  3. Read the candidate plan + docs-fork/specs/00-overview.md + the .plan.md of
     every plan it depends on — enough to honor the interfaces, types, and shared
     additive files (e.g. src/standalone/vscode-stub.ts, the vitest vscode alias,
     the `open` dep) that earlier plans already created. Treat any such shared file
     that already exists as idempotent: reuse it, do not recreate or diverge from it.
  4. Implement the plan task-by-task using the skill named in its REQUIRED SUB-SKILL
     header, on the current branch. Follow the plan's steps exactly, run every
     verification/test the plan specifies, and honor the additive-only fork rule
     (every new line under src/standalone/ except the sanctioned shared edits the
     plan lists). Do not invent decisions — if the plan has a genuine blocker, STOP
     and report it rather than guessing.
  5. When the plan's tasks pass their reviews and verifications, commit the work on
     the current branch (one commit, or a tight series scoped to this plan).
  6. Mark that queue entry as:  - [x] implemented — <plan filename>
  7. STOP. Report in this order:
       VERDICT: IMPLEMENTED or BLOCKED (+ one-line why).
       Tasks completed + final test result (e.g. "vitest run: N passed").
       Anything deferred or left open.
       The commit(s) made (SHA + subject).
       Next pending plan, and whether it is grilled yet.
     Wait for my review before doing anything else.
```

---

## Why this order

Same topological order as `PLAN-QUEUE.md` and `GRILLING-QUEUE.md` — the dependency
TABLE in `00-overview.md`, not the filename numbering. Implementing a plan after
the plans it depends on means the interfaces it consumes (and the shared additive
files like `vscode-stub.ts` and the vitest alias) already exist on the branch, so
each plan builds on settled, real code instead of stubs.

## Why grill-gated

Grilling is the gate that makes a plan implementation-ready — every BLOCKING gap
(missing path, undefined contract, unrunnable command, ordering hazard) is resolved
and folded back into the plan before any code is written. Implementing only
`[x]` grilled plans keeps implementation trailing grilling in the same dependency
order, so the implementer never hits a gap the grilling pass would have caught.
