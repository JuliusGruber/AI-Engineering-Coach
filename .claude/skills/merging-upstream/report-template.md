# Parity-gap report template

The format for `docs-fork/STANDALONE-PARITY-GAPS.md`. Sections marked **[AUTO]** come
verbatim from `scripts/parity-gap.mjs`; sections marked **[HUMAN]** are judgment the script
must not invent. **The bucket list (A, B, C, …) is an append-only ledger** — never renumber,
never delete a bucket a human curated. Refresh the auto facts in place. When a merge surfaces
genuinely new upstream functionality the standalone build doesn't implement, **append a new
lettered bucket** at the next free letter (see *Appending new buckets* below). An implemented
bucket is **marked implemented in place** (status flips to `SHIPPED (<date>)`), not removed —
it stays as history. This report tracks **functional parity only**; git *sync status* (how
far behind upstream the fork is) is **not** a parity gap and never gets a bucket.

---

# Standalone Parity Gaps (upstream → fork)

Features that exist in the upstream extension (`microsoft/AI-Engineering-Coach` main) but
are **not yet exposed by this fork's standalone build**. Scope: *portable* gaps only —
things that could run in a browser. VS Code-only surfaces and pure infra are excluded
(see the **Explicitly excluded** section).

**[AUTO] Staleness banner** — paste the `parity-gap.mjs` header line, e.g.:
> Derived `<merge-base>` → re-verified `<upstream_head>`, `<n>` behind. If
> `git rev-parse upstream/main` ≠ this SHA, regenerate.

**[AUTO] Counts (regression assertions).** Paste the counts block. A `DRIFT` flag on any
count means the parser or the allowlist changed — reconcile before trusting the gap list.

```
V1_ALLOWED         = NN   OK|DRIFT
V1_SERVICE_ALLOWED = NN   OK|DRIFT
STANDALONE_NATIVE  = NN   OK|DRIFT
exposed (union)    = NN   OK|DRIFT
universe (upstream)= NN
gap                = NN
```

---

## A. Quick wins — [HUMAN bucket / status]

[HUMAN] Methods that are a thin shim away. For each: method, where it's reached, the shim,
difficulty (`Easy`/`Med`/`Hard`), status (`SHIPPED`/`TODO`).

## B. Rule & skill authoring — [HUMAN bucket / status]

[HUMAN] Rule-editor / skill-install / import methods, including the write path.

## C. Project-scoped analysis — [HUMAN bucket / status]

[HUMAN] Gaps needing a project route + browser trust model.

## D. LLM-backed tier — [HUMAN bucket / status]

[HUMAN] Service-bridge (LLM) methods exposed via `v1-service-allowed.ts`.

## E. Agentic SDLC — [HUMAN bucket / status]

[HUMAN] `getSdlc*` / dropped-data-service gaps.

## Appending new buckets — when a merge surfaces new functionality — [HUMAN, features only]

[HUMAN] **Not a "merge debt" / "fork is behind" step.** When `upstream/main` is ahead, scan
the delta — `git diff <merge-base> upstream/main -- src/ ':(exclude)src/standalone/'` plus the
`<merge-base>..upstream/main` log — for genuinely **new user-facing functionality** the
standalone build doesn't implement. This catches **non-RPC** features the allowlist diff
can't see (e.g. a new dashboard load-gate). Then, per change:

- **New portable feature, not in `src/standalone/`** → **append a new lettered bucket** at the
  next free letter (one bucket per feature / feature area). The ledger is append-only: never
  fold a new feature into an existing bucket's scope, never renumber, never delete. Leave the
  bucket status `GAP`/`TODO` and difficulty / Effect / Priority `TODO` for a human.
- **Bug fix / refactor / dep bump / test / infra / VS Code-only** → **NOT a parity gap.** Do
  not append a bucket. Being N commits behind upstream is a *sync status*, surfaced by the
  merge workflow's `fetch-upstream.sh` (behind count) and `drift-gate.sh` — never a row here.

**Marking a bucket implemented.** When the standalone build later exposes a bucket's
functionality, the **implementing agent** flips that bucket's status to `SHIPPED (<date>)`
**in place** and records the allowlist/bridge wiring — the bucket stays in the ledger. Shape:

```
## F. Repo Health score + page — SHIPPED (2026-06-12)
- `getRepoHealthScore` added to V1_ALLOWED; "Repo Health" nav link injected in standalone-html.ts.
```

---

## [AUTO] Gap methods (universe \ exposed)

Paste the gap list (method + `rpc-types.ts:line`). Then, per method, a **[HUMAN]** line:
bucket letter, difficulty, Effect, Priority. Newly-appeared upstream methods (from the
script's "ALLOWLIST DECISION NEEDED" section) get an explicit
**`allowlist decision needed`** flag here.

```
- methodName   (src/core/types/rpc-types.ts:NN)    [HUMAN: bucket=?, difficulty=?, effect=?]
```

## [AUTO] Per-method degradations (within otherwise-shipped pages)

Paste the degradations table — methods **called** by a shipped `src/webview/page-*.ts` but
**not** exposed, with their call sites. These degrade silently and are the easiest to miss.

```
methodName: CALLED by a shipped page but NOT exposed -> silent degradation
    src/webview/page-*.ts:NN:  ...call site...
```

## [HUMAN] Fork-authored drift outside `src/standalone/` (NOT a parity gap)

Optional. Deliberate fork-*ahead* edits in shared `src/` (from `drift-gate.sh`'s
`DELIBERATE` classification) — portable fixes the fork carries and should upstream. Listed
as upstream-it candidates for context; they are fork-ahead, not standalone gaps, and **never
merge debt**. **Never auto-revert.**

## [HUMAN] Priority notes

Free-form: what to do next and why, severity (`HIGH`/`Med`), portability calls.

## [HUMAN] Explicitly excluded (out of scope: not portable / not a feature)

VS Code-only surfaces (activity-bar sidebar, `@aicoach` chat participant, MCP tools), pure
infra (devcontainer, CI, dep bumps, CSP/XSS branches), and any method intentionally deferred
(e.g. `createSkill` opens VS Code chat, not an LLM call). State *why* each is excluded so the
next regeneration doesn't re-flag it as a gap.
