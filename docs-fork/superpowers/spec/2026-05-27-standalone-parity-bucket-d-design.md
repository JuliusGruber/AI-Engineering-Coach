# Standalone Parity — Bucket D: LLM-Backed Tier (design)

**Date:** 2026-05-27
**Status:** Approved (brainstorming) — ready for implementation planning
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

The LLM is called through one shared module — `src/webview/panel-llm.ts`
(`callLlm` / `callLlmJson<T>`), which calls `vscode.lm.selectChatModels(...)`
and `model.sendRequest(...)`. But the **callers** of that module live in two
different places:

- **NL-rule methods are registry handlers** in `src/webview/panel-rpc.ts`:
  `explainOccurrence` (`:895`), `generateRule` (`:996`, with a non-LLM template
  fallback at `:1035`), `compileNlRule` (`:1134`). These have the
  `(analyzer, parseResult, params)` signature and are registered in
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
| LLM provider mechanism | **Implement `vscode.lm` in `vscode-stub.ts`** | One seam, zero edits to `panel-llm.ts`; lights up both method groups at once. Preserves additive-only. |
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

`panel-llm.ts` calls `vscode.lm.selectChatModels(...)`; standalone aliases
`vscode` → `src/standalone/vscode-stub.ts` (today it only stubs `Uri.joinPath`).
Implementing the `lm` surface in the stub is the single seam that lights up both
method groups with **zero edits to `panel-llm.ts`**.

1. **New `src/standalone/llm-provider.ts`** — a minimal client behind an
   `LlmProvider` interface (`send(messages, opts, signal) → AsyncIterable<string>`).
   Two implementations (Anthropic, OpenAI) over Node `fetch` + `AbortController`.
   - **Auto-detect:** `ANTHROPIC_API_KEY` present → Anthropic (default model
     `claude-sonnet-4-6`); else `OPENAI_API_KEY` → OpenAI (default `gpt-4.1`);
     else no provider.
   - **Overrides:** model via `COACH_LLM_MODEL`; base URL overridable (the test
     seam — see Testing). Honors the `LLM_REQUEST_TIMEOUT_MS` already enforced by
     `panel-llm.ts`'s `withTimeout`, plus per-request cancellation via
     `AbortController`.

2. **Extend `src/standalone/vscode-stub.ts`** with exactly the `vscode` surface
   `panel-llm.ts` consumes:
   - `lm.selectChatModels(selector?)` → `[model]` when a provider is configured,
     else `[]` (so `panel-llm.ts:321` throws its descriptive "No language model
     available" error — tailored to name the env vars).
   - `model.sendRequest(messages, options, token)` →
     `{ text: AsyncIterable<string> }`, translating `LanguageModelChatMessage[]`
     and `options.modelOptions` into a provider call and honoring `token`.
   - `LanguageModelChatMessage.User(text)` (static), `CancellationTokenSource`
     (`.token` / `.cancel()` / `.dispose()`), `CancellationError`.

3. **Structured output:** OpenAI honors `response_format` json_schema directly.
   Anthropic ignores `options.modelOptions` and relies on `panel-llm.ts`'s
   existing `parseLlmJson` + retry-nudge fallback (`callLlmJson`,
   `panel-llm.ts:360-407`) — already robust. No "not supported" throw is needed;
   the Anthropic path simply returns text and lets `callLlmJson` parse it.

**Rejected:** reimplementing `callLlm` in `src/standalone` and editing
`panel-rpc` / `panel-request-service` to import it (breaks additive-only);
runtime monkey-patching of the imported module (fragile, order-dependent).

### B. `PanelRequestService` bridge

**New `src/standalone/request-service-bridge.ts`.** `PanelRequestService` is
`new PanelRequestService(webview, getAnalyzer, getParseResult)` and dispatches
via `tryHandle(msg)`, returning data through `webview.postMessage(frame)`. The
bridge supplies a **capturing fake `Webview`** (`postMessage` is the only member
the service uses) plus a pending-request map:

- `dispatchServiceMethod(method, params, ctx)`: generate an `id`, register
  `{ resolve, reject, emitEvent }` keyed by `id`, then call
  `service.tryHandle({ type:'request', id, method, params })`.
- The capturing `postMessage(frame)`:
  - `{ type:'response', id, data }` → look up the pending entry; resolve
    `{ ok:false, error:{ code:'handler-error', method, message:data.error } }`
    when `data.error` is truthy (matching how `server.ts` maps errors), else
    `{ ok:true, data }`; delete the entry.
  - `{ type:'event', method, data }` → forward via the pending entry's
    `emitEvent` (does not resolve).
- `getAnalyzer` / `getParseResult` close over the dispatch `ctx`
  (`ctx.analyzer` / `ctx.parseResult`).

**Rejected:** reimplementing each handler as a registry handler in
`src/standalone` (large duplication + drift risk); moving `PanelRequestService`
logic into core (edits upstream).

### C. Dispatcher + server wiring

- **New `src/standalone/v1-service-allowed.ts`** exporting `V1_SERVICE_ALLOWED`
  = the 9 exposed service methods (Learning ×4, Skill ×3 + `generateSkillContent`,
  Context ×1) — i.e. all service methods in Scope, excluding `createSkill` and
  the bucket-B/E methods.
- **Dispatcher tiers** (`src/standalone/dispatcher.ts`) become:
  1. native (`openExternal`),
  2. **service-bridge** — `V1_SERVICE_ALLOWED.has(method)` → data-ready guard →
     `dispatchServiceMethod(method, params, ctx)`,
  3. registry allowlist (`V1_ALLOWED`) → `getRpcHandler` (now also the NL-rule
     methods),
  4. disabled (`standalone-v1-disabled`).
- **Add to `V1_ALLOWED`** (`src/standalone/v1-allowed.ts`): `explainOccurrence`,
  `generateRule`, `compileNlRule` (frozen set 42 → 45, assuming bucket A's two
  additions have landed; otherwise 40 → 43).
- **`DispatchContext` gains `emitEvent?: (frame: Record<string, unknown>) => void`**;
  `server.ts` passes a per-socket `emitEvent: frame => { if (socket.readyState
  === WebSocket.OPEN) socket.send(JSON.stringify(frame)); }` into the dispatch
  ctx, so `reviewProgress` reaches the requesting socket only (reuses the
  existing outbound-frame pattern, distinct from `broadcast`).
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
- **Network failure** (catalog fetch from `awesome-copilot.github.com`, or
  provider HTTP) → `handler-error` → page error. `discoverCatalog` /
  `triageCatalog` are network-dependent and degrade gracefully offline.
- **Timeout / retry / cancellation** → handled by `panel-llm.ts`'s existing
  `withTimeout` + retries, plus the provider's `AbortController`.

## Testing

- **Unit — stub `lm`:** `selectChatModels` with/without keys; provider
  auto-detect precedence; `LanguageModelChatMessage.User` shape; `sendRequest`
  streams text; cancellation aborts the request.
- **Unit — provider:** Anthropic/OpenAI request shaping with mocked `fetch`;
  structured-output (OpenAI honors `response_format`; Anthropic ignores it and
  text is parsed by `callLlmJson`).
- **Unit — bridge:** response frame → `{ ok:true }`; error frame → `handler-error`;
  event frame → `emitEvent` called and promise not resolved; unknown method →
  `tryHandle` returns false.
- **Unit — gating:** `V1_SERVICE_ALLOWED` and `V1_ALLOWED` membership; dispatcher
  tier routing (service method → bridge; NL-rule → registry; disabled unchanged).
- **Integration** (`tests/standalone/integration`): dispatch
  `generateLearningQuiz` / `triageCatalog` / `reviewContextFiles` against a
  **fake provider via base-URL override** (set a dummy key + point the provider
  base URL at a local test server) → `{ ok:true }`; `reviewContextFiles` invokes
  `emitEvent` with a `reviewProgress` frame.
- **Playwright smoke:** against the fake-provider base URL (no real key in CI) —
  Learning quiz generates; Skill Finder discovers + triages; Context Health
  review runs (progress event observed); Rule Playground NL→rule compiles.
- **Pack:** no new bundle entry; confirm the provider/bridge compile into the
  existing standalone CLI bundle.

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
