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
    const res = await postJson(
      `${this.baseUrl}/chat/completions`,
      { 'content-type': 'application/json', authorization: `Bearer ${this.key}` },
      body,
      signal,
      this.timeoutMs,
    );
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
