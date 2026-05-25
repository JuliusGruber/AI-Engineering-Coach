# Grilling queue (dependency order)

Topological order from `docs-fork/specs/00-overview.md` (the dependency TABLE,
not the filename numbering) — same order as `PLAN-QUEUE.md`. One plan grilled per
invocation via `plan-grilling-prompt.md`. Entries whose `.plan.md` does not yet exist are
skipped until the plan is written.

- [x] grilled — 06-state.plan.md
- [x] grilled — 02-dispatcher.plan.md
- [x] grilled — 04-webview-shim.plan.md
- [x] grilled — 03-standalone-html.plan.md
- [ ] 01-server
- [ ] 05-cli
- [ ] 07-build
- [ ] 08-testing
