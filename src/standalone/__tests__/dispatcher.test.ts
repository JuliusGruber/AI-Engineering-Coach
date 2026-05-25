import { afterEach, describe, expect, it, vi } from 'vitest';
import * as panelRpc from '../../webview/panel-rpc';
import type { RpcHandler } from '../../webview/panel-rpc';
import { dispatch, type DispatchContext } from '../dispatcher';
import type { Analyzer } from '../../core/analyzer';
import type { ParseResult } from '../../core/cache';
import open from 'open';
vi.mock('open', () => ({ default: vi.fn() }));
const mockedOpen = vi.mocked(open);

// Load the REAL panel-rpc (resolving the transitive `vscode` via the stub alias),
// but wrap getRpcHandler so each test can inject a fake handler / undefined.
vi.mock('../../webview/panel-rpc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../webview/panel-rpc')>();
  return { ...actual, getRpcHandler: vi.fn(actual.getRpcHandler) };
});

const mockedGetRpcHandler = vi.mocked(panelRpc.getRpcHandler);

// A context with data "ready". Handlers are mocked, so empty objects are fine.
const readyCtx: DispatchContext = {
  analyzer: {} as unknown as Analyzer,
  parseResult: {} as unknown as ParseResult,
};

// Cast a plain async fn to the registry handler type for injection.
const fakeHandler = (fn: (...args: unknown[]) => unknown): RpcHandler =>
  fn as unknown as RpcHandler;

afterEach(() => {
  vi.restoreAllMocks();        // restores console spies
  mockedGetRpcHandler.mockReset();
  mockedOpen.mockReset();
});

describe('dispatch — allowlist gate', () => {
  it('blocks non-whitelisted method (no log line)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await dispatch('saveRule', {}, readyCtx);
    expect(res).toEqual({
      ok: false,
      error: { code: 'standalone-v1-disabled', method: 'saveRule' },
    });
    expect(errSpy).not.toHaveBeenCalled();
    expect(mockedGetRpcHandler).not.toHaveBeenCalled();
  });

  it('unknown input (in no tier) returns standalone-v1-disabled, not unknown-method', async () => {
    const res = await dispatch('totallyMadeUp', {}, readyCtx);
    expect(res).toEqual({
      ok: false,
      error: { code: 'standalone-v1-disabled', method: 'totallyMadeUp' },
    });
  });
});

describe('dispatch — data-ready guard', () => {
  it('returns handler-error "data not ready" when analyzer is undefined', async () => {
    const res = await dispatch('getStats', {}, {});
    expect(res).toEqual({
      ok: false,
      error: { code: 'handler-error', method: 'getStats', message: 'data not ready' },
    });
    expect(mockedGetRpcHandler).not.toHaveBeenCalled();
  });
});

describe('dispatch — registry tier', () => {
  it('allows a whitelisted method through (mocked handler)', async () => {
    mockedGetRpcHandler.mockReturnValueOnce(fakeHandler(async () => ({ value: 42 })));
    const res = await dispatch('getStats', {}, readyCtx);
    expect(res).toEqual({ ok: true, data: { value: 42 } });
    expect(mockedGetRpcHandler).toHaveBeenCalledWith('getStats');
  });

  it('normalizes a handler returning undefined to data: null', async () => {
    mockedGetRpcHandler.mockReturnValueOnce(fakeHandler(async () => undefined));
    const res = await dispatch('getStats', {}, readyCtx);
    expect(res).toEqual({ ok: true, data: null });
  });

  it('wraps a thrown handler error as a handler-error envelope (no crash)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedGetRpcHandler.mockReturnValueOnce(
      fakeHandler(async () => {
        throw new Error('boom');
      }),
    );
    const res = await dispatch('getStats', {}, readyCtx);
    expect(res).toEqual({
      ok: false,
      error: { code: 'handler-error', method: 'getStats', message: 'boom' },
    });
    expect(errSpy).toHaveBeenCalled();
  });

  it('returns unknown-method when an allowlisted method has no registry handler', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedGetRpcHandler.mockReturnValueOnce(undefined); // allowlisted but absent from registry
    const res = await dispatch('getStats', {}, readyCtx);
    expect(res).toEqual({
      ok: false,
      error: { code: 'unknown-method', method: 'getStats' },
    });
    expect(errSpy).toHaveBeenCalled();
  });
});

describe('dispatch — native tier', () => {
  it('runs a native method before the allowlist, with no analyzer', async () => {
    // openExternal is NOT in V1_ALLOWED; it must resolve via STANDALONE_NATIVE
    // ahead of the gate, and must not require ctx.analyzer/parseResult.
    const res = await dispatch('openExternal', { url: 'https://example.com' }, {});
    expect(res).toEqual({ ok: true, data: { ok: true } });
    expect(mockedOpen).toHaveBeenCalledTimes(1);
    expect(mockedGetRpcHandler).not.toHaveBeenCalled();
  });
});
