# Implementation queue (dependency order)

Topological order from `docs-fork/specs/00-overview.md` (the dependency TABLE,
not the filename numbering) — same order as `PLAN-QUEUE.md` / `GRILLING-QUEUE.md`.
One plan implemented per invocation via `plan-implementation-prompt.md`, on the
current branch, then STOP for review. A plan is implemented only after it is
marked `[x]` grilled in `GRILLING-QUEUE.md`; entries whose plan is not yet grilled
are blocked, not skipped.

- [x] implemented — 06-state.plan.md
- [x] implemented — 02-dispatcher.plan.md
- [ ] 04-webview-shim
- [ ] 03-standalone-html
- [ ] 01-server
- [ ] 05-cli
- [ ] 07-build
- [ ] 08-testing
