// src/standalone/standalone-native.ts
import open from 'open';
import type { DispatchResult, NativeHandler } from './dispatcher';

export const STANDALONE_NATIVE: Record<string, NativeHandler> = {
  // page-peers.ts:336 — open a web link in the user's browser.
  openExternal: async (params): Promise<DispatchResult> => {
    const url = (params as { url?: unknown } | undefined)?.url;
    if (typeof url !== 'string') {
      return { ok: false, error: { code: 'bad-request', method: 'openExternal', message: 'missing url' } };
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, error: { code: 'bad-request', method: 'openExternal', message: 'invalid url' } };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      // Block file: / vscode: / custom-scheme handlers — `open` shells out to the OS.
      return { ok: false, error: { code: 'bad-request', method: 'openExternal', message: 'only http(s) urls allowed' } };
    }
    await open(parsed.href); // open@10 auto-detects URLs; the http(s) scheme is already validated above
    return { ok: true, data: { ok: true } };
  },
};
