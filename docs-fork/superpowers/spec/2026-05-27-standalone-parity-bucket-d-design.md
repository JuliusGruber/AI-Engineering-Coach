# Standalone Parity — Bucket D: LLM-Backed Tier (design)

**Date:** 2026-05-27
**Status:** Approved — re-confirmed 2026-05-27 after a code-grounded grilling pass
(12 design corrections folded in: two-seam reframing, stub-surface gaps,
per-dispatch bridge, provider shaping, env config; see body). Ready for
implementation planning.
**Source:** `docs-fork/STANDALONE-PARITY-GAPS.md` § "D. LLM-backed tier"

## Problem

`docs-fork/STANDALONE-PARITY-GAPS.md` lists bucket D as **one enabler** ("LLM
provider wiring") plus four feature groups that are all "after enabler":

1. **Learning Center** — `generateLearningQuiz` / `generateCodeComparison` /
   `generateDidYouKnow` / `generateLearningResources`.
2. **Skill discovery / triage / generation** — `discoverCatalog` /
   `triageCatalog` / `triageSkills` + `generateSkillContent` / `createSkill`.
3. **AI context-file review** — `reviewContextFiles`.
4. **NL rule features** — `compileNlRule` / `generateRule` / `explainOccurrence`.

v1 dropped VS Code's built-in Copilot Language Model API
(`vscode.lm.selectChatModels`) with no replacement, so every LLM call fails in
standalone. The doc tags the enabler **Med–High** and treats the four groups as
uniform once it lands. Tracing the code shows the four groups are **not** uniform:
they are split across two delivery mechanisms, only one of which the standalone
dispatcher can reach today.

### What the code actually shows

The LLM is reached through **two** call sites, both of which resolve `vscode`
through the standalone esbuild alias (`esbuild.mjs:150`, which also covers the
dynamic `require('vscode')` form):

1. **`src/webview/panel-llm.ts`** (`callLlm` / `callLlmJson<T>`) — calls
   `vscode.lm.selectChatModels(...)` then `model.sendRequest(...)`, and
   **throws** a descriptive error when no model is available (`:321`). Consumed
   by all Learning/Skill/Context service methods, plus the NL-rule handlers
   `explainOccurrence` and `generateRule`.
2. **`src/core/rule-compiler.ts`** (`compileLlm`, `:69`) — used **only** by
   `compileNlRule`. Calls `vscode.lm` directly, guards `if (!lm) return null` /
   `if (!model) return null` (no throw), calls `sendRequest(messages, {})` with
   **no cancellation token**, and on any failure **falls back to a heuristic
   template** (`compileNaturalLanguageRule` returns
   `{ usedLlm: false, notes: ['LLM unavailable: …'] }`). It never surfaces an
   error offline.

So the **single seam is the `vscode` stub, not `panel-llm.ts`** — implementing
`lm` in the stub lights up both call sites at once. The callers of these helpers
live in two different dispatch locations:

- **NL-rule methods are registry handlers** in `src/webview/panel-rpc.ts`:
  `explainOccurrence` (`:895`), `generateRule` (`:996`, with a non-LLM template
  fallback at `:1036`), `compileNlRule` (`:1134`, which routes through
  rule-compiler's own seam above and degrades to a heuristic offline). These
  have the `(analyzer, parseResult, params)` signature and are registered in
  `getRpcHandler` — which the standalone dispatcher (`src/standalone/dispatcher.ts`)
  **already invokes**. They are dispatcher-reachable today and need only (a) an
  LLM and (b) allowlisting.

- **Learning / Skill / Context methods live in `PanelRequestService`**
  (`src/webview/panel-request-service.ts`) — a message-passing class with the
  `(msg: RequestMessage)` signature that returns data via
  `webview.postMessage({ type:'response', id, data })`
  (`panel-shared.ts:42-51`). It is constructed in `panel.ts:46` as
  `new PanelRequestService(webview, () => analyzer, () => parseResult)` and
  dispatched via `tryHandle(msg)` (`:129`). This is the **dropped service** —
  it is not wired into the standalone dispatcher at all. The *same class* also
  holds bucket E's `getWorkspaceDeps` / `getSdlcToolAnalysis` / `getSdlcRepoScan`
  / `getSdlcGitHubData`, so the bridge built here is shared infrastructure with
  bucket E.

### Fork invariant (the constraint that shapes everything)

The fork is **additive-only**: `git diff upstream/main -- src/` touches only
`src/standalone/`; all upstream `src/` is byte-identical. Exposure happens
through the standalone surface (the `vscode` alias → `src/standalone/vscode-stub.ts`,
the dispatcher, and the allowlists). `panel-llm.ts`, `panel-request-service.ts`,
and `panel-rpc.ts` must remain untouched.

## Goal

Expose all LLM-backed D features in the standalone build by (1) providing an LLM
the reused upstream code can call, and (2) bridging the dropped
`PanelRequestService` into the dispatcher — **without editing any upstream `src/`
file outside `src/standalone/`**, and degrading gracefully when no API key or
network is available.

## Decisions (from brainstorming)

| Decision | Choice | Rationale |
| --- | --- | --- |
| Plan scope | **All of D** — enabler + bridge + all exposed methods | The bridge is shared with bucket E; building it once unblocks Learning + Skill + Context together. |
| LLM provider mechanism | **Implement `vscode.lm` in `vscode-stub.ts`** | One seam, zero edits to `panel-llm.ts` **or `rule-compiler.ts`** (the two `vscode.lm` call sites); lights up both method groups at once. Preserves additive-only. |
| Provider support | **Both, auto-detect by env key** | `ANTHROPIC_API_KEY` → Anthropic (default `claude-sonnet-4-6`), else `OPENAI_API_KEY` → OpenAI (`gpt-4.1`). Matches the gaps doc's "`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` path." Model overridable via env. |
| `PanelRequestService` exposure | **Capturing-webview bridge** | Reuses every handler verbatim; additive. The alternative (reimplement each handler in `src/standalone`) duplicates logic and invites drift. |
| `reviewProgress` events | **Forward over WebSocket** | Full UX parity for the only streaming handler; threads a per-socket `emitEvent` into the dispatch context (requesting socket only, not broadcast-to-all). |
| `createSkill` | **Exclude** (stays degraded) | Its handler calls `vscode.commands.executeCommand('workbench.action.chat.open')` (`panel-request-service.ts:295`) — no standalone equivalent. It is *not* an LLM call; it opens Copilot Chat. |
| Bucket-B/E methods in the same service | **Do not allowlist here** | `installSkill` / `installCatalogItem` / `exportSummary` (bucket B write path) and `getWorkspaceDeps` / `getSdlc*` (bucket E) ride in `PanelRequestService` but are gated out by `V1_SERVICE_ALLOWED`. The bridge is method-agnostic; the allowlist controls exposure. |

## Scope

Exposed methods (13):

- **NL-rule (registry):** `explainOccurrence`, `generateRule`, `compileNlRule`.
- **Learning Center (service):** `generateLearningQuiz`, `generateCodeComparison`,
  `generateDidYouKnow`, `generateLearningResources`.
- **Skill triage/gen (service):** `generateSkillContent`, `triageSkills`,
  `triageCatalog`, `discoverCatalog`.
- **Context review (service):** `reviewContextFiles`.

### Out of scope (documented degradations, not regressions)

- `createSkill` — opens VS Code chat; stays degraded.
- `installSkill` / `installCatalogItem` / `exportSummary` — bucket B (write path).
- `getWorkspaceDeps` / `getSdlcToolAnalysis` / `getSdlcRepoScan` /
  `getSdlcGitHubData` — bucket E (the bridge enables these later, but they are
  not allowlisted here).

## Components

### A. LLM provider enabler — implement `vscode.lm` in the stub

Both `panel-llm.ts` and `rule-compiler.ts` call `vscode.lm.selectChatModels(...)`;
standalone aliases `vscode` → `src/standalone/vscode-stub.ts` (today it only stubs
`Uri.joinPath`). Implementing the `lm` surface in the stub is the single seam that
lights up both call sites with **zero edits to `panel-llm.ts` or
`rule-compiler.ts`**.

1. **New `src/standalone/llm-provider.ts`** — a minimal client behind an
   `LlmProvider` interface (`send(messages, opts, signal) → AsyncIterable<string>`).
   Two implementations (Anthropic, OpenAI) over Node `fetch` + `AbortController`.
   - **Non-streaming (v1 non-goal: token streaming).** Both consumers accumulate
     the full text before acting (`for await (const chunk of response.text) text
     += chunk` — `panel-llm.ts:344-346/375-377`, `rule-compiler.ts:99-101`), and
     nothing renders partial tokens (`reviewProgress` comes from the handler, not
     deltas). So each provider issues **one** `fetch` (no `stream:true`), parses
     the complete body (`content[0].text` for Anthropic, `choices[0].message.content`
     for OpenAI), and yields it as a **single-element** `AsyncIterable<string>`.
     This satisfies the `for await` consumers identically, keeps `AbortController`
     cancellation, and fits inside the existing 90s `withTimeout`. The
     `AsyncIterable<string>` interface is retained so a future SSE impl is a
     drop-in; real streaming is an explicit non-goal for v1.
   - **Auto-detect:** `ANTHROPIC_API_KEY` present → Anthropic (default model
     `claude-sonnet-4-6`); else `OPENAI_API_KEY` → OpenAI (default `gpt-4.1`);
     else no provider.
   - **Overrides:** `COACH_LLM_MODEL` overrides the **detected** provider's model
     — it must be valid for that provider (setting `gpt-4.1` while
     `ANTHROPIC_API_KEY` is present 404s; this is a documented user error, not
     auto-remapped). `COACH_LLM_BASE_URL` overrides the base URL of the active
     provider (a single var suffices — auto-detect activates exactly one),
     defaulting to the standard endpoint (`https://api.anthropic.com` /
     `https://api.openai.com/v1`); this is the **test seam** (see Testing).
     `COACH_LLM_MAX_TOKENS` overrides the Anthropic `max_tokens` (default 8192,
     see Message shaping). Honors the `LLM_REQUEST_TIMEOUT_MS` already enforced by
     `panel-llm.ts`'s `withTimeout`, plus per-request cancellation via
     `AbortController`.
   - **Env vars (one place):** `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (auto-detect
     + auth), `COACH_LLM_MODEL`, `COACH_LLM_BASE_URL`, `COACH_LLM_MAX_TOKENS`
     (overrides).
   - **Message shaping:** map `LanguageModelChatMessage` role → provider role
     (`User`→`user`, `Assistant`→`assistant`).
     - **Anthropic** (`/v1/messages`): `max_tokens` is **required** — inject a
       default of **8192**, overridable via `COACH_LLM_MAX_TOKENS`, large enough
       to avoid truncating `reviewContextFiles` / quiz JSON (truncation →
       `callLlmJson` parse failure). Header `anthropic-version: 2023-06-01`.
       **Merge consecutive same-role turns** (join with `\n\n`) before sending:
       callers emit `[User(system), User(user)]` and `generateRule` emits
       `[User, User, …, Assistant, User]`, which the API otherwise rejects. After
       merging, the leading `User`s collapse to one `user` turn and the first
       message is `user`, as required. No separate `system` param — the system
       prompt rides as the first user turn (parity with what Copilot received).
       `options.modelOptions` is ignored here (JSON handled by `callLlmJson`'s
       `parseLlmJson` + retry-nudge).
     - **OpenAI** (`/v1/chat/completions`): forward `response_format` from
       `options.modelOptions` (`structuredOutputOptions`, `panel-llm.ts:15`); the
       same-role merge is a harmless no-op; `max_tokens` omitted.

2. **Extend `src/standalone/vscode-stub.ts`** with exactly the `vscode` surface
   the two call sites consume:
   - `lm.selectChatModels(selector?)` → `[model]` when a provider is configured,
     else `[]`. **The `selector` (incl. `family`) is ignored** — it is a
     Copilot-catalog concept with no analogue here, and honoring
     `family:'gpt-4.1'` would wrongly return `[]` for an Anthropic provider
     (`panel-llm.ts:314` and `rule-compiler.ts:85` both pass a `family`). An
     empty result makes `panel-llm.ts:321` throw its descriptive "No language
     model available" error (tailored to name the env vars) and makes
     `rule-compiler.ts:87` fall back to the heuristic template.
   - `model.sendRequest(messages, options?, token?)` →
     `{ text: AsyncIterable<string> }`, translating `LanguageModelChatMessage[]`
     and `options.modelOptions` into a provider call. **`token` is optional** —
     `rule-compiler.ts:97` calls `sendRequest(messages, {})` with no token.
     `sendRequest` creates an `AbortController`, passes `signal` to `fetch`, and
     wires `token?.onCancellationRequested(() => controller.abort())` (guarded).
   - `LanguageModelChatMessage.User(text)` **and `.Assistant(text)`** (both
     static; `generateRule:1022` pushes an assistant turn on its retry, so a
     `.User`-only stub would throw only on the second attempt). `.System` is
     never used by any reused caller.
   - `CancellationTokenSource` (`.token` / `.cancel()` / `.dispose()`) where
     `.token` exposes **`onCancellationRequested(cb)`** (a tiny emitter) plus
     `isCancellationRequested` — `onCancellationRequested` is the wire that lets
     `sendRequest`'s `AbortController` actually abort the in-flight `fetch` when
     `panel-llm.ts:350` calls `cts.cancel()` (which also fires on the 90s
     timeout). Polling `isCancellationRequested` cannot interrupt a pending
     `await fetch`. `CancellationError`. (Cleanliness, not correctness:
     `withTimeout` already rejects the outer promise at 90s regardless; the wire
     prevents an orphaned `fetch` and lets the `instanceof CancellationError`
     branches at `:352`/`:384` be reachable.)

3. **Structured output:** OpenAI honors `response_format` json_schema for all
   schemas **except `SCHEMA_CONTEXT_REVIEW`** (used by `reviewContextFiles`):
   its `categoryScores: { type:'object', additionalProperties: { type:'number' } }`
   (`panel-llm.ts:189`) violates OpenAI **strict** mode (`strict:true` at
   `panel-llm.ts:19`), which requires `additionalProperties:false` on every
   object, so the first attempt 400s. This **self-heals via existing code**: the
   400 message contains `"response_format"`, matching `callLlmJson`'s fallback
   regex (`panel-llm.ts:386`), so attempt 0 drops `modelOptions` and attempt 1
   succeeds in plain mode with `parseLlmJson`. Net effect on OpenAI:
   `reviewContextFiles` works at the cost of one extra request. (Invisible
   today because the extension routes through Copilot's LM API, which does not
   enforce OpenAI strict-mode schema rules.) No code change — the fallback
   covers it. Anthropic ignores `options.modelOptions` entirely and relies on the
   same `parseLlmJson` + retry-nudge fallback (`callLlmJson`,
   `panel-llm.ts:360-407`); no "not supported" throw is needed.

**Rejected:** reimplementing `callLlm` in `src/standalone` and editing
`panel-rpc` / `panel-request-service` to import it (breaks additive-only);
runtime monkey-patching of the imported module (fragile, order-dependent).

### B. `PanelRequestService` bridge

**New `src/standalone/request-service-bridge.ts`.** `PanelRequestService` is
`new PanelRequestService(webview, getAnalyzer, getParseResult)` and dispatches
via `tryHandle(msg)`, returning data through `webview.postMessage(frame)`.

The bridge constructs a **fresh `PanelRequestService` + capturing fake `Webview`
per `dispatchServiceMethod` call** — *not* a singleton with an id-keyed map. Two
facts force this:

1. **Event frames carry no `id`.** `postEvent` emits `{ type:'event', method,
   data }` with no `id` (`panel-shared.ts:50-52`); `handleReviewContextFiles`
   posts `reviewProgress` this way (`:846`). A singleton serving N concurrent
   requests could not route an id-less event frame to the right caller's
   `emitEvent`. With one service per call there is exactly **one** in-flight
   request, so the event routes unambiguously.
2. **`getAnalyzer`/`getParseResult` are fixed at construction**
   (`panel-request-service.ts:123-127`) but `ctx` is built fresh per dispatch
   (`server.ts:269`, plus the per-socket `emitEvent`). Per-call construction lets
   the closures capture the live call's ctx.

Per call (`dispatchServiceMethod(method, params, ctx)`):

- Construct `new PanelRequestService(captureWebview, () => ctx.analyzer,
  () => ctx.parseResult)`, generate an `id` (needed only so `tryHandle` can echo
  it in the response frame), and return a promise.
- Call `service.tryHandle({ type:'request', id, method, params })`. If it returns
  `false` (method not handled — shouldn't happen behind the allowlist) resolve a
  defensive `{ ok:false, error:{ code:'unknown-method', method } }`.
- The capturing `postMessage(frame)` (the only member the service uses):
  - `{ type:'response', id, data }` → resolve
    `{ ok:false, error:{ code:'handler-error', method, message:data.error } }`
    when `data.error` is truthy (matching how `server.ts` maps errors), else
    `{ ok:true, data }`.
  - `{ type:'event', … }` → call `ctx.emitEvent(frame)` (does **not** resolve;
    the response frame still follows).

**Rejected:** a singleton bridge with a pending-request map keyed by `id`
(cannot route id-less event frames, and cannot rebind `getAnalyzer` per call);
reimplementing each handler as a registry handler in `src/standalone` (large
duplication + drift risk); moving `PanelRequestService` logic into core (edits
upstream).

### C. Dispatcher + server wiring

- **New `src/standalone/v1-service-allowed.ts`** exporting `V1_SERVICE_ALLOWED`
  = the 9 exposed service methods (Learning ×4, Skill ×3 + `generateSkillContent`,
  Context ×1) — i.e. all service methods in Scope, excluding `createSkill` and
  the bucket-B/E methods.
- **Dispatcher tiers** (`src/standalone/dispatcher.ts`) become:
  1. native (`openExternal`),
  2. **service-bridge** — `V1_SERVICE_ALLOWED.has(method)` →
     `dispatchServiceMethod(method, params, ctx)`. **No blanket data-ready guard
     on this tier**, for two reasons: (a) **redundancy** — the data-needing
     service handlers already self-guard (`reviewContextFiles` → "Analyzer not
     ready" at `:831`; `triageSkills` / `triageCatalog` → `getUserContext()`
     degrades to empties at `:966`); (b) **message fidelity** — a tier guard
     would replace `reviewContextFiles`'s specific "Analyzer not ready." with the
     generic "data not ready". (The webview renders no page until `dataReady` —
     `onDataReady → navigateTo → renderPage`, `app.ts:420/444` — and `dataReady`
     only fires once analyzer+parseResult are present, so no page issues any RPC
     pre-data regardless; this choice is about redundancy/fidelity, **not** an
     observable pre-parse window.) The bridge passes `getAnalyzer = () =>
     ctx.analyzer`, so any self-guard fires identically to upstream.
  3. registry allowlist (`V1_ALLOWED`) → **data-ready guard** (unchanged tier 3a)
     → `getRpcHandler` (now also the NL-rule methods). The guard stays as-is:
     `generateRule` / `compileNlRule` are `(_a, _p, params)` and don't need data,
     but they are never called pre-`dataReady` (same gating as above), so the
     blanket guard is a non-issue and not worth special-casing.
  4. disabled (`standalone-v1-disabled`).
- **Add to `V1_ALLOWED`** (`src/standalone/v1-allowed.ts`): `explainOccurrence`,
  `generateRule`, `compileNlRule` (frozen set 42 → 45, assuming bucket A's two
  additions have landed; otherwise 40 → 43).
- **`DispatchContext` gains `emitEvent?: (frame: Record<string, unknown>) => void`**
  — optional, so existing dispatch call sites and the dispatcher unit tests that
  pass only `{ analyzer, parseResult }` keep compiling; the bridge invokes it as
  `ctx.emitEvent?.(frame)`. Because `emitEvent` is **per-socket**, it cannot live
  in `RpcDeps.current()` (which is socket-agnostic). It is constructed inside the
  `wss.on('connection')` message handler (`server.ts` ~:201) and merged onto
  `deps.current()` at the `dispatch(...)` call site:
  `const ctx = { ...deps.current(), emitEvent: frame => { if (socket.readyState
  === WebSocket.OPEN) socket.send(JSON.stringify(frame)); } }`. The frame is
  forwarded **verbatim** (`{type:'event', method:'reviewProgress', data}`, which
  the unmodified webview already routes), so `reviewProgress` reaches the
  requesting socket only — reusing the existing outbound-frame pattern, distinct
  from `broadcast` (which fans out to all clients).
- **`webview-shim.ts` cleanup:** remove the now-enabled methods from
  `BANNER_WORTHY` (`generateLearningQuiz`, `generateCodeComparison`,
  `generateDidYouKnow`, `generateLearningResources`, `generateSkillContent`,
  `triageCatalog`) so no roadmap banner fires for live features. `createSkill`
  stays in `BANNER_WORTHY`.

## Data flow

NL-rule (registry) — unchanged dispatch path, LLM now resolves via the stub:

```
webview → WebSocket /rpc → dispatcher.dispatch()
  → V1_ALLOWED gate (now includes the 3 NL-rule methods)
  → getRpcHandler(method) → panel-rpc handler → callLlm/callLlmJson
  → vscode-stub lm → llm-provider → { ok, data }
```

Service (bridge):

```
webview → WebSocket /rpc → dispatcher.dispatch()
  → V1_SERVICE_ALLOWED gate → request-service-bridge.dispatchServiceMethod()
  → PanelRequestService.tryHandle({type:'request', id, method, params})
  → handler → capturing webview.postMessage(frame)
      ├─ {type:'event'}    → ctx.emitEvent(frame) → socket.send  (reviewProgress)
      └─ {type:'response'} → resolve { ok, data }
```

## Error handling & degradation

- **No API key** → `selectChatModels` returns `[]` → `panel-llm.ts` throws → page
  shows the error (pages already wrap these calls in try/catch per
  `tests/standalone/PAGE-RPC-AUDIT.md`). The stub's message names the env vars.
  **Exception: `compileNlRule`** does not go through `panel-llm.ts`; with no key
  `rule-compiler.ts` silently falls back to a heuristic template and returns
  `{ usedLlm: false, notes: ['LLM unavailable: …'] }` — the Rule Playground shows
  a scaffolded rule plus the note, never an error. This matches the extension.
- **Network failure** (catalog fetch from `awesome-copilot.github.com`, or
  provider HTTP) → `handler-error` → page error. `discoverCatalog` /
  `triageCatalog` are network-dependent and degrade gracefully offline.
- **Timeout / retry / cancellation** → handled by `panel-llm.ts`'s existing
  `withTimeout` + retries, plus the provider's `AbortController`.

## Testing

- **Unit — stub `lm`:** `selectChatModels` with/without keys; provider
  auto-detect precedence; **`selectChatModels({ family:'gpt-4.1' })` returns the
  Anthropic model when only `ANTHROPIC_API_KEY` is set** (selector-ignored
  regression guard); `LanguageModelChatMessage.User` **and `.Assistant`** shapes;
  `sendRequest` streams text **with no token argument** (rule-compiler form);
  cancellation aborts the request.
- **Unit — `generateRule` retry path:** a first invalid generation followed by a
  retry exercises `LanguageModelChatMessage.Assistant` (guards Gap 2 — a
  `.User`-only stub passes the happy path but throws on attempt 2).
- **Unit — provider:** Anthropic/OpenAI request shaping with mocked `fetch`;
  **the merged Anthropic body has a single leading `user` turn and a non-null
  `max_tokens`** (consecutive-same-role merge + required-field guard);
  structured-output (OpenAI honors `response_format`; Anthropic ignores it and
  text is parsed by `callLlmJson`).
- **Unit — bridge:** response frame → `{ ok:true }`; error frame → `handler-error`;
  event frame → `emitEvent` called and promise not resolved; unknown method →
  `tryHandle` returns false.
- **Unit — gating:** `V1_SERVICE_ALLOWED` and `V1_ALLOWED` membership; dispatcher
  tier routing (service method → bridge; NL-rule → registry; disabled unchanged).
- **Integration** (`tests/standalone/integration`): dispatch
  `generateLearningQuiz` / `triageCatalog` / `reviewContextFiles` against a
  **fake provider via base-URL override** (set a dummy key + `COACH_LLM_BASE_URL`
  pointing at a local test server) → `{ ok:true }`; `reviewContextFiles` invokes
  `emitEvent` with a `reviewProgress` frame. **OpenAI strict-mode fallback:** the
  fake OpenAI server returns a strict-mode 400 (mentioning `response_format`) for
  the `SCHEMA_CONTEXT_REVIEW` request, and `reviewContextFiles` still resolves
  `{ ok:true }` after `callLlmJson` drops `modelOptions` and retries in plain
  mode.
- **Playwright smoke:** against the fake-provider base URL (no real key in CI) —
  Learning quiz generates; Skill Finder discovers + triages; Context Health
  review runs (progress event observed); Rule Playground NL→rule compiles.
- **Pack:** no new bundle entry; confirm the provider/bridge compile into the
  existing standalone CLI bundle.

### Test deltas (existing pinned counts)

These existing freeze-guard assertions break by design; the implementer should
expect the failures and update them to the stated targets:

- **`src/standalone/__tests__/v1-allowed.test.ts`** — `V1_ALLOWED.size` is pinned
  `toBe(40)` at **two** sites (`:6` and `:15`). Adding `explainOccurrence` /
  `generateRule` / `compileNlRule` → **40 → 43** (today's baseline). **Ordering
  coupling with bucket A:** if A's two additions land first, the baseline is 42 →
  **45**. Whichever bucket lands second edits the same `_inner` set and the same
  two assertions.
- **`src/standalone/__tests__/webview-shim.test.ts:86`** — `BANNER_WORTHY.size`
  pinned `toBe(10)` → **10 → 4** after removing the 6 now-live methods (leaving
  `{createSkill, installSkill, installCatalogItem, getRuleEditor}`). This edit is
  **hygiene-only**: once a method is allowlisted the dispatcher never returns
  `standalone-v1-disabled` for it, so the shim banner branch (`webview-shim.ts:111`)
  is already unreachable for it.
- **New `src/standalone/__tests__/v1-service-allowed.test.ts`** — pins
  `V1_SERVICE_ALLOWED.size` `toBe(9)` (Learning ×4 + Skill-triage ×3 +
  `generateSkillContent` + `reviewContextFiles`).

## Invariant verification

After implementation, `git diff upstream/main -- src/` must still touch only
`src/standalone/`. Changes live in: new `src/standalone/llm-provider.ts`,
`src/standalone/request-service-bridge.ts`, `src/standalone/v1-service-allowed.ts`;
modified `src/standalone/vscode-stub.ts`, `dispatcher.ts`, `v1-allowed.ts`,
`server.ts`, `webview-shim.ts`; plus docs/tests. No upstream `src/` file outside
`src/standalone/` is modified. (No `esbuild.mjs` entry is required — the stub is
already aliased into the standalone CLI bundle, unlike bucket A's separate
webview bundle.)

## Suggested sequencing (for the implementation plan)

Three layers — the gaps doc's "enabler first, then parallel feature groups,"
made precise:

1. **Layer 1 — Enabler:** `llm-provider.ts` + stub `lm` surface + env config +
   unit tests. Independently verifiable.
2. **Layer 2 — NL-rule wiring:** allowlist `explainOccurrence` / `generateRule` /
   `compileNlRule` + unit/integration/smoke. Depends on Layer 1 only.
3. **Layer 3 — Service bridge:** `request-service-bridge.ts` + dispatcher
   service tier + `V1_SERVICE_ALLOWED` + `DispatchContext.emitEvent` + server
   event forwarding + `BANNER_WORTHY` cleanup + unit/integration/smoke. Depends
   on Layer 1; independent of Layer 2.

Each layer verifies the additive-only invariant before completion.
