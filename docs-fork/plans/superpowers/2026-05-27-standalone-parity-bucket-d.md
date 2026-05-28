# Standalone Parity — Bucket D: LLM-Backed Tier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose all 13 LLM-backed bucket-D features in the standalone build by (1) implementing `vscode.lm` in the standalone stub so the reused upstream code can reach a real LLM, and (2) bridging the dropped `PanelRequestService` into the dispatcher — without editing any upstream `src/` file outside `src/standalone/`, and degrading gracefully when no API key or network is available.

**Architecture:** Three sequenced layers. **Layer 1 (enabler)** adds `src/standalone/llm-provider.ts` (a minimal Anthropic/OpenAI client over `fetch`, auto-detected by env key) and implements the `lm` / `LanguageModelChatMessage` / `CancellationTokenSource` surface in `src/standalone/vscode-stub.ts` — the single seam both `panel-llm.ts` and `core/rule-compiler.ts` already call, with zero edits to either. **Layer 2 (NL-rule wiring)** allowlists the three NL-rule registry methods (`explainOccurrence`, `generateRule`, `compileNlRule`); they are already dispatcher-reachable and only need an LLM plus an allowlist entry. **Layer 3 (service bridge)** adds `request-service-bridge.ts` (a fresh capturing `PanelRequestService` per call), a `V1_SERVICE_ALLOWED` set, a new dispatcher tier, a per-socket `emitEvent` for `reviewProgress`, and a `BANNER_WORTHY` cleanup.

**Tech Stack:** TypeScript, Node `fetch` + `AbortController`, esbuild 0.28 (`esbuild.mjs` — **no change needed**; the stub is already aliased into the CLI bundle), Vitest 4.1.6 (unit + integration), Playwright 1.60 (smoke), Express + `ws` (standalone server).

**Source design:** `docs-fork/superpowers/spec/2026-05-27-standalone-parity-bucket-d-design.md`

---

## Execution status (handoff — read before continuing)

> **Layer 1 is COMPLETE and committed to `main` (2026-05-28).** Next agent: start at **Task 4** (Layer 2). Layers 2 and 3 are untouched.
>
> **Commits landed (on `main`, in order):**
> - `e2eb851` — Task 1: `feat(standalone): add llm-provider (Anthropic/OpenAI, non-streaming, env-detected)`
> - `6456e59` — Task 2: `feat(standalone): implement vscode.lm in the stub (lights up panel-llm + rule-compiler)`
> - Task 3 was verification-only (no commit): `npm run build` → `Build complete.` ✓
>
> **Test state at end of Layer 1:** `llm-provider.test.ts` 12/12, `vscode-stub.test.ts` 7/7, full `src/standalone/__tests__` suite 145 passed / 1 skipped (the 1 skip is pre-existing, unrelated).
>
> **Deviation from the literal Task 1 code — READ THIS (the committed `llm-provider.ts` differs from the Task 1 snippet):** the `OpenAiProvider.send` routes through the shared `postJson(...)` timeout helper (same as `AnthropicProvider`), **not** a bare `fetch`. The Task 1 snippet stored `this.timeoutMs` on the OpenAI class but never used it — a dead field that also left OpenAI's `callLlmJson` paths unbounded, contradicting grilling decision 4 ("the provider's `send()` owns its own ceiling … bounds all 13 paths"). The committed version applies the ceiling uniformly to both providers. No test behavior changed (every Task 1 + Task 2 test still passes). If you re-read Task 1's Step 3 snippet, treat the committed file as the source of truth for the OpenAI path.
>
> **Additive-only invariant — adjusted expectation (applies to Task 3 / Task 6 Step 4 / Task 14 Step 4):** `git diff --name-only abc0a6c -- src/ | grep -v '^src/standalone/'` does **NOT** print nothing — it prints exactly two files: `src/core/metric-engine.ts` and `src/core/parser-codex.test.ts`. These are **pre-existing**, from commit `44e9532` (`fix(core): pin calibration locale + bump codex large-file test timeout`), which predates this plan — confirmed by `git log abc0a6c..HEAD -- src/core/metric-engine.ts src/core/parser-codex.test.ts`. They are NOT introduced by bucket D and must NOT be reverted. The plan's "prints nothing" wording is therefore relaxed to: **"prints nothing except the two known pre-existing `src/core/` files above; no NEW file outside `src/standalone/` appears."** The correct guard for the next agent is to diff against the prior commit (`git diff --name-only <pre-task-commit>..HEAD -- src/ | grep -v '^src/standalone/'` must be empty), not against `abc0a6c`.

---

## Grilling state (resolved decisions — folded into the tasks; recorded here as rationale)

> A `/grill-me` session on 2026-05-28 stress-tested this plan (bucket A assumed done, landing in parallel). Six decisions were resolved and are now **folded into the task bodies below** (2026-05-28); the entries here remain as the decision record/rationale. Several were verified against the real code (recorded so the next agent need not re-check).
>
> **Verified, no action needed:**
> - Bridge frame mapping matches the real `postResponse`/`postError`/`postEvent` shapes (`panel-shared.ts:42-52`): `postError`→`{type:'response',id,data:{error,...extra}}`, so the bridge's `data.error`-truthy → handler-error mapping is correct. `tryHandle` always funnels through `postMessage` (even thrown errors via `.catch`→`postError`), so the bridge promise always settles.
> - `compileNlRule`'s dynamic `require('vscode')` (`rule-compiler.ts:77`) resolves to the stub — esbuild's CLI-entry `alias` (`esbuild.mjs:189`) applies to `require()` of the bare specifier, not just static imports. The `usedLlm:true` path is reachable.
> - `reviewContextFiles` emits `reviewProgress` `phase:'start'` (`panel-request-service.ts:846`) *before* the empty-payload `postError` (`:847`), so Task 12's event assertion is sound.
> - The fake-LLM fixture's prompt-substring router matches every real system prompt (`multiple-choice questions`, `code comparison rounds`, `Did you know`, `learning resource`, `repeatable activities`, `recommending GitHub Copilot customization`, `evaluating AI coding assistant context files`, `rule compiler`, `SKILL.md` all confirmed present).
>
> **Resolved decisions to apply:**
> 1. **A/D collision on `v1-allowed.ts` (Task 4).** ~~Gate Task 4 on bucket A's `v1-allowed.ts` commit~~ — **RESOLVED 2026-05-28: bucket A landed (commit `942c0d2`); `v1-allowed.test.ts` asserts `toBe(42)`, so the baseline is fixed at 42 → 45.** Task 4 Step 0 is downgraded from a blocking gate to a fast sanity re-check (guards against a later rebase moving the baseline). Layer 1 (provider+stub) and Layer 2 no longer have any cross-bucket ordering dependency.
> 2. **No-key UX for the 9 service methods (Tasks 8/11).** Keep the BANNER_WORTHY removal, but the no-key path must return a **standalone-specific** error ("Set ANTHROPIC_API_KEY or OPENAI_API_KEY to enable AI features"), NOT the upstream "No language model available… GitHub Copilot" string. Add **one** no-key integration test (boot CLI with no LLM env, call `generateLearningQuiz`, assert a clean non-Copilot error). This honors the plan's stated "degrade gracefully when no API key" goal, which today is only true for `compileNlRule`.
> 3. **Where the message rewrite lives (Task 8 → revised by #6).** Implement the rewrite by **keying on the upstream "No language model available" string**, pinned by a standalone test (robust against the `discoverCatalog` case, which needs no LLM and would be mislabeled by a blanket `detectProvider()===null` gate). Drift risk is caught by the pinning test + the `abc0a6c`-baseline discipline.
> 4. **Provider-level timeout (Task 1).** `callLlmJson` (8 service methods) and `rule-compiler` (3 NL-rule paths) issue a single `fetch` with **no timeout and no cancellation trigger** — only `callLlm` (`generateSkillContent`) gets the 90s `withTimeout`/`cts.cancel()`. Add a provider-level ceiling in `llm-provider.ts` `send()`: own `AbortController` + `setTimeout` (`COACH_LLM_TIMEOUT_MS`, default ~90s), composed with the caller's signal. Bounds all 13 paths against a *stalled* (not refused) network and makes Task 2's cancellation test load-bearing everywhere. Correct the plan's narrative that claims the 90s timeout already covers the JSON paths.
> 5. **Anthropic `max_tokens` default (Task 1).** Raise the default from 8192 → **16384** (still `COACH_LLM_MAX_TOKENS`-overridable). `max_tokens` is a ceiling, not billed unless generated; 16384 is free insurance against `reviewContextFiles` (up to 5 workspaces of structured findings) truncating JSON → 3 failed retries → systematic failure. Update the Task 1 test asserting `body.max_tokens` (currently expects 8192) and the `COACH_LLM_MAX_TOKENS` override test.
> 6. **`explainOccurrence` (NL-rule trio coverage).** `explainOccurrence` (`panel-rpc.ts:895`) is **exposed** (anti-patterns page, `page-antipatterns.ts:680`), has **no heuristic fallback**, and returns `{ok:false,error:'…Copilot…'}` through the **registry tier** — bypassing the bridge-only rewrite of #3. Make the upstream-string rewrite a **shared helper** applied to BOTH the bridge AND a thin registry-result post-step in the dispatcher. Add one `explainOccurrence` integration test (offline → clean `{ok:false}` error; fake provider → `{ok:true, explanation}`). `generateRule`: keep it allowlisted to complete the trio, but its only caller is the degraded rule-editor — document it as "allowlisted; UI entry via rule-editor degraded" rather than investing in smoke. **(Superseded by decision 11: `generateRule` IS reachable via the anti-patterns "New Rule" modal; a smoke was added in Task 6.)**

### Round-2 grilling (2026-05-28 — resolved decisions to apply)

> A second `/grill-me` session resolved the six branches that the first session deferred. Like decisions 1–6 above, these are now **folded into the task bodies** (2026-05-28); the entries here remain as the decision record/rationale. Several were verified against the real code (recorded so the next agent need not re-check).
>
> 7. **Deliberately-RED commit in Task 1 → move the test to Task 2.** Relocate the `callLlmJson` OpenAI strict-mode self-heal test (currently Task 1 Step 1, lines 215–237) into the Task 2 step (it asserts a stub-`lm` capability, not provider shaping). Every commit then stays green and bisect stays clean. Drop Task 1 Step 4's `-t "mergeSameRole|detectProvider|Anthropic provider|OpenAI provider"` filter — with the test moved, Task 1's whole file passes. Update the Note at line 240 accordingly.
> 8. **Concurrent `reviewContextFiles` on one socket → accept for v1, document.** The UI already serializes: `runContextReview` (`page-config.ts:347`) sets `btn.disabled = true` for the in-flight request, so a second same-socket review cannot be triggered through normal use; cross-tab reviews are isolated by per-socket `emitEvent`. Id-correlating the id-less `reviewProgress` would require editing upstream `panel-request-service.ts` (invariant violation). Add a one-line note in Task 12 / the docs that this is an accepted upstream limitation.
> 9. **Model defaults → keep a single global default.** `claude-sonnet-4-6` / `gpt-4.1`, `COACH_LLM_MODEL`-overridable, applied uniformly to all 13 paths (the stub ignores the `family` selector by design). No cheaper-tier routing for quiz/did-you-know in v1: it would re-introduce per-call model selection into the stub (breaking the "selector ignored" invariant), and a weaker model risks malformed structured JSON → the `callLlmJson` 3-retry loop → erasing the savings. Cost rides on the user's own key. Per-feature routing is a clean v2 addition if usage data warrants it.
> 10. **`COACH_LLM_BASE_URL` + workspace egress → accept, add a transparency paragraph.** Both concerns are inherent, not introduced: the base-URL override points the user's *own* key at a host the *user* configured (the established proxy / local-model pattern; the key is only ever sent where `baseUrl` points), and `reviewContextFiles` sending instruction-file contents to the LLM IS the feature (identical to the VS Code/Copilot path). No code-level gate (a host allowlist would break legitimate proxies). In Task 14, add one paragraph to `STANDALONE-PARITY-GAPS.md` (or the standalone README) stating that AI features send prompts/code/instruction-file contents to the configured provider and that `COACH_LLM_BASE_URL` redirects the key to that host.
> 11. **`generateRule` reachability → decision #6 was WRONG; correct it + add a smoke.** `page-rule-editor.ts` is **dead** (`app.ts:645` routes the `rule-editor` case to `renderAntiPatterns`; `app.ts:17`: "page-rule-editor merged into page-antipatterns"). The **live** caller is the rule-editor modal's "Generate" button (`page-antipatterns-editor.ts:360`), opened by the static "+ New Rule" button (`page-antipatterns.ts:297` → `:1052` → `openRuleEditor(container, null)`). Opening the modal for a *new* rule does **not** call `getRuleEditor` (that fires only when editing, `:192`), and the anti-patterns page renders despite `getRuleEditor` being disabled because the shim resolves it to empty (`RESOLVE_EMPTY_WHEN_DISABLED`, `webview-shim.ts:34/191`) — so `renderAntiPatterns`'s bare `Promise.all` (`:220`) does not reject. So `generateRule` is genuinely reachable end-to-end, and this same mechanism is what makes decision #6's `explainOccurrence` reachability real. Action: (a) rewrite decision #6's "`generateRule`: only caller is the degraded rule-editor … don't invest in smoke" to the corrected reachability; (b) add one lightweight smoke mirroring Task 6 — drive `generateRule` through the shim's outbound channel on the `rule-editor`/anti-patterns page, assert it resolves with `markdown` and no error (uses Task 13's fake-provider sidecar; `generateRule` also has an offline template fallback at `panel-rpc.ts:1035`); (c) document that the modal's **Save Rule** (write path) and **Test Rule** (`runRuleTests`, deferred) stay degraded — that, not "generateRule unreachable," is the real degradation boundary.
>
> **Verified, no action needed (round 2):**
> - **Per-socket `emitEvent` is orthogonal to the render race.** `reviewProgress` event frames fire only during an in-flight, user-triggered review (long after connect/`dataReady`) and flow through the shim's catch-all `window.postMessage(frame, '*')` (`webview-shim.ts:202`); they never touch the `pendingRpc` / `dataReady` / deep-link quiescence path (`:181-201`) that the `standalone-shim-datatready-inbound-race` / Task R2 work lives in. The event-frame branch does not decrement `pendingRpc` (it is not a `response`), so it cannot perturb the deep-link serializer.

---

## Why the layers are sequenced

- **Layer 1 is the enabler** — both NL-rule (Layer 2) and the service bridge (Layer 3) depend on a working `lm` stub. Build and verify it first, in isolation.
- **Layer 2 and Layer 3 both depend on Layer 1 but are independent of each other** — they can be done in either order after Layer 1. This plan does Layer 2 first because it is smaller (3 allowlist entries, no new infra) and exercises the enabler end-to-end through an already-wired dispatch path before the larger bridge work.
- **Each layer ends with an additive-only invariant check.** Do not start a later layer until the current one is fully committed and green.

## File structure

| Path | Layer | Change | Responsibility |
| --- | --- | --- | --- |
| `src/standalone/llm-provider.ts` | 1 | **Create** | `detectProvider(env)` + Anthropic/OpenAI clients; non-streaming single-`fetch`, single-element `AsyncIterable<string>`; consecutive same-role merge |
| `src/standalone/__tests__/llm-provider.test.ts` | 1 | **Create** | Provider request shaping, merge + `max_tokens` guard, auto-detect precedence, OpenAI `response_format` forwarding, `callLlmJson` OpenAI strict-mode self-heal |
| `src/standalone/vscode-stub.ts` | 1 | Modify | Add `lm`, `LanguageModelChatMessage` (`.User`/`.Assistant`), `CancellationTokenSource`, `CancellationError` |
| `src/standalone/__tests__/vscode-stub.test.ts` | 1 | **Create** | `selectChatModels` with/without keys, selector-ignored regression, message shapes + Gap-2 merge, `sendRequest` no-token form, cancellation aborts |
| `src/standalone/v1-allowed.ts` | 2 | Modify | Add `explainOccurrence`, `generateRule`, `compileNlRule` (42 → 45) |
| `src/standalone/__tests__/v1-allowed.test.ts` | 2 | Modify | Assert size 45 + NL-rule membership |
| `tests/standalone/fixtures/fake-llm-server.mjs` | 2 | **Create** | Schema-valid canned LLM responses routed by system-prompt substring; in-process factory + forkable sidecar (reused by Layer 3) |
| `tests/standalone/integration/helpers.ts` | 2 | Modify (additive) | `bootCli` gains an optional `extraEnv` param |
| `tests/standalone/integration/cli-rpc-lifecycle.test.ts` | 2 & 3 | Modify | L2: `compileNlRule` offline degradation + LLM path. L3: `generateLearningQuiz`/`triageCatalog` ok + `reviewContextFiles` event |
| `tests/standalone/playwright/smoke.spec.ts` | 2 & 3 | Modify (append) | L2: Rule Playground NL→rule. L3: Learning quiz, Skill Finder, Context Health |
| `src/standalone/v1-service-allowed.ts` | 3 | **Create** | Frozen set of the 9 exposed `PanelRequestService` methods |
| `src/standalone/__tests__/v1-service-allowed.test.ts` | 3 | **Create** | Assert size 9 + membership + frozen |
| `src/standalone/request-service-bridge.ts` | 3 | **Create** | `dispatchServiceMethod(method, params, ctx)` — fresh capturing service per call |
| `src/standalone/__tests__/request-service-bridge.test.ts` | 3 | **Create** | response→ok, error→handler-error (incl. LLM-unavailable rewrite), event→emitEvent (no resolve), unknown→unknown-method |
| `src/standalone/llm-unavailable.ts` | 3 | **Create** | `rewriteLlmUnavailable` (DispatchResult `error.message`) + `rewriteLlmUnavailableInData` (registry `data.error`) + `LLM_UNAVAILABLE_HINT`; rewrites the upstream "No language model available…Copilot" string for standalone (grilling decisions 2/3/6) |
| `src/standalone/__tests__/llm-unavailable.test.ts` | 3 | **Create** | marker → hint (both shapes); non-marker + `ok` pass through (discoverCatalog robustness) |
| `src/standalone/dispatcher.ts` | 3 | Modify | `DispatchContext.emitEvent?`; new service-bridge tier before the allowlist gate; registry-tier `data.error` rewrite (`rewriteLlmUnavailableInData`) |
| `src/standalone/__tests__/dispatcher.test.ts` | 3 | Modify | Service method routes to bridge (no data-ready guard); NL-rule routes to registry |
| `src/standalone/server.ts` | 3 | Modify | Build per-socket `emitEvent` and merge onto the dispatch ctx |
| `src/standalone/webview-shim.ts` | 3 | Modify | Remove 6 now-live methods from `BANNER_WORTHY` (10 → 4) |
| `src/standalone/__tests__/webview-shim.test.ts` | 3 | Modify | `BANNER_WORTHY.size` 10 → 4; `triageCatalog` flips to not-banner-worthy |
| `tests/standalone/playwright/global-setup.ts` | 3 | Modify | Fork the fake-llm sidecar; pass `ANTHROPIC_API_KEY` + `COACH_LLM_BASE_URL` to the CLI |
| `tests/standalone/playwright/global-teardown.ts` | 3 | Modify | Kill the fake-llm sidecar pid |
| `docs-fork/STANDALONE-PARITY-GAPS.md` | 3 | Modify | Mark bucket D shipped |

**Invariant:** every `src/` edit lives under `src/standalone/`. `tests/`, `docs-fork/`, and `esbuild.mjs` are not under `src/`. `panel-llm.ts`, `core/rule-compiler.ts`, `panel-rpc.ts`, and `panel-request-service.ts` are **not** touched. Verified at the end of each layer.

---

# Layer 1 — Enabler (LLM provider + `vscode.lm` stub)

## Task 1: Create the LLM provider client — ✅ DONE (commit `e2eb851`; see Execution-status note re: OpenAI `postJson` deviation)

**Files:**
- Create: `src/standalone/llm-provider.ts`
- Test: `src/standalone/__tests__/llm-provider.test.ts`

Both `panel-llm.ts` (`callLlm`/`callLlmJson`) and `core/rule-compiler.ts` (`compileLlm`) accumulate the full response text before acting (`for await (const chunk of response.text) text += chunk`), and nothing renders partial tokens. So the provider issues **one** `fetch` (no `stream:true`), parses the complete body, and yields it as a **single-element** `AsyncIterable<string>` — this satisfies the `for await` consumers identically, preserves `AbortController` cancellation, and is bounded by the provider-level timeout added below (the existing 90 s `withTimeout` only wraps `callLlm`, **not** the `callLlmJson` or `rule-compiler` paths — grilling decision 4, corrected here). Real streaming is an explicit v1 non-goal; the `AsyncIterable<string>` shape is retained so a future SSE impl is a drop-in.

Anthropic requires `max_tokens` and rejects consecutive same-role turns; callers emit `[User(system), User(user)]` and `generateRule` emits `[User, User, Assistant, User]`, so the provider merges consecutive same-role turns (join with `\n\n`) before sending. After merging, the leading `User`s collapse to one `user` turn and the first message is `user`, as required. OpenAI forwards `response_format` from `options.modelOptions`; the same-role merge is a harmless no-op there.

**Provider-level timeout (grilling decision 4 — folded).** Only `callLlm` (`generateSkillContent`) is wrapped in `panel-llm.ts`'s 90 s `withTimeout` + `cts.cancel()`; `callLlmJson` (the 8 service JSON paths) and `core/rule-compiler.ts` (the 3 NL-rule paths) issue their `fetch` with **no timeout and no cancellation trigger**. So the provider's `send()` owns its own ceiling: an internal `AbortController` aborted by a `setTimeout` (`COACH_LLM_TIMEOUT_MS`, default 90 000 ms), **composed** with the caller's signal (whichever fires first aborts the `fetch`). This bounds all 13 paths against a *stalled* (not refused) network and makes Task 2's cancellation wire load-bearing everywhere.

**`max_tokens` default = 16384 (grilling decision 5 — folded).** Anthropic's `max_tokens` is a ceiling, not billed unless generated, so the default is **16384** (still `COACH_LLM_MAX_TOKENS`-overridable) — cheap insurance against `reviewContextFiles` (up to 5 workspaces of structured findings) truncating its JSON → 3 failed `callLlmJson` retries → systematic failure.

**Single global model default (grilling decision 9 — folded).** `detectProvider` returns one model per provider (`claude-sonnet-4-6` / `gpt-4.1`, `COACH_LLM_MODEL`-overridable) applied uniformly to all 13 paths — the stub ignores the `family` selector (Task 2). No cheaper-tier routing for the high-volume small features (quiz/did-you-know) in v1: it would re-introduce per-call model selection (breaking "selector ignored") and a weaker model risks malformed JSON → the retry loop. Per-feature routing is a clean v2 addition; cost rides on the user's own key.

- [ ] **Step 1: Write the failing test**

Create `src/standalone/__tests__/llm-provider.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectProvider, mergeSameRole, type ProviderMessage } from '../llm-provider';

// Save/restore the LLM env between tests so detection is deterministic.
const LLM_ENV_KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'COACH_LLM_MODEL', 'COACH_LLM_BASE_URL', 'COACH_LLM_MAX_TOKENS', 'COACH_LLM_TIMEOUT_MS'];
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(LLM_ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of LLM_ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of LLM_ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const U = (content: string): ProviderMessage => ({ role: 'user', content });
const A = (content: string): ProviderMessage => ({ role: 'assistant', content });
async function collect(it: AsyncIterable<string>): Promise<string> {
  let out = '';
  for await (const chunk of it) out += chunk;
  return out;
}

describe('mergeSameRole', () => {
  it('collapses [user, user] into one user turn joined by a blank line', () => {
    expect(mergeSameRole([U('a'), U('b')])).toEqual([{ role: 'user', content: 'a\n\nb' }]);
  });

  it('preserves alternating turns and merges the leading users of generateRule retry shape', () => {
    expect(mergeSameRole([U('sys'), U('gen'), A('res'), U('fix')])).toEqual([
      { role: 'user', content: 'sys\n\ngen' },
      { role: 'assistant', content: 'res' },
      { role: 'user', content: 'fix' },
    ]);
  });
});

describe('detectProvider', () => {
  it('returns null with no keys', () => {
    expect(detectProvider({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it('prefers Anthropic when ANTHROPIC_API_KEY is present (even alongside OPENAI_API_KEY)', () => {
    const p = detectProvider({ ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o' } as NodeJS.ProcessEnv);
    expect(p?.name).toBe('anthropic');
    expect(p?.model).toBe('claude-sonnet-4-6');
  });

  it('falls back to OpenAI when only OPENAI_API_KEY is present', () => {
    const p = detectProvider({ OPENAI_API_KEY: 'o' } as NodeJS.ProcessEnv);
    expect(p?.name).toBe('openai');
    expect(p?.model).toBe('gpt-4.1');
  });

  it('honors COACH_LLM_MODEL override for the detected provider', () => {
    const p = detectProvider({ ANTHROPIC_API_KEY: 'a', COACH_LLM_MODEL: 'claude-opus-4-7' } as NodeJS.ProcessEnv);
    expect(p?.model).toBe('claude-opus-4-7');
  });
});

describe('Anthropic provider request shaping', () => {
  it('posts a merged single leading user turn with a non-null max_tokens and the version header', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'hello' }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const p = detectProvider({ ANTHROPIC_API_KEY: 'secret' } as NodeJS.ProcessEnv)!;
    const text = await collect(p.send([U('sys'), U('user')], {}, new AbortController().signal));

    expect(text).toBe('hello');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect((init.headers as Record<string, string>)['anthropic-version']).toBe('2023-06-01');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('secret');
    const body = JSON.parse(init.body as string);
    expect(body.max_tokens).toBe(16384); // grilling decision 5: ceiling raised 8192 -> 16384
    expect(body.messages).toEqual([{ role: 'user', content: 'sys\n\nuser' }]);
  });

  it('respects COACH_LLM_BASE_URL and COACH_LLM_MAX_TOKENS', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ content: [{ text: 'x' }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const p = detectProvider({ ANTHROPIC_API_KEY: 'k', COACH_LLM_BASE_URL: 'http://127.0.0.1:9', COACH_LLM_MAX_TOKENS: '256' } as NodeJS.ProcessEnv)!;
    await collect(p.send([U('hi')], {}, new AbortController().signal));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:9/v1/messages');
    expect(JSON.parse(init.body as string).max_tokens).toBe(256);
  });

  it('throws an error whose message includes the response body on a non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 429 })));
    const p = detectProvider({ ANTHROPIC_API_KEY: 'k' } as NodeJS.ProcessEnv)!;
    await expect(collect(p.send([U('hi')], {}, new AbortController().signal))).rejects.toThrow(/429.*rate limited/);
  });
});

describe('OpenAI provider request shaping', () => {
  it('posts to /chat/completions with a Bearer token and forwards response_format', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'oai' } }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const p = detectProvider({ OPENAI_API_KEY: 'tok' } as NodeJS.ProcessEnv)!;
    const rf = { type: 'json_schema', json_schema: { name: 'x', strict: true, schema: {} } };
    const text = await collect(p.send([U('hi')], { modelOptions: { response_format: rf } }, new AbortController().signal));
    expect(text).toBe('oai');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body as string).response_format).toEqual(rf);
  });
});

describe('provider-level timeout (grilling decision 4)', () => {
  it('aborts the fetch and throws a timeout error after COACH_LLM_TIMEOUT_MS', async () => {
    // fetch that only settles on abort — the timeout ceiling must trip it.
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }),
    ));
    const p = detectProvider({ ANTHROPIC_API_KEY: 'k', COACH_LLM_TIMEOUT_MS: '20' } as NodeJS.ProcessEnv)!;
    await expect(collect(p.send([U('hi')], {}, new AbortController().signal))).rejects.toThrow(/timed out/i);
  });

  it('aborts when the caller signal fires first (composed with the timeout ceiling)', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }),
    ));
    const p = detectProvider({ ANTHROPIC_API_KEY: 'k' } as NodeJS.ProcessEnv)!; // default 90s ceiling, won't fire
    const ac = new AbortController();
    const iterate = collect(p.send([U('hi')], {}, ac.signal));
    ac.abort();
    await expect(iterate).rejects.toThrow(/abort/i);
  });
});
```

> Note (grilling decision 7): the `callLlmJson` OpenAI strict-mode self-heal test was **moved out of this file into Task 2** (`vscode-stub.test.ts`) — it imports the real `panel-llm` and only passes once the stub `lm` exists, so keeping it here would force a known-red Task 1 commit. Every test in *this* file (incl. the provider-level timeout block above) passes at the end of Task 1, with **no `-t` filter** needed.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/standalone/__tests__/llm-provider.test.ts`
Expected: FAIL — cannot resolve `../llm-provider` (module does not exist).

- [ ] **Step 3: Create the provider module**

Create `src/standalone/llm-provider.ts`:

```ts
// src/standalone/llm-provider.ts
// Minimal LLM client consumed ONLY through vscode-stub.ts's `lm` surface (which
// panel-llm.ts and core/rule-compiler.ts already call). Non-streaming v1: one fetch,
// parse the whole body, yield it as a single-element AsyncIterable<string> so the
// upstream `for await (const chunk of response.text)` consumers work unchanged. The
// AsyncIterable shape is retained so a future SSE impl is a drop-in.
// See docs-fork/superpowers/spec/2026-05-27-standalone-parity-bucket-d-design.md § A.

export interface ProviderMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface SendOptions {
  /** Forwarded verbatim from sendRequest's options.modelOptions (OpenAI response_format). */
  modelOptions?: Record<string, unknown>;
}

export interface LlmProvider {
  readonly name: 'anthropic' | 'openai';
  readonly model: string;
  send(messages: ProviderMessage[], options: SendOptions, signal: AbortSignal): AsyncIterable<string>;
}

/**
 * Collapse consecutive same-role turns into one (join content with a blank line).
 * Anthropic rejects consecutive same-role messages; callers emit [User, User] and
 * generateRule emits [User, User, Assistant, User]. Harmless no-op for already-
 * alternating input (OpenAI). Builds fresh objects so the caller's array is untouched.
 */
export function mergeSameRole(messages: ProviderMessage[]): ProviderMessage[] {
  const merged: ProviderMessage[] = [];
  for (const m of messages) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.content += `\n\n${m.content}`;
    else merged.push({ role: m.role, content: m.content });
  }
  return merged;
}

function resolveTimeoutMs(env: NodeJS.ProcessEnv): number {
  return Number(env.COACH_LLM_TIMEOUT_MS) || 90_000;
}

/**
 * POST JSON with a provider-level timeout ceiling composed with the caller's signal
 * (grilling decision 4). Only callLlm is wrapped in panel-llm's 90s withTimeout; callLlmJson
 * (8 service paths) and rule-compiler (3 NL-rule paths) issue their fetch with no timeout and no
 * cancellation trigger, so this ceiling is what bounds a STALLED (not refused) network across all
 * 13 paths. Whichever signal — the caller's cts or this timeout — fires first aborts the fetch.
 */
async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = (): void => controller.abort();
  if (signal.aborted) controller.abort();
  else signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    return await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
  } catch (err) {
    if (timedOut) throw new Error(`LLM request timed out after ${Math.round(timeoutMs / 1000)}s`);
    throw err;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic' as const;
  readonly model: string;
  private readonly key: string;
  private readonly baseUrl: string;
  private readonly maxTokens: number;
  private readonly timeoutMs: number;

  constructor(key: string, env: NodeJS.ProcessEnv) {
    this.key = key;
    this.model = env.COACH_LLM_MODEL || 'claude-sonnet-4-6';
    this.baseUrl = (env.COACH_LLM_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
    // Ceiling, not billed unless generated (grilling decision 5): 16384 guards reviewContextFiles JSON.
    this.maxTokens = Number(env.COACH_LLM_MAX_TOKENS) || 16384;
    this.timeoutMs = resolveTimeoutMs(env);
  }

  async *send(messages: ProviderMessage[], _options: SendOptions, signal: AbortSignal): AsyncIterable<string> {
    const body = {
      model: this.model,
      max_tokens: this.maxTokens,
      messages: mergeSameRole(messages).map((m) => ({ role: m.role, content: m.content })),
    };
    const res = await postJson(
      `${this.baseUrl}/v1/messages`,
      { 'content-type': 'application/json', 'x-api-key': this.key, 'anthropic-version': '2023-06-01' },
      body,
      signal,
      this.timeoutMs,
    );
    if (!res.ok) throw new Error(`Anthropic request failed (${res.status}): ${await res.text()}`);
    const json = (await res.json()) as { content?: Array<{ text?: string }> };
    yield json.content?.[0]?.text ?? '';
  }
}

class OpenAiProvider implements LlmProvider {
  readonly name = 'openai' as const;
  readonly model: string;
  private readonly key: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(key: string, env: NodeJS.ProcessEnv) {
    this.key = key;
    this.model = env.COACH_LLM_MODEL || 'gpt-4.1';
    this.baseUrl = (env.COACH_LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.timeoutMs = resolveTimeoutMs(env);
  }

  async *send(messages: ProviderMessage[], options: SendOptions, signal: AbortSignal): AsyncIterable<string> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: mergeSameRole(messages).map((m) => ({ role: m.role, content: m.content })),
    };
    const responseFormat = options.modelOptions?.response_format;
    if (responseFormat) body.response_format = responseFormat;
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.key}` },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw new Error(`OpenAI request failed (${res.status}): ${await res.text()}`);
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    yield json.choices?.[0]?.message?.content ?? '';
  }
}

/** Auto-detect a provider from env. ANTHROPIC_API_KEY wins, then OPENAI_API_KEY, else null. */
export function detectProvider(env: NodeJS.ProcessEnv = process.env): LlmProvider | null {
  if (env.ANTHROPIC_API_KEY) return new AnthropicProvider(env.ANTHROPIC_API_KEY, env);
  if (env.OPENAI_API_KEY) return new OpenAiProvider(env.OPENAI_API_KEY, env);
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/standalone/__tests__/llm-provider.test.ts`
Expected: PASS — the whole file (`mergeSameRole`, `detectProvider`, both provider-shaping blocks, and the provider-level timeout block). No `-t` filter is needed: the `callLlmJson` self-heal test that used to stay red here now lives in Task 2 (grilling decision 7).

- [ ] **Step 5: Commit**

```bash
git add src/standalone/llm-provider.ts src/standalone/__tests__/llm-provider.test.ts
git commit -m "feat(standalone): add llm-provider (Anthropic/OpenAI, non-streaming, env-detected)"
```

---

## Task 2: Implement the `vscode.lm` surface in the stub — ✅ DONE (commit `6456e59`)

**Files:**
- Modify: `src/standalone/vscode-stub.ts`
- Test: `src/standalone/__tests__/vscode-stub.test.ts`

`panel-llm.ts` does `import * as vscode from 'vscode'` and calls `vscode.lm.selectChatModels(...)`, `model.sendRequest(messages, options, cts.token)`, `vscode.LanguageModelChatMessage.User/.Assistant`, `new vscode.CancellationTokenSource()`, and `vscode.CancellationError`. `core/rule-compiler.ts` does `require('vscode')` then `vscode.lm.selectChatModels({family})` and `model.sendRequest(messages, {})` **with no token**. Both resolve `vscode` to this stub (esbuild alias for the CLI bundle; vitest alias for tests). Implementing `lm` here is the single seam that lights up both call sites with **zero edits** to `panel-llm.ts` or `rule-compiler.ts`.

The `selector` (including `family`) is **ignored**: it is a Copilot-catalog concept with no analogue here, and honoring `family:'gpt-4.1'` would wrongly return `[]` for an Anthropic provider. `onCancellationRequested` is the wire that lets `sendRequest`'s `AbortController` abort the in-flight `fetch` when `panel-llm.ts` calls `cts.cancel()` (also fired by the 90 s timeout); polling `isCancellationRequested` cannot interrupt a pending `await fetch`.

- [ ] **Step 1: Write the failing test**

Create `src/standalone/__tests__/vscode-stub.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from '../vscode-stub';
import { callLlmJson, SCHEMA_CONTEXT_REVIEW } from '../../webview/panel-llm';

const LLM_ENV_KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'COACH_LLM_MODEL', 'COACH_LLM_BASE_URL', 'COACH_LLM_MAX_TOKENS', 'COACH_LLM_TIMEOUT_MS'];
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(LLM_ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of LLM_ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of LLM_ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.unstubAllGlobals();
});

describe('LanguageModelChatMessage', () => {
  it('User and Assistant produce role-tagged messages', () => {
    expect(vscode.LanguageModelChatMessage.User('hi')).toEqual({ role: 'user', content: 'hi' });
    expect(vscode.LanguageModelChatMessage.Assistant('ok')).toEqual({ role: 'assistant', content: 'ok' });
  });
});

describe('lm.selectChatModels', () => {
  it('returns [] when no provider key is configured', async () => {
    expect(await vscode.lm.selectChatModels({})).toEqual([]);
  });

  it('returns one model when a key is configured', async () => {
    process.env.ANTHROPIC_API_KEY = 'k';
    expect(await vscode.lm.selectChatModels({})).toHaveLength(1);
  });

  it('IGNORES the family selector — returns the Anthropic model for family:gpt-4.1 (selector-ignored regression)', async () => {
    process.env.ANTHROPIC_API_KEY = 'k'; // no OPENAI key
    const models = await vscode.lm.selectChatModels({ family: 'gpt-4.1' });
    expect(models).toHaveLength(1); // would be [] if the family selector were honored
  });
});

describe('model.sendRequest', () => {
  it('streams the provider text as a single chunk WITH NO token argument (rule-compiler form)', async () => {
    process.env.ANTHROPIC_API_KEY = 'k';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ content: [{ text: 'done' }] }), { status: 200 })));
    const [model] = await vscode.lm.selectChatModels({});
    const res = model.sendRequest([vscode.LanguageModelChatMessage.User('hi')], {}); // no token
    let text = '';
    for await (const chunk of res.text) text += chunk;
    expect(text).toBe('done');
  });

  it('aborts the in-flight fetch when the cancellation token fires', async () => {
    process.env.ANTHROPIC_API_KEY = 'k';
    // fetch that only settles on abort.
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }),
    ));
    const cts = new vscode.CancellationTokenSource();
    const [model] = await vscode.lm.selectChatModels({});
    const res = model.sendRequest([vscode.LanguageModelChatMessage.User('hi')], {}, cts.token);
    const iterate = (async () => { for await (const _ of res.text) { /* drain */ } })();
    cts.cancel();
    await expect(iterate).rejects.toThrow(/abort/i);
  });
});

describe('callLlmJson OpenAI strict-mode self-heal through the stub lm (grilling decision 7)', () => {
  // Moved here from llm-provider.test.ts: it imports the real panel-llm, whose `vscode` resolves
  // to THIS stub via the vitest alias — so it only passes once `lm` exists (this task).
  it('drops modelOptions and retries in plain mode after a response_format 400', async () => {
    process.env.OPENAI_API_KEY = 'tok';
    const valid = JSON.stringify({ items: [] });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('Invalid schema for response_format: additionalProperties required', { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: valid } }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callLlmJson<{ items: unknown[] }>(
      [{ role: 'user', content: 'review' } as never],
      SCHEMA_CONTEXT_REVIEW,
    );
    expect(result).toEqual({ items: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).response_format).toBeDefined();
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string).response_format).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/standalone/__tests__/vscode-stub.test.ts`
Expected: FAIL — `vscode.lm` / `vscode.LanguageModelChatMessage` / `vscode.CancellationTokenSource` are `undefined`.

- [ ] **Step 3: Extend the stub**

Replace the entire contents of `src/standalone/vscode-stub.ts` with:

```ts
// src/standalone/vscode-stub.ts
// Resolves the transitive `import * as vscode` pulled in by reused webview files
// (panel-shared.ts:7 via getRpcHandler) and the dynamic `require('vscode')` in
// core/rule-compiler.ts. Provides Uri.joinPath (getDashboardHtml -> panel-html.ts:11)
// AND the `lm` surface that panel-llm.ts + rule-compiler.ts consume (bucket D).
import { detectProvider, type ProviderMessage, type SendOptions } from './llm-provider';

export const Uri = {
  joinPath: (_base: unknown, ...parts: string[]) => ({
    path: parts.join('/'),
    fsPath: parts.join('/'),
  }),
};

// --- vscode.lm surface (bucket D) ----------------------------------------------
// See docs-fork/superpowers/spec/2026-05-27-standalone-parity-bucket-d-design.md § A.

export const LanguageModelChatMessage = {
  User: (content: string): ProviderMessage => ({ role: 'user', content }),
  Assistant: (content: string): ProviderMessage => ({ role: 'assistant', content }),
};

export class CancellationError extends Error {
  constructor() {
    super('Canceled');
    this.name = 'CancellationError';
  }
}

interface CancellationListener {
  dispose(): void;
}

class StubCancellationToken {
  isCancellationRequested = false;
  private readonly callbacks: Array<() => void> = [];
  // The wire that lets sendRequest's AbortController abort an in-flight fetch when
  // panel-llm.ts calls cts.cancel() (also fired by the 90s withTimeout). Polling
  // isCancellationRequested cannot interrupt a pending `await fetch`.
  onCancellationRequested(cb: () => void): CancellationListener {
    this.callbacks.push(cb);
    return { dispose() {} };
  }
  _fire(): void {
    if (this.isCancellationRequested) return;
    this.isCancellationRequested = true;
    for (const cb of this.callbacks) cb();
  }
}

export class CancellationTokenSource {
  readonly token = new StubCancellationToken();
  cancel(): void {
    this.token._fire();
  }
  dispose(): void {}
}

interface StubModel {
  sendRequest(
    messages: ProviderMessage[],
    options?: { modelOptions?: Record<string, unknown> },
    token?: { onCancellationRequested(cb: () => void): CancellationListener },
  ): { text: AsyncIterable<string> };
}

function makeModel(provider: NonNullable<ReturnType<typeof detectProvider>>): StubModel {
  return {
    sendRequest(messages, options, token) {
      const controller = new AbortController();
      // `token` is optional — rule-compiler.ts calls sendRequest(messages, {}) with none.
      token?.onCancellationRequested(() => controller.abort());
      const opts: SendOptions = { modelOptions: options?.modelOptions };
      // provider.send is a lazy async generator: the fetch fires on first iteration.
      return { text: provider.send(messages, opts, controller.signal) };
    },
  };
}

export const lm = {
  // The selector (incl. family) is intentionally IGNORED — see design § A. Returns one
  // model when a provider is configured, else [] (panel-llm.ts:321 then throws its
  // descriptive "No language model available" error; rule-compiler.ts:87 falls back to
  // its heuristic template).
  async selectChatModels(_selector?: { family?: string }): Promise<StubModel[]> {
    const provider = detectProvider();
    return provider ? [makeModel(provider)] : [];
  },
};

export default { Uri, lm, LanguageModelChatMessage, CancellationTokenSource, CancellationError };
```

- [ ] **Step 4: Run the stub tests + the provider suite to verify they pass**

Run: `npx vitest run src/standalone/__tests__/vscode-stub.test.ts src/standalone/__tests__/llm-provider.test.ts`
Expected: PASS — including the `callLlmJson` OpenAI strict-mode self-heal test now living in `vscode-stub.test.ts` (reachable through the stub `lm` this task adds; grilling decision 7).

- [ ] **Step 5: Run the existing standalone suites to confirm no regression**

The stub is imported transitively by `dispatcher.test.ts`, `standalone-html.test.ts`, etc. Confirm they still pass with the expanded stub.
Run: `npx vitest run src/standalone/__tests__`
Expected: PASS (all existing standalone unit tests).

- [ ] **Step 6: Commit**

```bash
git add src/standalone/vscode-stub.ts src/standalone/__tests__/vscode-stub.test.ts
git commit -m "feat(standalone): implement vscode.lm in the stub (lights up panel-llm + rule-compiler)"
```

---

## Task 3: Layer 1 build + invariant check — ✅ DONE (verification only, no commit; build green, invariant verified per adjusted expectation above)

**Files:** none (verification only)

- [ ] **Step 1: Build the standalone bundle (proves the provider + stub compile into the CLI bundle)**

Run: `npm run build`
Expected: prints `Build complete.` and exits 0. No `esbuild.mjs` change is needed — the stub is already aliased into the standalone CLI bundle (unlike bucket A's separate webview bundle), so `llm-provider.ts` (imported by the stub) is bundled automatically.

- [ ] **Step 2: Verify the additive-only invariant**

Run: `git diff --name-only abc0a6c -- src/`
Expected: every line is under `src/standalone/` (specifically `src/standalone/llm-provider.ts`, `src/standalone/vscode-stub.ts`, and `src/standalone/__tests__/*`). Use the documented fork baseline `abc0a6c`, **not** `upstream/main` (it has advanced and shows false positives). The grep form must print nothing:

```powershell
git diff --name-only abc0a6c -- src/ | Select-String -NotMatch '^src/standalone/'
```

If any upstream `src/` file outside `src/standalone/` appears, stop and revert it.

---

# Layer 2 — NL-rule wiring (`explainOccurrence`, `generateRule`, `compileNlRule`)

> Do not begin until Layer 1 is fully committed and green.

The three NL-rule methods are **registry handlers** in `panel-rpc.ts` (`explainOccurrence:895`, `generateRule:996`, `compileNlRule:1134`), already returned by `getRpcHandler` and already invoked by the standalone dispatcher's registry tier. They need only (a) the LLM from Layer 1 and (b) an allowlist entry. `compileNlRule` routes through `core/rule-compiler.ts`'s own seam and **degrades to a heuristic template offline** (never errors); `explainOccurrence`/`generateRule` go through `panel-llm.ts` (`generateRule` has its own template fallback at `:1036`).

## Task 4: Add the NL-rule methods to `V1_ALLOWED`

**Files:**
- Modify: `src/standalone/v1-allowed.ts`
- Test: `src/standalone/__tests__/v1-allowed.test.ts`

**Ordering coupling with bucket A — RESOLVED (2026-05-28):** bucket A has landed (`git log` shows commit `942c0d2 feat(standalone): allowlist getDataExplorer + evaluateExpression (bucket A)`), and `v1-allowed.test.ts` asserts `toBe(42)` with both bucket-A methods present. The baseline is therefore **42 → 45** and the bucket-A membership assertions below stay. The conditional 40→43 fallback is no longer reachable.

- [ ] **Step 0 (sanity re-check — grilling decision 1): re-confirm the 42 baseline is still live**

Bucket A has landed (confirmed 2026-05-28; commit `942c0d2`), so the count and membership below are fixed at **42 → 45**. This step is now only a fast guard against a later rebase/regression having moved the baseline — run:

```bash
git log --oneline -- src/standalone/v1-allowed.ts
```

and confirm `src/standalone/__tests__/v1-allowed.test.ts` still asserts `toBe(42)` with the bucket-A `getDataExplorer`/`evaluateExpression` methods present. If — and only if — it unexpectedly reads something other than 42, stop and reconcile before editing; otherwise proceed with the literal counts below.

- [ ] **Step 1: Update the allowlist test to expect 45 and the three NL-rule methods**

In `src/standalone/__tests__/v1-allowed.test.ts`, change both `toBe(42)` assertions (line 6 and line 15) to `toBe(45)`, and append a new membership test after the bucket-A block (after line 29):

```ts
  it('includes the bucket-D NL-rule registry methods (now LLM-backed via the stub)', () => {
    expect(V1_ALLOWED.has('explainOccurrence')).toBe(true); // panel-rpc.ts:895
    expect(V1_ALLOWED.has('generateRule')).toBe(true); // panel-rpc.ts:996 (template fallback)
    expect(V1_ALLOWED.has('compileNlRule')).toBe(true); // panel-rpc.ts:1134 (heuristic fallback offline)
  });
```

Also update the first test's description from `'contains exactly the documented 42'` to `'contains exactly the documented 45'`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/standalone/__tests__/v1-allowed.test.ts`
Expected: FAIL — `expected 42 to be 45` and the three NL-rule membership assertions fail.

- [ ] **Step 3: Add the three methods to the frozen set**

In `src/standalone/v1-allowed.ts`, change the last grouping (lines 20-23) to add the three methods:

```ts
  'getRuleCoverage', 'getFieldSchema', 'getMetricPrimitives',
  'getFunctionCatalog', 'getMetricList', 'getDataExplorerFields',
  'getRegistryCatalog', 'getDataExplorer', 'evaluateExpression',
  'explainOccurrence', 'generateRule', 'compileNlRule',
]);
```

And update the file's top comment (lines 2-6) to:

```ts
// src/standalone/v1-allowed.ts
// The authoritative v1 method allowlist (see docs-fork/specs/00-overview.md).
// 40 read-only getRpcHandler methods + 2 bucket-A additions (getDataExplorer,
// evaluateExpression) + 3 bucket-D NL-rule methods (explainOccurrence, generateRule,
// compileNlRule, now LLM-backed via the vscode.lm stub) = 45. getRuleEditor is
// deliberately excluded (its handler calls require('vscode')); calibrateRule/
// runRuleTests are deferred (no exposed page reaches them).
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/standalone/__tests__/v1-allowed.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/standalone/v1-allowed.ts src/standalone/__tests__/v1-allowed.test.ts
git commit -m "feat(standalone): allowlist explainOccurrence + generateRule + compileNlRule (bucket D, 42->45)"
```

---

## Task 5: Fake-LLM fixture + `bootCli` env + integration for `compileNlRule`

**Files:**
- Create: `tests/standalone/fixtures/fake-llm-server.mjs`
- Modify: `tests/standalone/integration/helpers.ts`
- Modify: `tests/standalone/integration/cli-rpc-lifecycle.test.ts`

The integration suite forks the **built** `dist/standalone/cli.js`. To exercise the LLM path with no real key, we run a tiny in-process HTTP server returning schema-valid canned bodies, set `ANTHROPIC_API_KEY=test-key` + `COACH_LLM_BASE_URL` to point the forked CLI at it. `compileNlRule` is the load-bearing parity case: **offline it never errors** (heuristic fallback, `usedLlm:false`); with a provider returning valid rule markdown it reports `usedLlm:true`.

- [ ] **Step 1: Create the fake-LLM fixture**

Create `tests/standalone/fixtures/fake-llm-server.mjs`:

```js
// tests/standalone/fixtures/fake-llm-server.mjs
// Schema-valid canned LLM responses for standalone integration + Playwright smoke (no
// real API key). Routes on a substring of the system prompt (both providers carry it in
// messages[].content). Responses are shaped as Anthropic bodies ({content:[{text}]})
// because the fixtures set ANTHROPIC_API_KEY. Reused in-process by integration tests and
// forked as a sidecar by the Playwright global-setup.
import * as http from 'node:http';
import { pathToFileURL } from 'node:url';

// A rule markdown that parseRule accepts (mirrors core/rule-compiler.ts compileHeuristic
// output for a "short prompts" rule), wrapped in a fenced block as the LLM would emit it.
const RULE_MD = [
  '```markdown',
  '---',
  'id: flag-short-prompts',
  'name: flag short prompts',
  'group: prompt-quality',
  'severity: medium',
  'scope: requests',
  'version: 1',
  'tags: [custom]',
  'thresholds:',
  '  maxLength: 30',
  '  maxRatio: 0.3',
  '  minSample: 5',
  '---',
  '',
  '# Description',
  'flag short prompts',
  '',
  '# Filter',
  'messageLength < {{thresholds.maxLength}} AND messageLength > 0',
  '',
  '# Trigger',
  'ratio > {{thresholds.maxRatio}} AND count > {{thresholds.minSample}}',
  '',
  '# When Triggered',
  '{{count}} of {{total}} items ({{pct}}) match this pattern.',
  '',
  '# How to Improve',
  'Review the flagged items and adjust your workflow accordingly.',
  '',
  '# Examples',
  '"{{messageText | truncate:80}}"',
  '',
  '# Test Cases',
  '- input: { "messageLength": 10 }',
  '  expect: flagged',
  '- input: { "messageLength": 200 }',
  '  expect: clean',
  '```',
].join('\n');

const QUIZ = { items: Array.from({ length: 3 }, (_, i) => ({
  question: `Q${i}: what does this snippet print?`,
  choices: ['a', 'b', 'c', 'd'],
  correctIndex: 0,
  explanation: 'because of evaluation order',
  difficulty: 'easy',
  topic: 'general',
})) };
const CODE_REVIEW = { items: [{ snippetA: 'a()', snippetB: 'b()', betterSnippet: 'A', title: 't', category: 'performance', explanation: 'e', difficulty: 'easy', language: 'ts' }] };
const DID_YOU_KNOW = { items: [{ fact: 'a useful fact', project: 'demo', category: 'api' }] };
const RESOURCES = { items: [{ title: 'Docs', url: 'https://example.com/docs', type: 'Concept', reason: 'relevant' }] };
const TRIAGE = { items: [{ id: 'c1', verdict: 'strong', reason: 'repeated workflow', suggestedSkillName: 'parse-logs' }] };
const CATALOG = { items: [{ id: 'demo-skill', reason: 'matches your repeated packaging workflow' }] };
const CONTEXT = { items: [{ workspaceId: 'demo', overallScore: 70, categoryScores: { clarity: 70 }, findings: [], missingFiles: [], summary: 'ok' }] };

function routeText(prompt) {
  if (prompt.includes('multiple-choice questions')) return JSON.stringify(QUIZ);
  if (prompt.includes('code comparison rounds')) return JSON.stringify(CODE_REVIEW);
  if (prompt.includes('Did you know')) return JSON.stringify(DID_YOU_KNOW);
  if (prompt.includes('learning resource')) return JSON.stringify(RESOURCES);
  if (prompt.includes('repeatable activities')) return JSON.stringify(TRIAGE);
  if (prompt.includes('recommending GitHub Copilot customization')) return JSON.stringify(CATALOG);
  if (prompt.includes('evaluating AI coding assistant context files')) return JSON.stringify(CONTEXT);
  if (prompt.includes('rule compiler')) return RULE_MD;
  if (prompt.includes('SKILL.md')) return '# Demo Skill\n\nGenerated body.';
  return 'ok';
}

export function createFakeLlmServer() {
  return http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let prompt = '';
      try { prompt = JSON.stringify(JSON.parse(body || '{}').messages ?? []); } catch { /* ignore */ }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ content: [{ type: 'text', text: routeText(prompt) }] }));
    });
  });
}

// `node fake-llm-server.mjs [port]` — the Playwright sidecar. Prints the bound URL to stderr.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createFakeLlmServer();
  server.listen(Number(process.argv[2]) || 0, '127.0.0.1', () => {
    const addr = server.address();
    process.stderr.write(`fake-llm running at http://127.0.0.1:${addr.port}\n`);
  });
}
```

- [ ] **Step 2: Add an `extraEnv` parameter to `bootCli`**

In `tests/standalone/integration/helpers.ts`, change the `bootCli` signature (line 32) and the `fork` env (line 34):

```ts
export function bootCli(home: string, args: string[] = [], timeoutMs = 20_000, extraEnv: Record<string, string> = {}): Promise<Booted> {
  const child = fork(CLI, ['--no-open', ...args], {
    env: { ...process.env, HOME: home, USERPROFILE: home, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
```

(Everything else in `bootCli` stays unchanged.)

- [ ] **Step 3: Add the `compileNlRule` integration tests**

In `tests/standalone/integration/cli-rpc-lifecycle.test.ts`, add an import for the fixture near the top (after the existing helper import on line 7):

```ts
import { createFakeLlmServer } from '../fixtures/fake-llm-server.mjs';
import type { AddressInfo } from 'node:net';
```

Then add these tests inside the `describe('cli rpc + lifecycle', ...)` block (use the file's existing `track(...)` per-test cleanup helper and `wsWaitFor`):

```ts
  it('compileNlRule degrades to a heuristic template offline (no key -> usedLlm:false, never errors)', async () => {
    const home = makeTmpHome();
    const b = track(await bootCli(home, ['--port', '7362']), home); // no LLM env
    const ws = await wsConnect(b);
    await wsWaitFor(ws, 'dataReady');
    const res = await wsRequest(ws, 'compileNlRule', { prompt: 'flag short prompts' }, 'nl1');
    ws.close();

    const data = res.data as { usedLlm?: boolean; valid?: boolean; notes?: string[]; error?: string; markdown?: string };
    expect(data.error).toBeUndefined(); // parity: compileNlRule never surfaces an error offline
    expect(data.usedLlm).toBe(false);
    expect(data.markdown).toContain('# Filter'); // a scaffolded rule is still returned
    expect(data.notes?.some((n) => /LLM unavailable/i.test(n))).toBe(true);
  });

  it('compileNlRule uses the LLM when a provider is configured (usedLlm:true, valid:true)', async () => {
    const fake = createFakeLlmServer();
    await new Promise<void>((r) => fake.listen(0, '127.0.0.1', () => r()));
    const port = (fake.address() as AddressInfo).port;
    try {
      const home = makeTmpHome();
      const b = track(
        await bootCli(home, ['--port', '7363'], 20_000, { ANTHROPIC_API_KEY: 'test-key', COACH_LLM_BASE_URL: `http://127.0.0.1:${port}` }),
        home,
      );
      const ws = await wsConnect(b);
      await wsWaitFor(ws, 'dataReady');
      const res = await wsRequest(ws, 'compileNlRule', { prompt: 'flag short prompts' }, 'nl2');
      ws.close();

      const data = res.data as { usedLlm?: boolean; valid?: boolean };
      expect(data.usedLlm).toBe(true); // requires rule-compiler -> stub lm -> fake provider, and parseRule success
      expect(data.valid).toBe(true);
    } finally {
      fake.close();
    }
  });
```

- [ ] **Step 4: Build and run the integration tests**

Run: `npm run build` then `npx vitest run --config tests/standalone/integration/vitest.config.ts -t "compileNlRule"`
Expected: PASS (2 tests). (Sanity: if you revert Task 4's allowlist change and rebuild, both fail with `standalone-v1-disabled`.)

- [ ] **Step 5: Commit**

```bash
git add tests/standalone/fixtures/fake-llm-server.mjs tests/standalone/integration/helpers.ts tests/standalone/integration/cli-rpc-lifecycle.test.ts
git commit -m "test(standalone): fake-llm fixture + compileNlRule integration (offline degrade + LLM path)"
```

---

## Task 6: Smoke — Rule Playground NL→rule compiles + Rule Editor `generateRule`

**Files:**
- Modify: `tests/standalone/playwright/smoke.spec.ts`

The Playwright smoke boots a seeded CLI. The Rule Playground page reaches `compileNlRule`; offline (no key in CI yet — the fake-provider sidecar is wired in Layer 3, Task 13) it returns a scaffolded rule with `usedLlm:false` and **does not error**, so this smoke asserts the graceful path. This is append-only — do **not** touch the `NAV`/`activeId` block (bucket A's Stream 2 owns that).

**`generateRule` is genuinely reachable (grilling decision 11 — corrects decision 6).** `page-rule-editor.ts` is **dead** (`app.ts:645` routes the `rule-editor` case to `renderAntiPatterns`; `app.ts:17`: "page-rule-editor merged into page-antipatterns"). The **live** `generateRule` caller is the rule-editor modal's "Generate" button (`page-antipatterns-editor.ts:360`), opened by the static "+ New Rule" button (`page-antipatterns.ts:297` → `:1052` → `openRuleEditor(container, null)`). Opening the modal for a *new* rule does **not** call `getRuleEditor` (that fires only when editing, `:192`), and the anti-patterns page renders despite `getRuleEditor` being disabled because the shim resolves it to empty (`RESOLVE_EMPTY_WHEN_DISABLED`, `webview-shim.ts:34/191`), so `renderAntiPatterns`'s bare `Promise.all` (`:220`) does not reject. `generateRule` also has a template fallback (`panel-rpc.ts:1035`), so offline it returns markdown without erroring — this smoke asserts that graceful path (offline, no sidecar). **Degradation boundary to document:** the modal's **Save Rule** (write path) and **Test Rule** (`runRuleTests`, deferred) are *not* allowlisted, so a generated rule can't be saved/tested in standalone — that, not "generateRule unreachable," is the real limit.

- [ ] **Step 1: Append the NL→rule smoke test**

Append at the end of `tests/standalone/playwright/smoke.spec.ts`:

```ts
test('rule playground compiles a natural-language rule (degrades gracefully with no LLM key)', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(pageUrl('rule-playground'), { waitUntil: 'load' });
  await expect(page.locator('.nav-links a[data-page="rule-playground"]')).toHaveClass(/active/, { timeout: 15_000 });

  // Drive compileNlRule directly through the shim's outbound channel and confirm it resolves
  // (a non-error response). Offline it returns a heuristic template; it must never reject.
  const resolved = await page.evaluate(async () => {
    const api = (window as unknown as { acquireVsCodeApi: () => { postMessage: (m: unknown) => void } }).acquireVsCodeApi();
    return await new Promise<boolean>((resolve) => {
      const onMsg = (ev: MessageEvent) => {
        const f = ev.data as { type?: string; id?: string; data?: { error?: string; markdown?: string } };
        if (f.type === 'response' && f.id === 'smoke-compile-nl') {
          window.removeEventListener('message', onMsg);
          // Resolved with a scaffolded rule and no error => graceful NL-rule path works.
          resolve(typeof f.data?.markdown === 'string' && !f.data?.error);
        }
      };
      window.addEventListener('message', onMsg);
      api.postMessage({ type: 'request', id: 'smoke-compile-nl', method: 'compileNlRule', params: { prompt: 'flag short prompts' } });
      setTimeout(() => { window.removeEventListener('message', onMsg); resolve(false); }, 10_000);
    });
  });
  expect(resolved).toBe(true);
  expect(errors, `console errors on #rule-playground:\n${errors.join('\n')}`).toEqual([]);
});

test('rule editor generates a natural-language rule (generateRule degrades gracefully with no LLM key)', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  // generateRule's live UI entry is the "+ New Rule" modal on the anti-patterns page, reached via
  // the rule-editor route (app.ts:645 -> renderAntiPatterns). The page renders even though
  // getRuleEditor is disabled (shim RESOLVE_EMPTY_WHEN_DISABLED). generateRule has a template
  // fallback (panel-rpc.ts:1035), so offline it resolves with markdown and never rejects. We drive
  // it directly through the shim's outbound channel (page-agnostic) and assert the graceful path.
  await page.goto(pageUrl('rule-editor'), { waitUntil: 'load' });
  await expect(page.locator('main#content')).toBeVisible({ timeout: 15_000 });

  const resolved = await page.evaluate(async () => {
    const api = (window as unknown as { acquireVsCodeApi: () => { postMessage: (m: unknown) => void } }).acquireVsCodeApi();
    return await new Promise<boolean>((resolve) => {
      const onMsg = (ev: MessageEvent) => {
        const f = ev.data as { type?: string; id?: string; data?: { error?: string; markdown?: string } };
        if (f.type === 'response' && f.id === 'smoke-generate-rule') {
          window.removeEventListener('message', onMsg);
          // Resolved with markdown and no error => graceful generateRule path works offline.
          resolve(typeof f.data?.markdown === 'string' && !f.data?.error);
        }
      };
      window.addEventListener('message', onMsg);
      api.postMessage({ type: 'request', id: 'smoke-generate-rule', method: 'generateRule', params: { prompt: 'flag short prompts' } });
      setTimeout(() => { window.removeEventListener('message', onMsg); resolve(false); }, 10_000);
    });
  });
  expect(resolved).toBe(true);
  expect(errors, `console errors on #rule-editor:\n${errors.join('\n')}`).toEqual([]);
});
```

- [ ] **Step 2: Build and run the smoke suite**

Run: `npm run build` then `npm run test:playwright:standalone`
Expected: PASS — including the two new NL-rule tests (Rule Playground `compileNlRule` + Rule Editor `generateRule`; both titles contain "natural-language rule"). (If bucket A's in-flight smoke work makes the suite red for unrelated reasons, run just these: `playwright test --config=tests/standalone/playwright/playwright.config.ts -g "natural-language rule"`.)

- [ ] **Step 3: Commit**

```bash
git add tests/standalone/playwright/smoke.spec.ts
git commit -m "test(standalone): smoke for Rule Playground NL->rule compile + Rule Editor generateRule"
```

- [ ] **Step 4: Verify the Layer 2 additive-only invariant**

Run: `git diff --name-only abc0a6c -- src/ | Select-String -NotMatch '^src/standalone/'`
Expected: prints **only** the two known pre-existing `src/core/` files (`src/core/metric-engine.ts`, `src/core/parser-codex.test.ts`; see the Execution-status handoff note at the top of this plan) — and **no other** file outside `src/standalone/`. (The only Layer-2 `src/` change is `src/standalone/v1-allowed.ts` + its test; all other Layer-2 edits are under `tests/`.) Sharper guard: `git diff --name-only <commit-before-this-task>..HEAD -- src/ | grep -v '^src/standalone/'` must be empty. If any NEW file outside `src/standalone/` appears, stop and revert.

---

# Layer 3 — Service bridge (`PanelRequestService` → dispatcher)

> Do not begin until Layers 1–2 are fully committed and green.

`PanelRequestService` (`panel-request-service.ts`) is the **dropped service** — it is constructed in `panel.ts` and dispatched via `tryHandle(msg)`, returning data through `webview.postMessage(frame)`, and is **not wired into the standalone dispatcher at all**. The bridge constructs a **fresh `PanelRequestService` + capturing fake `Webview` per call** (not a singleton): event frames carry no `id` (so a singleton could not route an id-less `reviewProgress` event to the right caller), and `getAnalyzer`/`getParseResult` are fixed at construction (so per-call construction lets the closures capture the live call's ctx).

## Task 7: Create `V1_SERVICE_ALLOWED`

**Files:**
- Create: `src/standalone/v1-service-allowed.ts`
- Test: `src/standalone/__tests__/v1-service-allowed.test.ts`

The 9 exposed service methods: Learning ×4 (`generateLearningQuiz`, `generateCodeComparison`, `generateDidYouKnow`, `generateLearningResources`), Skill ×4 (`generateSkillContent`, `triageSkills`, `triageCatalog`, `discoverCatalog`), Context ×1 (`reviewContextFiles`). Excludes `createSkill` (opens VS Code chat — no LLM, no standalone analogue) and the bucket-B/E methods (`installSkill`/`installCatalogItem`/`exportSummary`, `getWorkspaceDeps`/`getSdlc*`) that also ride in `PanelRequestService` but are gated out here.

- [ ] **Step 1: Write the failing test**

Create `src/standalone/__tests__/v1-service-allowed.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { V1_SERVICE_ALLOWED } from '../v1-service-allowed';

describe('V1_SERVICE_ALLOWED', () => {
  it('contains exactly the documented 9 service methods', () => {
    expect(V1_SERVICE_ALLOWED.size).toBe(9);
  });

  it('is frozen / readonly', () => {
    expect(() => {
      (V1_SERVICE_ALLOWED as Set<string>).add('createSkill');
    }).toThrow();
    expect(V1_SERVICE_ALLOWED.size).toBe(9);
  });

  it('includes the Learning, Skill-triage, and Context methods', () => {
    for (const m of [
      'generateLearningQuiz', 'generateCodeComparison', 'generateDidYouKnow', 'generateLearningResources',
      'generateSkillContent', 'triageSkills', 'triageCatalog', 'discoverCatalog', 'reviewContextFiles',
    ]) {
      expect(V1_SERVICE_ALLOWED.has(m)).toBe(true);
    }
  });

  it('excludes createSkill (VS Code chat) and the bucket-B/E service methods', () => {
    expect(V1_SERVICE_ALLOWED.has('createSkill')).toBe(false);
    expect(V1_SERVICE_ALLOWED.has('installSkill')).toBe(false);
    expect(V1_SERVICE_ALLOWED.has('exportSummary')).toBe(false);
    expect(V1_SERVICE_ALLOWED.has('getWorkspaceDeps')).toBe(false);
    expect(V1_SERVICE_ALLOWED.has('getSdlcRepoScan')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/standalone/__tests__/v1-service-allowed.test.ts`
Expected: FAIL — cannot resolve `../v1-service-allowed`.

- [ ] **Step 3: Create the frozen set (mirroring `v1-allowed.ts`'s Proxy pattern)**

Create `src/standalone/v1-service-allowed.ts`:

```ts
// src/standalone/v1-service-allowed.ts
// The 9 PanelRequestService methods exposed via the standalone service-bridge tier
// (bucket D). Learning ×4 + Skill ×4 (incl. generateSkillContent) + Context ×1.
// Excludes createSkill (opens VS Code chat, not an LLM call) and the bucket-B/E methods
// (installSkill / installCatalogItem / exportSummary / getWorkspaceDeps / getSdlc*) that
// also live in PanelRequestService but are not allowlisted here. See
// docs-fork/superpowers/spec/2026-05-27-standalone-parity-bucket-d-design.md § C.

const _inner = new Set<string>([
  'generateLearningQuiz', 'generateCodeComparison', 'generateDidYouKnow', 'generateLearningResources',
  'generateSkillContent', 'triageSkills', 'triageCatalog', 'discoverCatalog',
  'reviewContextFiles',
]);

function _throwMutation(): never {
  throw new TypeError('V1_SERVICE_ALLOWED is frozen and cannot be mutated');
}

export const V1_SERVICE_ALLOWED: ReadonlySet<string> = new Proxy(_inner, {
  get(target, prop) {
    if (prop === 'add' || prop === 'delete' || prop === 'clear') {
      return _throwMutation;
    }
    const value = Reflect.get(target, prop, target);
    if (typeof value === 'function') {
      return value.bind(target);
    }
    return value;
  },
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/standalone/__tests__/v1-service-allowed.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/standalone/v1-service-allowed.ts src/standalone/__tests__/v1-service-allowed.test.ts
git commit -m "feat(standalone): add V1_SERVICE_ALLOWED (9 bridged service methods)"
```

---

## Task 8: Create the `PanelRequestService` bridge

**Files:**
- Create: `src/standalone/request-service-bridge.ts`
- Test: `src/standalone/__tests__/request-service-bridge.test.ts`

`PanelRequestService` uses exactly one `Webview` member: `postMessage(frame)` (via `postResponse`/`postError`/`postEvent` in `panel-shared.ts:42-52`). The capturing webview maps:
- `{ type:'response', id, data }` → resolve `{ ok:false, error:{ code:'handler-error', method, message:data.error } }` when `data.error` is truthy (matching `server.ts`'s error mapping), else `{ ok:true, data }`.
- `{ type:'event', … }` → call `ctx.emitEvent?.(frame)` (does **not** resolve; the response frame still follows).

Because `tryHandle` runs the handler asynchronously and funnels every outcome (including thrown errors, via its `.catch` → `postError`) through `postMessage`, the promise always settles through the capturing webview.

**No-key UX rewrite (grilling decisions 2/3/6 — folded).** With no provider key, the stub's `selectChatModels` returns `[]` and `panel-llm.ts:321` throws *"No language model available. Make sure GitHub Copilot is installed and signed in."* — wrong for standalone. A new shared helper `src/standalone/llm-unavailable.ts` rewrites any error carrying that upstream substring to **`LLM_UNAVAILABLE_HINT`** ("Set ANTHROPIC_API_KEY or OPENAI_API_KEY to enable AI features."). Keying on the *string* (decision 3), not on `detectProvider()===null`, keeps no-LLM methods like `discoverCatalog` correctly untouched. The helper is applied here in the bridge (service methods throw → the bridge's `error.message` carries the marker) and again in Task 9's dispatcher registry tier (decision 6) — but via two entry points, because `explainOccurrence` **catches its own throw** (`panel-rpc.ts:939`) and returns `{ error }` as *data*, so the dispatcher wraps `{ ok:true, data:{ ok:false, error } }`. Hence `rewriteLlmUnavailable(result)` (message-based, used here) **and** `rewriteLlmUnavailableInData(data)` (data.error-based, used in Task 9).

- [ ] **Step 1: Write the failing test**

Create `src/standalone/__tests__/request-service-bridge.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { DispatchContext } from '../dispatcher';
import type { Analyzer } from '../../core/analyzer';
import type { ParseResult } from '../../core/cache';

// Mock PanelRequestService so we drive postMessage shapes deterministically without a real
// LLM. The shared `behavior` (vi.hoisted) lets each test inject what tryHandle does.
const hooks = vi.hoisted(() => ({
  behavior: (_webview: { postMessage: (f: unknown) => void }, _msg: { id: string }): boolean => true,
}));
vi.mock('../../webview/panel-request-service', () => ({
  PanelRequestService: class {
    constructor(
      private readonly webview: { postMessage: (f: unknown) => void },
      private readonly _getAnalyzer: () => unknown,
      private readonly _getParseResult: () => unknown,
    ) {}
    tryHandle(msg: { id: string }): boolean {
      return hooks.behavior(this.webview, msg);
    }
  },
}));

import { dispatchServiceMethod } from '../request-service-bridge';
import { LLM_UNAVAILABLE_HINT } from '../llm-unavailable';

const ctx = (emitEvent?: (f: Record<string, unknown>) => void): DispatchContext => ({
  analyzer: {} as unknown as Analyzer,
  parseResult: {} as unknown as ParseResult,
  emitEvent,
});

describe('dispatchServiceMethod', () => {
  it('maps a response frame to { ok:true, data }', async () => {
    hooks.behavior = (wv, msg) => { wv.postMessage({ type: 'response', id: msg.id, data: { questions: [1] } }); return true; };
    const res = await dispatchServiceMethod('generateLearningQuiz', {}, ctx());
    expect(res).toEqual({ ok: true, data: { questions: [1] } });
  });

  it('maps an error response frame to a handler-error envelope', async () => {
    hooks.behavior = (wv, msg) => { wv.postMessage({ type: 'response', id: msg.id, data: { error: 'boom' } }); return true; };
    const res = await dispatchServiceMethod('triageCatalog', {}, ctx());
    expect(res).toEqual({ ok: false, error: { code: 'handler-error', method: 'triageCatalog', message: 'boom' } });
  });

  it('rewrites the upstream "No language model available" error to the standalone hint (decisions 2/3/6)', async () => {
    hooks.behavior = (wv, msg) => { wv.postMessage({ type: 'response', id: msg.id, data: { error: 'No language model available. Make sure GitHub Copilot is installed and signed in.' } }); return true; };
    const res = await dispatchServiceMethod('generateLearningQuiz', {}, ctx());
    expect(res).toEqual({ ok: false, error: { code: 'handler-error', method: 'generateLearningQuiz', message: LLM_UNAVAILABLE_HINT } });
  });

  it('routes an event frame to ctx.emitEvent and does NOT resolve on it (response still follows)', async () => {
    const emitEvent = vi.fn();
    hooks.behavior = (wv, msg) => {
      wv.postMessage({ type: 'event', method: 'reviewProgress', data: { phase: 'start' } });
      wv.postMessage({ type: 'response', id: msg.id, data: { reviews: [] } });
      return true;
    };
    const res = await dispatchServiceMethod('reviewContextFiles', {}, ctx(emitEvent));
    expect(emitEvent).toHaveBeenCalledWith({ type: 'event', method: 'reviewProgress', data: { phase: 'start' } });
    expect(res).toEqual({ ok: true, data: { reviews: [] } });
  });

  it('resolves unknown-method when tryHandle returns false', async () => {
    hooks.behavior = () => false;
    const res = await dispatchServiceMethod('notAMethod', {}, ctx());
    expect(res).toEqual({ ok: false, error: { code: 'unknown-method', method: 'notAMethod' } });
  });
});
```

Also create the helper's unit test `src/standalone/__tests__/llm-unavailable.test.ts` (pins the string-keyed rewrite — grilling decision 3):

```ts
import { describe, expect, it } from 'vitest';
import { rewriteLlmUnavailable, rewriteLlmUnavailableInData, LLM_UNAVAILABLE_HINT } from '../llm-unavailable';

const UPSTREAM = 'No language model available. Make sure GitHub Copilot is installed and signed in.';

describe('rewriteLlmUnavailable (DispatchResult error.message — bridge / thrown handler)', () => {
  it('rewrites a handler-error whose message carries the upstream marker', () => {
    expect(rewriteLlmUnavailable({ ok: false, error: { code: 'handler-error', method: 'm', message: UPSTREAM } }))
      .toEqual({ ok: false, error: { code: 'handler-error', method: 'm', message: LLM_UNAVAILABLE_HINT } });
  });
  it('passes a non-marker error through unchanged (e.g. discoverCatalog needs no LLM)', () => {
    const r = { ok: false, error: { code: 'handler-error', method: 'discoverCatalog', message: 'some other failure' } } as const;
    expect(rewriteLlmUnavailable(r)).toEqual(r);
  });
  it('passes ok results through unchanged', () => {
    const r = { ok: true, data: { items: [] } } as const;
    expect(rewriteLlmUnavailable(r)).toBe(r);
  });
});

describe('rewriteLlmUnavailableInData (registry data.error — explainOccurrence catches its own throw)', () => {
  it('rewrites a string data.error carrying the upstream marker', () => {
    expect(rewriteLlmUnavailableInData({ ok: false, explanation: '', error: UPSTREAM }))
      .toEqual({ ok: false, explanation: '', error: LLM_UNAVAILABLE_HINT });
  });
  it('passes data without the marker through unchanged (incl. non-error data and null)', () => {
    expect(rewriteLlmUnavailableInData({ ok: false, error: 'Session not found' }))
      .toEqual({ ok: false, error: 'Session not found' });
    expect(rewriteLlmUnavailableInData({ rules: [] })).toEqual({ rules: [] });
    expect(rewriteLlmUnavailableInData(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/standalone/__tests__/request-service-bridge.test.ts src/standalone/__tests__/llm-unavailable.test.ts`
Expected: FAIL — cannot resolve `../request-service-bridge` or `../llm-unavailable` (modules do not exist yet).

- [ ] **Step 3: Create the LLM-unavailable helper, then the bridge**

First create `src/standalone/llm-unavailable.ts` (shared by this bridge and Task 9's dispatcher; grilling decisions 2/3/6):

```ts
// src/standalone/llm-unavailable.ts
// With no provider key the stub's selectChatModels returns [] and panel-llm.ts:321 throws
// "No language model available. Make sure GitHub Copilot is installed and signed in." — wrong for
// standalone. Rewrite ANY error carrying that upstream substring to a standalone hint. Keying on
// the STRING (decision 3), not detectProvider()===null, leaves no-LLM methods like discoverCatalog
// untouched. Two entry points because the error surfaces differently:
//   • Service methods throw -> the bridge maps it to DispatchResult.error.message => rewriteLlmUnavailable
//   • explainOccurrence CATCHES its own throw (panel-rpc.ts:939) and returns { error } as DATA,
//     so the dispatcher wraps { ok:true, data:{ ok:false, error } }              => rewriteLlmUnavailableInData
import type { DispatchResult } from './dispatcher';

export const LLM_UNAVAILABLE_HINT =
  'Set ANTHROPIC_API_KEY or OPENAI_API_KEY to enable AI features.';

const UPSTREAM_MARKER = 'No language model available';

/** Rewrite a DispatchResult handler-error whose message carries the upstream marker. */
export function rewriteLlmUnavailable(result: DispatchResult): DispatchResult {
  if (result.ok) return result;
  if (typeof result.error.message === 'string' && result.error.message.includes(UPSTREAM_MARKER)) {
    return { ok: false, error: { ...result.error, message: LLM_UNAVAILABLE_HINT } };
  }
  return result;
}

/** Rewrite a registry handler's returned `data` when it carries a string `error` with the marker. */
export function rewriteLlmUnavailableInData(data: unknown): unknown {
  if (data && typeof data === 'object' && 'error' in data) {
    const err = (data as { error?: unknown }).error;
    if (typeof err === 'string' && err.includes(UPSTREAM_MARKER)) {
      return { ...(data as Record<string, unknown>), error: LLM_UNAVAILABLE_HINT };
    }
  }
  return data;
}
```

Then create `src/standalone/request-service-bridge.ts`:

```ts
// src/standalone/request-service-bridge.ts
// Bridges the dropped PanelRequestService into the standalone dispatcher (bucket D § B).
// A FRESH PanelRequestService + capturing fake Webview is built per call — not a singleton —
// because event frames carry no id (so a singleton could not route an id-less reviewProgress
// event to the right caller) and getAnalyzer/getParseResult are fixed at construction (so
// per-call construction captures the live call's ctx). The service uses exactly one Webview
// member: postMessage(frame).
import type * as vscode from 'vscode';
import { PanelRequestService } from '../webview/panel-request-service';
import type { RequestMessage } from '../webview/panel-shared';
import type { DispatchContext, DispatchResult } from './dispatcher';
import { rewriteLlmUnavailable } from './llm-unavailable';

let _seq = 0;
function nextId(): string {
  return `svc-${Date.now()}-${_seq++}`;
}

interface ResponseFrame {
  type?: string;
  id?: string;
  method?: string;
  data?: { error?: unknown } & Record<string, unknown>;
}

export function dispatchServiceMethod(
  method: string,
  params: unknown,
  ctx: DispatchContext,
): Promise<DispatchResult> {
  return new Promise<DispatchResult>((resolve) => {
    try {
      const id = nextId();
      const captureWebview = {
        postMessage: (frame: ResponseFrame): void => {
          if (frame.type === 'event') {
            // Forward the event frame verbatim; the response frame still follows, so do NOT resolve.
            ctx.emitEvent?.(frame as unknown as Record<string, unknown>);
            return;
          }
          const data = frame.data ?? {};
          if (data && typeof data === 'object' && data.error) {
            // Rewrite the upstream "No language model available … Copilot" message to the
            // standalone hint when there's no key (grilling decisions 2/3/6); no-op otherwise.
            resolve(rewriteLlmUnavailable({ ok: false, error: { code: 'handler-error', method, message: String(data.error) } }));
          } else {
            resolve({ ok: true, data });
          }
        },
      };

      const service = new PanelRequestService(
        captureWebview as unknown as vscode.Webview,
        () => ctx.analyzer,
        () => ctx.parseResult,
      );

      const handled = service.tryHandle({ type: 'request', id, method, params } as RequestMessage);
      if (!handled) {
        // Behind the allowlist this should not happen; resolve defensively.
        resolve({ ok: false, error: { code: 'unknown-method', method } });
      }
    } catch (err) {
      // Construction/dispatch must never reject the dispatcher's promise.
      resolve(rewriteLlmUnavailable({ ok: false, error: { code: 'handler-error', method, message: err instanceof Error ? err.message : String(err) } }));
    }
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/standalone/__tests__/request-service-bridge.test.ts src/standalone/__tests__/llm-unavailable.test.ts`
Expected: PASS (bridge: 5 tests incl. the rewrite case; llm-unavailable: 5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/standalone/request-service-bridge.ts src/standalone/__tests__/request-service-bridge.test.ts src/standalone/llm-unavailable.ts src/standalone/__tests__/llm-unavailable.test.ts
git commit -m "feat(standalone): add request-service-bridge + llm-unavailable rewrite (PanelRequestService per call)"
```

---

## Task 9: Add the service-bridge tier to the dispatcher

**Files:**
- Modify: `src/standalone/dispatcher.ts`
- Test: `src/standalone/__tests__/dispatcher.test.ts`

The service-bridge tier sits **after** native, **before** the allowlist gate, with **no data-ready guard** (the data-needing service handlers self-guard — `reviewContextFiles` → "Analyzer not ready"; `triageSkills`/`triageCatalog` degrade via `getUserContext()` to empties — and a tier guard would replace `reviewContextFiles`'s specific message with the generic "data not ready"). `DispatchContext` gains an optional `emitEvent` so existing call sites and tests that pass only `{ analyzer, parseResult }` keep compiling. This task also wraps the **registry** (Tier 3b) success return with `rewriteLlmUnavailableInData` (grilling decision 6) so `explainOccurrence`'s no-key error — which it returns as `data.error`, not as a throw — surfaces the standalone hint instead of the upstream Copilot string.

- [ ] **Step 1: Add the failing dispatcher tests**

In `src/standalone/__tests__/dispatcher.test.ts`, add a mock for the bridge near the top (after the existing `vi.mock('../../webview/panel-rpc', ...)` block on line 16):

```ts
import { dispatchServiceMethod } from '../request-service-bridge';
import { LLM_UNAVAILABLE_HINT } from '../llm-unavailable'; // real helper (not mocked) — the rewrite runs
vi.mock('../request-service-bridge', () => ({ dispatchServiceMethod: vi.fn() }));
const mockedDispatchService = vi.mocked(dispatchServiceMethod);
```

Add `mockedDispatchService.mockReset();` to the existing `afterEach` block (alongside `mockedGetRpcHandler.mockReset()` on line 32).

Then append these describe blocks at the end of the file:

```ts
describe('dispatch — service-bridge tier', () => {
  it('routes a V1_SERVICE_ALLOWED method to the bridge (not the registry)', async () => {
    mockedDispatchService.mockResolvedValueOnce({ ok: true, data: { questions: [] } });
    const res = await dispatch('generateLearningQuiz', { difficulty: 'easy' }, readyCtx);
    expect(res).toEqual({ ok: true, data: { questions: [] } });
    expect(mockedDispatchService).toHaveBeenCalledWith('generateLearningQuiz', { difficulty: 'easy' }, readyCtx);
    expect(mockedGetRpcHandler).not.toHaveBeenCalled();
  });

  it('routes service methods WITHOUT the data-ready guard (bridge called even with empty ctx)', async () => {
    mockedDispatchService.mockResolvedValueOnce({ ok: false, error: { code: 'handler-error', method: 'reviewContextFiles', message: 'Analyzer not ready.' } });
    const res = await dispatch('reviewContextFiles', {}, {}); // no analyzer/parseResult
    // The tier did NOT short-circuit with the generic "data not ready"; the handler's own message survives.
    expect(mockedDispatchService).toHaveBeenCalledWith('reviewContextFiles', {}, {});
    expect(res).toEqual({ ok: false, error: { code: 'handler-error', method: 'reviewContextFiles', message: 'Analyzer not ready.' } });
  });

  it('does NOT route a non-service method to the bridge', async () => {
    mockedGetRpcHandler.mockReturnValueOnce(fakeHandler(async () => ({ ok: true })));
    await dispatch('compileNlRule', {}, readyCtx); // NL-rule is a registry method, not a service method
    expect(mockedDispatchService).not.toHaveBeenCalled();
    expect(mockedGetRpcHandler).toHaveBeenCalledWith('compileNlRule');
  });
});

describe('dispatch — registry LLM-unavailable rewrite (grilling decision 6)', () => {
  it('rewrites data.error "No language model available" from a registry handler to the standalone hint', async () => {
    // explainOccurrence catches its own LLM throw (panel-rpc.ts:939) and returns { error } as data,
    // so the rewrite must operate on the handler's returned data, not on a thrown dispatcher error.
    mockedGetRpcHandler.mockReturnValueOnce(fakeHandler(async () => ({ ok: false, explanation: '', error: 'No language model available. Make sure GitHub Copilot is installed and signed in.' })));
    const res = await dispatch('explainOccurrence', {}, readyCtx);
    expect(res).toEqual({ ok: true, data: { ok: false, explanation: '', error: LLM_UNAVAILABLE_HINT } });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/standalone/__tests__/dispatcher.test.ts`
Expected: FAIL — service methods currently fall through to the allowlist gate (`generateLearningQuiz` → `standalone-v1-disabled`), so `mockedDispatchService` is never called.

- [ ] **Step 3: Add the tier and the `emitEvent` field**

In `src/standalone/dispatcher.ts`, add the two imports (after line 4):

```ts
import { V1_SERVICE_ALLOWED } from './v1-service-allowed';
import { dispatchServiceMethod } from './request-service-bridge';
import { rewriteLlmUnavailableInData } from './llm-unavailable';
```

Extend `DispatchContext` (lines 8-14) with the optional `emitEvent`:

```ts
export interface DispatchContext {
  // Optional: the server serves before the parse finishes (serve-then-parse).
  // A registry method dispatched while these are still undefined returns a
  // handler-error ("data not ready").
  analyzer?: Analyzer;
  parseResult?: ParseResult;
  // Per-socket event sink (bucket D). The server builds this per connection so the
  // service bridge can forward reviewProgress frames to the requesting socket only.
  emitEvent?: (frame: Record<string, unknown>) => void;
}
```

Insert the service-bridge tier immediately after the native tier (after line 42, before the `// Tier 2: allowlist gate` comment), and renumber the comments:

```ts
  // Tier 2: service-bridge methods (PanelRequestService). NO data-ready guard — the
  // data-needing service handlers self-guard with specific messages, and a tier guard
  // would mask reviewContextFiles's "Analyzer not ready." with the generic "data not ready".
  if (V1_SERVICE_ALLOWED.has(method)) {
    return dispatchServiceMethod(method, params, ctx);
  }

  // Tier 3: allowlist gate. Expected path (webview may hit a disabled method
  // proactively); no log line.
  if (!V1_ALLOWED.has(method)) {
    return { ok: false, error: { code: 'standalone-v1-disabled', method } };
  }
```

The data-ready guard (Tier 3a) is unchanged. In Tier 3b, wrap the handler's returned data so an LLM-unavailable error that `explainOccurrence` returns **as data** (it catches its own throw at `panel-rpc.ts:939`, so the dispatcher never sees a throw) is rewritten to the standalone hint (grilling decision 6). Change the success return:

```ts
    const data = await handler(ctx.analyzer, ctx.parseResult, params as Record<string, unknown>);
    // explainOccurrence (no heuristic fallback) returns its LLM error as data.error; rewrite the
    // upstream "No language model available … Copilot" string to the standalone hint (no-op for
    // every other registry method / shape). generateRule's template fallback never hits this.
    return { ok: true, data: rewriteLlmUnavailableInData(data ?? null) };
```

(The `catch` arm below — for handlers that *throw* to the dispatcher — keeps its existing shape; `explainOccurrence` does not reach it. The NL-rule methods remain registry "Tier 3b".)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/standalone/__tests__/dispatcher.test.ts`
Expected: PASS (all existing tests + the 3 new service-bridge tests).

- [ ] **Step 5: Commit**

```bash
git add src/standalone/dispatcher.ts src/standalone/__tests__/dispatcher.test.ts
git commit -m "feat(standalone): service-bridge tier + emitEvent + registry LLM-unavailable rewrite"
```

---

## Task 10: Wire per-socket `emitEvent` in the server

**Files:**
- Modify: `src/standalone/server.ts`

`emitEvent` is per-socket, so it cannot live in `RpcDeps.current()` (socket-agnostic). It is constructed inside the `wss.on('connection')` message handler and merged onto `deps.current()` at the `dispatch(...)` call site. The frame is forwarded **verbatim** (`{type:'event', method:'reviewProgress', data}`, which the unmodified webview already routes), reaching the requesting socket only — reusing the existing outbound-frame pattern, distinct from `broadcast`.

- [ ] **Step 1: Build the per-socket ctx at the dispatch call site**

In `src/standalone/server.ts`, replace the single dispatch line (line 201) inside the `socket.on('message', ...)` handler:

```ts
        const result = await dispatch(env.method, env.params, deps.current());
```

with a merged context that adds the per-socket event sink:

```ts
        // emitEvent is per-socket (reviewProgress reaches the requesting socket only),
        // so it is built here — not in deps.current(), which is socket-agnostic. Forwarded
        // verbatim, distinct from broadcast (which fans out to all clients).
        const ctx: DispatchContext = {
          ...deps.current(),
          emitEvent: (frame: Record<string, unknown>) => {
            if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame));
          },
        };
        const result = await dispatch(env.method, env.params, ctx);
```

`DispatchContext` is already imported on line 13 (`import { dispatch, type DispatchContext, type DispatchResult } from './dispatcher';`). `socket` and `WebSocket` are in scope.

- [ ] **Step 2: Build and run the existing server + dispatcher suites**

Run: `npm run build` then `npx vitest run src/standalone/__tests__/server.test.ts src/standalone/__tests__/dispatcher.test.ts`
Expected: PASS — `server.test.ts` still green (the change is additive; existing tests don't exercise events), build succeeds. The event path is proven end-to-end by the integration test in Task 12.

- [ ] **Step 3: Commit**

```bash
git add src/standalone/server.ts
git commit -m "feat(standalone): forward per-socket reviewProgress events into the dispatch ctx"
```

---

## Task 11: Clean up `BANNER_WORTHY` for the now-live methods

**Files:**
- Modify: `src/standalone/webview-shim.ts`
- Test: `src/standalone/__tests__/webview-shim.test.ts`

Once a method is allowlisted (registry) or bridged (service), the dispatcher never returns `standalone-v1-disabled` for it, so the shim's banner branch (`webview-shim.ts:136`) is already unreachable for it — this is **hygiene-only**. Remove the 6 now-live methods (`generateLearningQuiz`, `generateCodeComparison`, `generateDidYouKnow`, `generateLearningResources`, `generateSkillContent`, `triageCatalog`), leaving `{createSkill, installSkill, installCatalogItem, getRuleEditor}` (10 → 4). `createSkill` stays banner-worthy (still degraded).

**No-key UX (grilling decision 2 — folded).** Removing these from `BANNER_WORTHY` is correct *because* they are now allowlisted/bridged: with no API key they reach the LLM seam and return the standalone `LLM_UNAVAILABLE_HINT` ("Set ANTHROPIC_API_KEY or OPENAI_API_KEY…", Tasks 8/9), **not** a `standalone-v1-disabled` roadmap banner. The no-key integration test that pins this (boot with no LLM env, call `generateLearningQuiz`, assert a clean non-Copilot error) lives in Task 12.

- [ ] **Step 1: Update the failing test**

In `src/standalone/__tests__/webview-shim.test.ts`, update the `BANNER_WORTHY` describe block (lines 78-88). Change the `triageCatalog` assertion (line 82) and the size assertion (line 86):

```ts
describe('BANNER_WORTHY', () => {
  it('contains only the still-degraded methods after bucket D went live', () => {
    expect(BANNER_WORTHY.has('createSkill')).toBe(true); // opens VS Code chat; still degraded
    expect(BANNER_WORTHY.has('installCatalogItem')).toBe(true); // bucket B (write path)
    expect(BANNER_WORTHY.has('getRuleEditor')).toBe(true);
    expect(BANNER_WORTHY.has('triageCatalog')).toBe(false); // now bridged & live (bucket D)
    expect(BANNER_WORTHY.has('generateLearningQuiz')).toBe(false); // now bridged & live
    expect(BANNER_WORTHY.has('triageSkills')).toBe(false); // proactive → silent
    expect(BANNER_WORTHY.has('getStats')).toBe(false); // allowed, not disabled
    expect(BANNER_WORTHY.size).toBe(4);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/standalone/__tests__/webview-shim.test.ts -t "BANNER_WORTHY"`
Expected: FAIL — `expected 10 to be 4`; `triageCatalog`/`generateLearningQuiz` still present.

- [ ] **Step 3: Remove the 6 now-live methods from the set**

In `src/standalone/webview-shim.ts`, replace the `BANNER_WORTHY` set (lines 17-24) with:

```ts
// Curated set: only these disabled methods trigger the roadmap banner. Everything else
// disabled is silent (see docs-fork/specs/00-overview.md "Disabled-method UX"). Bucket D
// went live: the Learning ×4, generateSkillContent, and triageCatalog methods are now
// allowlisted/bridged, so the dispatcher never returns standalone-v1-disabled for them and
// their banner branch is unreachable — removed here for hygiene. createSkill stays
// (opens VS Code chat); installSkill/installCatalogItem are bucket B; getRuleEditor is the
// deep-link route with no standalone editor.
export const BANNER_WORTHY: ReadonlySet<string> = new Set([
  'createSkill', 'installSkill', 'installCatalogItem', 'getRuleEditor',
]);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/standalone/__tests__/webview-shim.test.ts`
Expected: PASS (all webview-shim tests, including the updated `BANNER_WORTHY` block).

- [ ] **Step 5: Commit**

```bash
git add src/standalone/webview-shim.ts src/standalone/__tests__/webview-shim.test.ts
git commit -m "chore(standalone): drop now-live bucket-D methods from BANNER_WORTHY (10->4)"
```

---

## Task 12: Integration — service methods return data + `reviewContextFiles` emits an event

**Files:**
- Modify: `tests/standalone/integration/cli-rpc-lifecycle.test.ts`

Against the built CLI with the fake provider (Task 5 fixture): `generateLearningQuiz` and `triageCatalog` resolve `{ ok:true }`; `reviewContextFiles` (with a bogus workspaceId, so it emits `reviewProgress` `phase:'start'` **before** failing to resolve roots) invokes `emitEvent` — proving the per-socket event forwarding end-to-end. `generateLearningQuiz` needs no analyzer; `triageCatalog` reads `params.items` (no network). The OpenAI strict-mode self-heal is already unit-covered in **Task 2** (grilling decision 7 moved it there). Concurrent same-socket `reviewContextFiles` is an accepted upstream limitation (grilling decision 8): the UI serializes via button-disable (`page-config.ts:347`) and cross-tab reviews are per-socket isolated, so the id-less `reviewProgress` events are never ambiguous in practice — no guarding added.

- [ ] **Step 1: Add the service-method integration tests**

In `tests/standalone/integration/cli-rpc-lifecycle.test.ts`, add inside the `describe` block (the fixture import + `AddressInfo` type were added in Task 5):

```ts
  it('generateLearningQuiz returns questions via the service bridge + fake provider', async () => {
    const fake = createFakeLlmServer();
    await new Promise<void>((r) => fake.listen(0, '127.0.0.1', () => r()));
    const port = (fake.address() as AddressInfo).port;
    try {
      const home = makeTmpHome();
      const b = track(
        await bootCli(home, ['--port', '7364'], 20_000, { ANTHROPIC_API_KEY: 'test-key', COACH_LLM_BASE_URL: `http://127.0.0.1:${port}` }),
        home,
      );
      const ws = await wsConnect(b);
      await wsWaitFor(ws, 'dataReady');
      const quiz = await wsRequest(ws, 'generateLearningQuiz', { difficulty: 'easy', languages: ['ts'] }, 'q1');
      const cat = await wsRequest(ws, 'triageCatalog', { items: [{ id: 'demo-skill', title: 'Demo Skill', kind: 'skill', description: 'd', category: 'c' }] }, 'c1');
      ws.close();

      expect((quiz.data as { error?: string }).error).toBeUndefined();
      expect((quiz.data as { questions?: unknown[] }).questions?.length).toBeGreaterThan(0);
      expect((cat.data as { error?: string }).error).toBeUndefined();
      expect((cat.data as { items?: unknown[] }).items?.length).toBeGreaterThan(0);
    } finally {
      fake.close();
    }
  });

  it('reviewContextFiles forwards a reviewProgress event to the requesting socket', async () => {
    const fake = createFakeLlmServer();
    await new Promise<void>((r) => fake.listen(0, '127.0.0.1', () => r()));
    const port = (fake.address() as AddressInfo).port;
    try {
      const home = makeTmpHome();
      const b = track(
        await bootCli(home, ['--port', '7365'], 20_000, { ANTHROPIC_API_KEY: 'test-key', COACH_LLM_BASE_URL: `http://127.0.0.1:${port}` }),
        home,
      );
      const ws = await wsConnect(b);
      await wsWaitFor(ws, 'dataReady');

      // Listen for the id-less event frame while the request is in flight.
      const eventSeen = wsWaitForEvent(ws, 'reviewProgress');
      // Bogus workspaceId: getContextReviewPayload returns [] (no throw), so the handler emits
      // reviewProgress 'start' THEN errors with "Could not resolve workspace roots." The event
      // is what proves the per-socket emitEvent plumbing works.
      await wsRequest(ws, 'reviewContextFiles', { workspaceIds: ['does-not-exist'] }, 'r1');
      const evt = await eventSeen;
      ws.close();

      expect(evt.type).toBe('event');
      expect(evt.method).toBe('reviewProgress');
      expect((evt.data as { phase?: string }).phase).toBe('start');
    } finally {
      fake.close();
    }
  });

  it('generateLearningQuiz returns a standalone (non-Copilot) error with no LLM key (grilling decision 2)', async () => {
    const home = makeTmpHome();
    const b = track(await bootCli(home, ['--port', '7366']), home); // no LLM env
    const ws = await wsConnect(b);
    await wsWaitFor(ws, 'dataReady');
    const res = await wsRequest(ws, 'generateLearningQuiz', { difficulty: 'easy', languages: ['ts'] }, 'nokey1');
    ws.close();
    const data = res.data as { error?: string };
    // The bridge rewrites the upstream "No language model available … Copilot" throw to the hint.
    expect(data.error).toContain('ANTHROPIC_API_KEY');
    expect(data.error).not.toMatch(/Copilot/i);
  });

  it('explainOccurrence routes through the registry and never leaks the upstream Copilot string (grilling decision 6)', async () => {
    // The registry-tier rewrite is pinned deterministically in dispatcher.test.ts (Task 9). Here we
    // assert the seed-independent end-to-end invariant: NO explainOccurrence response may carry the
    // raw upstream "No language model available"/"Copilot" string — offline it is either rewritten to
    // the hint (if the call reaches the LLM seam) or short-circuits at a clean precondition error.
    // To assert the rewritten hint specifically, pass a ruleId+sessionId that EXISTS in the seeded
    // home (discover via the seed fixture); with bogus IDs the handler stops at "Rule/Session not
    // found" before the LLM call, and the provider-success path ({ ok:true, explanation }) is covered
    // by Task 5's usedLlm:true and the quiz test above.
    const home = makeTmpHome();
    const b = track(await bootCli(home, ['--port', '7367']), home); // no LLM env
    const ws = await wsConnect(b);
    await wsWaitFor(ws, 'dataReady');
    const res = await wsRequest(ws, 'explainOccurrence', { ruleId: 'demo', sessionId: 'demo' }, 'exp1');
    ws.close();
    const data = res.data as { error?: string };
    expect(data.error ?? '').not.toMatch(/Copilot/i);
    expect(data.error ?? '').not.toMatch(/No language model available/i);
  });
```

- [ ] **Step 2: Add the `wsWaitForEvent` helper**

In `tests/standalone/integration/helpers.ts`, add (after `wsWaitFor`, line 114):

```ts
// Resolve on the first event frame ({type:'event', method}) for the given method. Distinct
// from wsWaitFor (which keys on frame.type) — event frames carry no id, so this matches method.
export function wsWaitForEvent(ws: WebSocket, method: string, timeoutMs = 15_000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.off('message', onMsg); reject(new Error(`no ${method} event in ${timeoutMs}ms`)); }, timeoutMs);
    const onMsg = (raw: Buffer): void => {
      const f = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (f.type === 'event' && f.method === method) { clearTimeout(timer); ws.off('message', onMsg); resolve(f); }
    };
    ws.on('message', onMsg);
  });
}
```

Add `wsWaitForEvent` to the import in `cli-rpc-lifecycle.test.ts` (the helpers import line).

- [ ] **Step 3: Build and run the integration tests**

Run: `npm run build` then `npx vitest run --config tests/standalone/integration/vitest.config.ts -t "service bridge|reviewProgress event|no LLM key|explainOccurrence routes"`
Expected: PASS (4 tests — 2 service-bridge/event + the no-key quiz error + the explainOccurrence no-leak).

- [ ] **Step 4: Commit**

```bash
git add tests/standalone/integration/cli-rpc-lifecycle.test.ts tests/standalone/integration/helpers.ts
git commit -m "test(standalone): integration for service-bridge methods + reviewProgress event"
```

---

## Task 13: Smoke — Learning quiz, Skill Finder, Context Health (fake-provider sidecar)

**Files:**
- Modify: `tests/standalone/playwright/global-setup.ts`
- Modify: `tests/standalone/playwright/global-teardown.ts`
- Modify: `tests/standalone/playwright/smoke.spec.ts`

CI has no real key, so global-setup forks the fake-LLM sidecar and points the CLI at it via `ANTHROPIC_API_KEY` + `COACH_LLM_BASE_URL`. The Context Health review will emit a `reviewProgress` event then fail to resolve roots (the seeded `.claude` workspaces have non-existent `cwd`s), so the smoke asserts the page renders and the review **degrades gracefully** (no crash) — the full event plumbing is proven by Task 12's integration test.

- [ ] **Step 1: Fork the fake-LLM sidecar in global-setup**

In `tests/standalone/playwright/global-setup.ts`, add the sidecar fork before the CLI fork. After the `SEED` constant (line 11), add:

```ts
const FAKE_LLM = path.resolve(__dirname, '../fixtures/fake-llm-server.mjs');
```

Inside `globalSetup`, after `seedHome(home)` (line 16), start the sidecar and capture its URL:

```ts
  const fake = fork(FAKE_LLM, [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const fakeUrl = await new Promise<string>((resolve, reject) => {
    let fbuf = '';
    const ft = setTimeout(() => reject(new Error(`fake-llm did not start in 10s. stderr:\n${fbuf}`)), 10_000);
    fake.stderr!.on('data', (b: Buffer) => {
      fbuf += b.toString();
      const m = fbuf.match(/fake-llm running at (http:\/\/127\.0\.0\.1:\d+)/);
      if (m) { clearTimeout(ft); resolve(m[1]); }
    });
    fake.once('exit', (c) => reject(new Error(`fake-llm exited (${c}) before serving. stderr:\n${fbuf}`)));
  });
```

Change the CLI fork's `env` (line 18) to inject the LLM config:

```ts
  const child = fork(CLI, ['--no-open', '--port', '7388'], {
    env: { ...process.env, HOME: home, USERPROFILE: home, ANTHROPIC_API_KEY: 'smoke-test-key', COACH_LLM_BASE_URL: fakeUrl },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
```

And record the sidecar pid in `.runtime.json` (extend the `writeFileSync` payload, lines 32-35), plus `fake.unref()`:

```ts
  fs.writeFileSync(
    RUNTIME,
    JSON.stringify({ pid: child.pid, fakePid: fake.pid, home, origin: u.origin, token: u.searchParams.get('t') }),
  );
  child.unref();
  fake.unref();
```

- [ ] **Step 2: Kill the sidecar in global-teardown**

In `tests/standalone/playwright/global-teardown.ts`, read `fakePid` and kill it (update lines 9-10):

```ts
  const { pid, fakePid, home } = JSON.parse(fs.readFileSync(RUNTIME, 'utf8')) as { pid: number; fakePid?: number; home: string };
  try { process.kill(pid, 'SIGINT'); } catch { /* already gone */ }
  if (fakePid) { try { process.kill(fakePid, 'SIGKILL'); } catch { /* already gone */ } }
```

- [ ] **Step 3: Append the three feature smoke tests**

Append at the end of `tests/standalone/playwright/smoke.spec.ts`:

```ts
test('learning center generates a quiz (service bridge + fake provider)', async ({ page }) => {
  await page.goto(pageUrl('level-up'), { waitUntil: 'load' });
  await expect(page.locator('.nav-links a[data-page="level-up"]')).toHaveClass(/active/, { timeout: 15_000 });

  const ok = await page.evaluate(async () => {
    const api = (window as unknown as { acquireVsCodeApi: () => { postMessage: (m: unknown) => void } }).acquireVsCodeApi();
    return await new Promise<boolean>((resolve) => {
      const onMsg = (ev: MessageEvent) => {
        const f = ev.data as { type?: string; id?: string; data?: { error?: string; questions?: unknown[] } };
        if (f.type === 'response' && f.id === 'smoke-quiz') {
          window.removeEventListener('message', onMsg);
          resolve(!f.data?.error && Array.isArray(f.data?.questions) && f.data.questions.length > 0);
        }
      };
      window.addEventListener('message', onMsg);
      api.postMessage({ type: 'request', id: 'smoke-quiz', method: 'generateLearningQuiz', params: { difficulty: 'easy', languages: ['ts'] } });
      setTimeout(() => { window.removeEventListener('message', onMsg); resolve(false); }, 15_000);
    });
  });
  expect(ok).toBe(true);
});

test('skill finder discovers + triages a catalog (service bridge + fake provider)', async ({ page }) => {
  await page.goto(pageUrl('skills'), { waitUntil: 'load' });
  await expect(page.locator('.nav-links a[data-page="skills"]')).toHaveClass(/active/, { timeout: 15_000 });

  const ok = await page.evaluate(async () => {
    const api = (window as unknown as { acquireVsCodeApi: () => { postMessage: (m: unknown) => void } }).acquireVsCodeApi();
    const call = (id: string, method: string, params: unknown) => new Promise<{ data?: { error?: string; items?: unknown[] } }>((resolve) => {
      const onMsg = (ev: MessageEvent) => {
        const f = ev.data as { type?: string; id?: string; data?: { error?: string; items?: unknown[] } };
        if (f.type === 'response' && f.id === id) { window.removeEventListener('message', onMsg); resolve(f); }
      };
      window.addEventListener('message', onMsg);
      api.postMessage({ type: 'request', id, method, params });
      setTimeout(() => { window.removeEventListener('message', onMsg); resolve({}); }, 15_000);
    });
    // triageCatalog takes a candidate list and returns LLM-picked items (no network needed).
    const cat = await call('smoke-triage', 'triageCatalog', { items: [{ id: 'demo-skill', title: 'Demo Skill', kind: 'skill', description: 'd', category: 'c' }] });
    return !cat.data?.error && Array.isArray(cat.data?.items) && cat.data.items.length > 0;
  });
  expect(ok).toBe(true);
});

test('context health review degrades gracefully (no crash) and renders', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(pageUrl('config-health'), { waitUntil: 'load' });
  await expect(page.locator('.nav-links a[data-page="config-health"]')).toHaveClass(/active/, { timeout: 15_000 });

  // reviewContextFiles emits reviewProgress then resolves (seeded workspaces have non-existent
  // cwds, so roots don't resolve and it returns a handler-error). It must never crash the page.
  const settled = await page.evaluate(async () => {
    const api = (window as unknown as { acquireVsCodeApi: () => { postMessage: (m: unknown) => void } }).acquireVsCodeApi();
    return await new Promise<boolean>((resolve) => {
      const onMsg = (ev: MessageEvent) => {
        const f = ev.data as { type?: string; id?: string };
        if (f.type === 'response' && f.id === 'smoke-review') { window.removeEventListener('message', onMsg); resolve(true); }
      };
      window.addEventListener('message', onMsg);
      api.postMessage({ type: 'request', id: 'smoke-review', method: 'reviewContextFiles', params: { workspaceIds: ['does-not-exist'] } });
      setTimeout(() => { window.removeEventListener('message', onMsg); resolve(false); }, 15_000);
    });
  });
  expect(settled).toBe(true);
  await expect(page.locator('main#content')).toBeVisible();
  expect(errors, `console errors on #config-health:\n${errors.join('\n')}`).toEqual([]);
});
```

- [ ] **Step 4: Build and run the smoke suite**

Run: `npm run build` then `npm run test:playwright:standalone`
Expected: PASS — the three new feature tests plus the existing per-page + NL→rule tests. The CLI now boots with the fake provider, so the Learning/Skill calls succeed.

- [ ] **Step 5: Commit**

```bash
git add tests/standalone/playwright/global-setup.ts tests/standalone/playwright/global-teardown.ts tests/standalone/playwright/smoke.spec.ts
git commit -m "test(standalone): smoke for Learning quiz, Skill Finder, Context Health (fake-provider sidecar)"
```

---

## Task 14: Docs + pack check + final invariant verification

**Files:**
- Modify: `docs-fork/STANDALONE-PARITY-GAPS.md`

- [ ] **Step 1: Mark bucket D shipped in the parity-gaps doc**

Locate the bucket-D section: `git grep -n "D. LLM-backed tier" docs-fork/STANDALONE-PARITY-GAPS.md` (or open the file and find the "## D. LLM-backed tier" heading). Replace that heading and its bullets with:

```markdown
## D. LLM-backed tier — SHIPPED (2026-05-27)

The "LLM provider wiring" enabler plus all four feature groups are exposed in the
standalone build. The four groups were NOT uniform: they split across two delivery
mechanisms behind a single seam (the `vscode` stub).

- **Enabler** ✅ — `vscode.lm` is implemented in `src/standalone/vscode-stub.ts` over a new
  `src/standalone/llm-provider.ts` (Anthropic/OpenAI, non-streaming single-fetch, auto-detected
  by `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`; `COACH_LLM_MODEL` / `COACH_LLM_BASE_URL` /
  `COACH_LLM_MAX_TOKENS` overrides). One seam lights up BOTH `panel-llm.ts` and
  `core/rule-compiler.ts` with zero edits to either.
- **NL-rule features** ✅ — `explainOccurrence` / `generateRule` / `compileNlRule` are
  registry handlers, now allowlisted (`V1_ALLOWED` 42 → 45). `compileNlRule` degrades to a
  heuristic template offline (never errors); `generateRule` has a template fallback.
- **Learning Center** ✅ — `generateLearningQuiz` / `generateCodeComparison` /
  `generateDidYouKnow` / `generateLearningResources`, exposed via the new
  `PanelRequestService` bridge (`src/standalone/request-service-bridge.ts`, gated by
  `V1_SERVICE_ALLOWED`).
- **Skill discovery / triage / generation** ✅ — `discoverCatalog` / `triageCatalog` /
  `triageSkills` / `generateSkillContent` via the same bridge. `createSkill` stays degraded
  (it opens VS Code chat — not an LLM call).
- **AI context-file review** ✅ — `reviewContextFiles` via the bridge; its `reviewProgress`
  event is forwarded over WebSocket to the requesting socket (per-socket `emitEvent`).

**Out of scope (documented degradations, not regressions):** `createSkill` (VS Code chat);
`installSkill` / `installCatalogItem` / `exportSummary` (bucket B write path);
`getWorkspaceDeps` / `getSdlc*` (bucket E — the bridge enables these later but they are not
allowlisted here). With no API key, LLM-backed methods surface a standalone hint — *"Set
ANTHROPIC_API_KEY or OPENAI_API_KEY to enable AI features."* (the upstream "No language model
available … Copilot" string is rewritten by `src/standalone/llm-unavailable.ts`); `compileNlRule`
and `generateRule` silently fall back to a heuristic/template instead. `generateRule` is reachable
via the anti-patterns "New Rule" modal, but its Save/Test actions stay degraded (write path /
`runRuleTests` not allowlisted).

**Data flow & configuration (transparency).** AI features send your prompts, code snippets, and —
for context review — your instruction-file contents (`CLAUDE.md` and friends) to the configured LLM
provider; this is the same data flow as the VS Code extension's Copilot path. Provider and key are
auto-detected from `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`. `COACH_LLM_BASE_URL` redirects requests
(carrying your API key) to that host — intended for proxies and local models, so point it only at a
host you trust. `COACH_LLM_MODEL` / `COACH_LLM_MAX_TOKENS` / `COACH_LLM_TIMEOUT_MS` tune the model,
output ceiling, and request timeout.
```

- [ ] **Step 2: Pack check — the provider + bridge ship in the existing bundle**

Run: `npm run build` then `npm run pack:check`
Expected: the `npm pack --dry-run` listing includes `dist/standalone/cli.js` (covered by `package.json#files` `dist/standalone/`). No new bundle entry is required — `llm-provider.ts`, `request-service-bridge.ts`, `v1-service-allowed.ts`, and `llm-unavailable.ts` compile into the existing standalone CLI bundle via the stub alias and the dispatcher imports.

- [ ] **Step 3: Full verification sweep**

Run: `npm run test:all`
Expected: build, unit (`vitest run`), standalone integration, e2e, and standalone Playwright suites all PASS.

> Pre-existing unrelated failures (full-suite only, on a clean tree too): `src/core/metric-engine.test.ts` and `src/core/parser-codex.test.ts` — both upstream `src/core/`, outside this plan's scope. The bucket-D files this plan touches are all green.

- [ ] **Step 4: Final additive-only invariant verification**

Run: `git diff --name-only abc0a6c -- src/ | Select-String -NotMatch '^src/standalone/'`
Expected: prints **only** the two known pre-existing `src/core/` files (`src/core/metric-engine.ts`, `src/core/parser-codex.test.ts`; from commit `44e9532`, predating this plan — see the Execution-status handoff note at the top) and **nothing else**. Every bucket-D `src/` change is under `src/standalone/`: new `llm-provider.ts`, `request-service-bridge.ts`, `v1-service-allowed.ts`, `llm-unavailable.ts`; modified `vscode-stub.ts`, `dispatcher.ts`, `v1-allowed.ts`, `server.ts`, `webview-shim.ts`; plus `src/standalone/__tests__/*`. `panel-llm.ts`, `core/rule-compiler.ts`, `panel-rpc.ts`, `panel-request-service.ts` are **unchanged**. Use baseline `abc0a6c`, not `upstream/main`. If any NEW `src/` file outside `src/standalone/` (beyond those two pre-existing core files) appears, stop and revert it.

- [ ] **Step 5: Commit**

```bash
git add docs-fork/STANDALONE-PARITY-GAPS.md
git commit -m "docs(standalone): mark bucket D (LLM-backed tier) shipped"
```

---

## Self-review notes (for the executor)

- **Spec coverage:** Enabler — provider (Task 1) + stub `lm` (Task 2). NL-rule — allowlist (Task 4), integration (Task 5), smoke (Task 6). Service bridge — `V1_SERVICE_ALLOWED` (Task 7), bridge (Task 8), dispatcher tier + `emitEvent` field (Task 9), server event forwarding (Task 10), `BANNER_WORTHY` cleanup (Task 11), integration incl. `reviewProgress` event (Task 12), smoke (Task 13). Docs + pack + invariant (Tasks 3/6/14).
- **Method count:** the exposed handlers are **3 NL-rule** (`V1_ALLOWED` 42 → 45) + **9 service** (`V1_SERVICE_ALLOWED`): Learning ×4, Skill ×4 (incl. `generateSkillContent`), Context ×1 = 12 unique handlers. (The spec's prose says "13" but enumerates 12 in its Scope list — a spec arithmetic slip; the load-bearing coverage check is the two pinned gate sizes **45** and **9**, asserted in Tasks 4 and 7.)
- **OpenAI strict-mode self-heal** is unit-covered in **Task 2** (moved from Task 1 by grilling decision 7) via `callLlmJson` + `SCHEMA_CONTEXT_REVIEW` + a mocked 400-then-200 `fetch` — no workspace seeding needed, and it proves the "no code change; the existing fallback covers it" claim directly.
- **Gap-2 (`.Assistant`) guard** is at the provider/stub level (Tasks 1–2: `mergeSameRole` on `[User,User,Assistant,User]` + `LanguageModelChatMessage.Assistant` shape), NOT via the `generateRule` handler — `generateRule`'s try/catch falls back to a template, which would **mask** a missing `.Assistant` throw, so a handler-level test cannot reliably guard it.
- **Type consistency:** `dispatchServiceMethod(method, params, ctx)` is named identically in `request-service-bridge.ts`, its test mock, the dispatcher import, and `dispatcher.test.ts`. `V1_SERVICE_ALLOWED` / `detectProvider` / `mergeSameRole` / `emitEvent` are spelled identically across definitions, imports, and tests. `ProviderMessage` (`{role:'user'|'assistant', content}`) is the single message shape produced by `LanguageModelChatMessage.User/.Assistant` and consumed by `provider.send`.
- **`createFakeLlmServer`** (Task 5) is reused in-process by integration (Tasks 5, 12) and forked as a sidecar by Playwright (Task 13); its prompt-substring router covers every consumed schema. The canned `RULE_MD` mirrors `compileHeuristic`'s output so `parseRule` accepts it (Task 5's `usedLlm:true`/`valid:true` assertion depends on this).
- **No esbuild change:** the stub is already aliased into the CLI bundle, so `llm-provider.ts` and the dispatcher's new imports bundle automatically (verified by Task 3's build + Task 14's pack check).
- **Bucket-A coupling — RESOLVED (2026-05-28):** bucket A landed (commit `942c0d2`); `v1-allowed.test.ts` asserts `toBe(42)` with `getDataExplorer`/`evaluateExpression` present, so Task 4's baseline is fixed at **42 → 45** and the bucket-A membership assertions stay. The conditional 40→43 fallback is dead; Task 4 Step 0 is now just a sanity re-check.
- **Grilling decisions folded (2026-05-28):** (1) bucket-A precondition step → Task 4; (2) no-key standalone hint + Task 12 integration test; (3/6) `rewriteLlmUnavailable` / `rewriteLlmUnavailableInData` shared helper (`llm-unavailable.ts`) applied at the bridge (Task 8) **and** the dispatcher registry tier (Task 9); (4) provider-level `COACH_LLM_TIMEOUT_MS` ceiling (Task 1); (5) `max_tokens` 16384 (Task 1); (7) self-heal test → Task 2; (8) concurrent reviews accepted (Task 12 note); (9) single model default (Task 1); (10) data-flow transparency paragraph (Task 14); (11) `generateRule` reachable → smoke (Task 6). **Load-bearing correction to decision 6:** `explainOccurrence` returns its no-key error **as data** (`panel-rpc.ts:939`), not as a thrown error, so the registry rewrite targets `data.error` (`rewriteLlmUnavailableInData`), distinct from the bridge's message-based path.

---

## Execution Handoff

**Plan complete and saved to `docs-fork/plans/superpowers/2026-05-27-standalone-parity-bucket-d.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints for review.

**Which approach?**
