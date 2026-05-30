# Parity-gap report template

The format for `docs-fork/STANDALONE-PARITY-GAPS.md`. Sections marked **[AUTO]** come
verbatim from `scripts/parity-gap.mjs`; sections marked **[HUMAN]** are judgment the script
must not invent. **Preserve the existing bucket A–F structure** when regenerating — do not
renumber or drop buckets a human curated; only refresh the auto facts and append new gaps.

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

## F. Merge debt — fork is behind upstream — [HUMAN]

[HUMAN] **Invisible to the allowlist diff.** Derive from
`git diff --stat <merge-base> HEAD -- src/ ':(exclude)src/standalone/'` and the
`HEAD..upstream/main` log. Portable upstream changes the fork hasn't merged yet that affect
standalone data/load behavior go here. This is usually the highest-leverage section.

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

## [HUMAN] Priority notes

Free-form: what to do next and why, severity (`HIGH`/`Med`), portability calls.

## [HUMAN] Explicitly excluded (out of scope: not portable / not a feature)

VS Code-only surfaces (activity-bar sidebar, `@aicoach` chat participant, MCP tools), pure
infra (devcontainer, CI, dep bumps, CSP/XSS branches), and any method intentionally deferred
(e.g. `createSkill` opens VS Code chat, not an LLM call). State *why* each is excluded so the
next regeneration doesn't re-flag it as a gap.
