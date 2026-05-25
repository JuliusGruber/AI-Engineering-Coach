# Grill prompt

Paste the block below to drive the `grill-me` skill across the
standalone-UI implementation plans in `docs-fork/plans/`. It grills exactly one
plan per invocation, updates that plan with the resolved decisions, and stops
for review.

---

```
Use the grill-me skill to assess ONE implementation plan from
docs-fork/plans/ per invocation, then STOP for my review.

GOAL OF EACH GRILL — answer ONE question:
  Is this plan implementation-ready?
  Implementation-ready = a competent engineer who was NOT in this conversation
  could execute every task in order, using ONLY the file paths, commands,
  interfaces, and types written in the plan (plus its named dependency plans and
  docs-fork/specs/00-overview.md), and reach the intended result WITHOUT
  inventing a decision or guessing a contract.

TRIAGE BEFORE YOU ASK — classify every issue you spot:
  BLOCKING     stops execution or forces the implementer to invent a decision:
               missing/ambiguous file path or module boundary; a referenced
               interface/type/signature/data shape defined nowhere reachable; a
               placeholder / "TBD" / "figure out later" step; a command that
               won't run as written; a dependency on a decision not yet settled
               in the depended-on plan; a success criterion with no
               objective check; an ordering hazard (a step needs an artifact only
               produced later).
  NON-BLOCKING terminology drift that's still unambiguous; naming taste; doc
               polish; optional nice-to-haves.
  Grill ONLY on BLOCKING issues. Do NOT interview me about NON-BLOCKING ones —
  just list them in the report. Relentless on blockers, silent on cosmetics.

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
  2. Read that plan + docs-fork/specs/00-overview.md +
     the .plan.md of every plan it depends on — enough to tell a real cross-plan
     blocker from a non-issue.
  3. Invoke grill-me against that plan file. Interview me one question at a time,
     ONLY on BLOCKING gaps, until none remain open.
  4. When no blocking gaps remain (or I say we're done), REWRITE
     docs-fork/plans/<spec-basename>.plan.md to fold in every resolved decision.
     Keep the writing-plans structure intact (header, file map, TDD task steps,
     exact commands, no placeholders).
  5. Mark that queue entry as:  - [x] grilled — <plan filename>
  6. STOP. Report in this order:
       VERDICT: READY or NOT READY (+ one-line why).
       Blockers resolved this run.
       Blockers I deferred or left open.
       Non-blocking notes (one line each, no discussion).
       Next pending plan.
     Wait for my review before doing anything else.
```

---

## Why this order

Same topological order as `PLAN-QUEUE.md` — the dependency TABLE in
`00-overview.md`, not the filename numbering. Grilling a plan after the plans it
depends on means those dependency plans are already settled and rewritten, so
cross-plan blockers can be judged against the real interfaces they expose.
