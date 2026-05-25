# Plan-writing prompt

Paste the block below to drive the `superpowers:writing-plans` skill across the
standalone-UI spec set. It writes one plan per invocation, in dependency order,
and stops for review after each.

---

```
Use the superpowers:writing-plans skill to write implementation plans for the
standalone-UI spec set in docs-fork/specs/.

OUTPUT DIRECTORY: docs-fork/plans/  (override the skill's default docs/superpowers/plans/)

WRITE EXACTLY ONE PLAN PER INVOCATION, THEN STOP for my review. Do not begin the
next plan. Plans are documents only — never execute them.

ORDER (dependency / topological — the TABLE in 00-overview.md, NOT the filename
numbering):
  1. 06-state
  2. 02-dispatcher
  3. 04-webview-shim
  4. 03-standalone-html
  5. 01-server
  6. 05-cli
  7. 07-build
  8. 08-testing

00-overview.md is the shared contract reference, NOT a subsystem — do NOT write a
plan for it. Read it on every run for cross-cutting contracts (RPC envelope,
security model, additive-only fork rule, V1_ALLOWED).

QUEUE FILE: docs-fork/plans/PLAN-QUEUE.md
If it does not exist, create it first with one checkbox line per spec in the order
above, e.g.:
  # Plan-writing queue (dependency order)
  - [ ] 06-state
  - [ ] 02-dispatcher
  - [ ] 04-webview-shim
  - [ ] 03-standalone-html
  - [ ] 01-server
  - [ ] 05-cli
  - [ ] 07-build
  - [ ] 08-testing

EACH RUN:
  1. Read docs-fork/plans/PLAN-QUEUE.md and pick the FIRST entry still marked [ ].
     That is the only plan you write this run.
  2. Read that spec + 00-overview.md, plus any already-planned specs it depends on,
     so interface/type names stay consistent across plans.
  3. Write the plan to docs-fork/plans/<spec-basename>.plan.md
     (e.g. 06-state.plan.md), following writing-plans fully: required header,
     file-structure map, bite-sized TDD task steps with real code and exact
     commands, no placeholders, then the self-review pass.
  4. Mark that entry in PLAN-QUEUE.md as:  - [x] ready — <plan filename>
  5. STOP. Report: the plan you just wrote, the next pending spec, and wait for my
     review before doing anything else.
```

---

## Why this order

`00-overview.md` carries two orderings. The **filename numbering** (`01`, `02`, …)
is *not* dependency order — `01-server` depends on `06`, `02`, `03`, `04`. The
**topological table** (the order above) is a valid dependency sort: every spec is
written after the specs it depends on, so each plan can reference settled
interfaces from the plans before it.
