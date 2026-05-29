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

import { dispatchServiceMethod } from '../request-service-bridge';
import { LLM_UNAVAILABLE_HINT } from '../llm-unavailable'; // real helper (not mocked) — the rewrite runs
vi.mock('../request-service-bridge', () => ({ dispatchServiceMethod: vi.fn() }));
const mockedDispatchService = vi.mocked(dispatchServiceMethod);

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
  mockedDispatchService.mockReset();
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
