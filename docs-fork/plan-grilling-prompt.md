# Grill prompt

Paste the block below to drive the `grill-with-docs` skill across the
standalone-UI implementation plans in `docs-fork/plans/`. It grills exactly one
plan per invocation, updates that plan with the resolved decisions, and stops
for review.

---

```
Use the grill-with-docs skill to grill ONE implementation plan from
docs-fork/plans/ per invocation, then STOP for my review.

ARTIFACT LOCATIONS (override grill-with-docs defaults):
  - Glossary:  docs-fork/CONTEXT.md   (NOT repo-root CONTEXT.md)
  - ADRs:      docs-fork/adr/         (NOT docs/adr/)

QUEUE FILE: docs-fork/plans/GRILLING-QUEUE.md
If it does not exist, create it first with one checkbox line per spec in the
dependency order below (same topological order as PLAN-QUEUE.md):
  # Grilling queue (dependency order)
  - [ ] 06-state
  - [ ] 02-dispatcher
  - [ ] 04-webview-shim
  - [ ] 03-standalone-html
  - [ ] 01-server
  - [ ] 05-cli
  - [ ] 07-build
  - [ ] 08-testing

EACH RUN:
  1. Read docs-fork/plans/GRILLING-QUEUE.md. Pick the FIRST entry still marked
     [ ] WHOSE PLAN FILE EXISTS at docs-fork/plans/<spec-basename>.plan.md.
     (Plans are still being written; skip [ ] entries whose .plan.md is absent
     and report that they are not yet grillable.) That plan is the only one you
     grill this run.
  2. Read that plan + docs-fork/specs/00-overview.md + docs-fork/CONTEXT.md so
     terminology and interface/type names stay consistent across plans.
  3. Invoke grill-with-docs against that plan file. Interview me one question at
     a time, relentlessly, down every branch of the decision tree. Update
     docs-fork/CONTEXT.md and docs-fork/adr/ INLINE as decisions crystallise.
  4. When the interview concludes (no open branches / I say we're done), REWRITE
     docs-fork/plans/<spec-basename>.plan.md to fold in every resolved decision.
     Keep the writing-plans structure intact (header, file map, TDD task steps,
     exact commands, no placeholders).
  5. Mark that queue entry as:  - [x] grilled — <plan filename>
  6. STOP. Report: the plan you grilled, the decisions captured (and any new
     CONTEXT.md terms / ADRs), and the next pending plan. Wait for my review
     before doing anything else.
```

---

## Why this order

Same topological order as `PLAN-QUEUE.md` — the dependency TABLE in
`00-overview.md`, not the filename numbering. Grilling a plan after the plans it
depends on means settled terminology in `docs-fork/CONTEXT.md` is available to
challenge later plans against.
