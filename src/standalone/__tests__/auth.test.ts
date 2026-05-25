import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { createAuthMiddleware } from '../auth';

const TOKEN = 'a'.repeat(64);

function mockReq(init: { query?: Record<string, unknown>; headers?: Record<string, string> }): Request {
  return { query: init.query ?? {}, headers: init.headers ?? {} } as unknown as Request;
}

function mockRes(): { res: Response; status: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> } {
  const end = vi.fn();
  const status = vi.fn().mockReturnValue({ end });
  const res = { status } as unknown as Response;
  return { res, status, end };
}

describe('createAuthMiddleware', () => {
  it('calls next() for a matching ?t= query token', () => {
    const next = vi.fn();
    const { res } = mockRes();
    createAuthMiddleware(TOKEN)(mockReq({ query: { t: TOKEN } }), res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('calls next() for a matching coach_token cookie', () => {
    const next = vi.fn();
    const { res } = mockRes();
    createAuthMiddleware(TOKEN)(mockReq({ headers: { cookie: `coach_token=${TOKEN}; other=1` } }), res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('calls next() for a matching Authorization: Bearer token', () => {
    const next = vi.fn();
    const { res } = mockRes();
    createAuthMiddleware(TOKEN)(mockReq({ headers: { authorization: `Bearer ${TOKEN}` } }), res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('401s when no credential is present', () => {
    const next = vi.fn();
    const { res, status } = mockRes();
    createAuthMiddleware(TOKEN)(mockReq({}), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });

  it('401s on a wrong-length token without throwing', () => {
    const next = vi.fn();
    const { res, status } = mockRes();
    createAuthMiddleware(TOKEN)(mockReq({ query: { t: 'short' } }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });

  it('401s on a same-length but mismatched token', () => {
    const next = vi.fn();
    const { res, status } = mockRes();
    createAuthMiddleware(TOKEN)(mockReq({ query: { t: 'b'.repeat(64) } }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });
});
