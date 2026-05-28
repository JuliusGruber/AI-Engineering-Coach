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
