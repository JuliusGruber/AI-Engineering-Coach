// src/standalone/auth.ts
// Token gate for every standalone HTTP route. The 64-hex token arrives as a
// ?t= query (first GET /), a coach_token cookie (set by GET /), or a Bearer
// header (reserved for v2). See docs-fork/specs/01-server.md.
import type { RequestHandler } from 'express';
import { timingSafeEqual } from 'crypto';

function safeEqual(a: string, b: string): boolean {
  // Different lengths can't be compared by timingSafeEqual (it throws); reject early.
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function cookieToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === 'coach_token') {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

export function createAuthMiddleware(token: string): RequestHandler {
  return (req, res, next) => {
    const query = typeof req.query.t === 'string' ? req.query.t : null;
    const cookie = cookieToken(req.headers.cookie);
    const authHeader = req.headers.authorization;
    const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;
    const candidate = query ?? cookie ?? bearer;
    if (candidate !== null && safeEqual(candidate, token)) {
      next();
      return;
    }
    res.status(401).end('unauthorized');
  };
}
