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
