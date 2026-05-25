// src/standalone/image-route.ts
// GET /img?path=<urlencoded> — RPC handlers (getImageGallery / getSessionImages)
// return filesystem paths into session logs, not blobs. This serves them, but
// only from the six known log roots, after resolving away traversal.
// See docs-fork/specs/01-server.md.
import type { RequestHandler } from 'express';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ALLOWED_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

export function createImageRoute(): RequestHandler {
  const allowedPrefixes = [
    '.claude', '.codex', '.opencode', '.vscode', '.xcode', '.copilot-analytics-cache',
  ].map((d) => path.join(os.homedir(), d));

  return (req, res) => {
    const raw = typeof req.query.path === 'string' ? req.query.path : null;
    if (!raw) {
      res.status(400).end('missing path');
      return;
    }
    const abs = path.resolve(decodeURIComponent(raw));
    if (!allowedPrefixes.some((p) => abs === p || abs.startsWith(p + path.sep))) {
      res.status(403).end('outside allowlist');
      return;
    }
    if (!ALLOWED_EXTS.has(path.extname(abs).toLowerCase())) {
      res.status(415).end('unsupported type');
      return;
    }
    try {
      fs.statSync(abs);
    } catch {
      res.status(404).end('not found');
      return;
    }
    // dotfiles:'allow' — log roots begin with '.'; Express's default 'ignore' would 404 them.
    res.sendFile(abs, { dotfiles: 'allow', headers: { 'Content-Disposition': 'inline' } });
  };
}
