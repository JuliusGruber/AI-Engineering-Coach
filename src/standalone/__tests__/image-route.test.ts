import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createImageRoute } from '../image-route';

const mockOs = vi.hoisted(() => ({
  homedir: vi.fn(),
}));

vi.mock('os', async () => {
  const actual = await vi.importActual('os');
  return {
    ...actual,
    homedir: mockOs.homedir,
  };
});

let tmpHome: string;
let server: http.Server;
let base: string;

function listen(app: express.Express): Promise<{ server: http.Server; base: string }> {
  return new Promise((resolve) => {
    const s = http.createServer(app);
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server: s, base: `http://127.0.0.1:${port}` });
    });
  });
}

beforeEach(async () => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-img-'));
  mockOs.homedir.mockReturnValue(tmpHome);
  // Fixture inside an allowed root (~/.claude). The PNG signature keeps sniffers happy.
  fs.mkdirSync(path.join(tmpHome, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(tmpHome, '.claude', 'shot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(tmpHome, '.claude', 'notes.txt'), 'nope');
  fs.writeFileSync(path.join(tmpHome, 'outside.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const app = express();
  app.get('/img', createImageRoute());
  ({ server, base } = await listen(app));
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.restoreAllMocks();
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function imgUrl(p: string): string {
  return `${base}/img?path=${encodeURIComponent(p)}`;
}

describe('createImageRoute', () => {
  it('serves an image inside an allowed root', async () => {
    const res = await fetch(imgUrl(path.join(tmpHome, '.claude', 'shot.png')));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/png');
  });

  it('serves content from a dotfile directory (dotfiles: allow)', async () => {
    // Regression for Express's default dotfiles:'ignore' which would 404 ~/.claude.
    const res = await fetch(imgUrl(path.join(tmpHome, '.claude', 'shot.png')));
    expect(res.status).toBe(200);
  });

  it('rejects a path outside the allowed roots (403)', async () => {
    const res = await fetch(imgUrl(path.join(tmpHome, 'outside.png')));
    expect(res.status).toBe(403);
  });

  it('rejects a traversal path that escapes an allowed root (403)', async () => {
    const res = await fetch(imgUrl(path.join(tmpHome, '.claude', '..', '..', 'etc', 'passwd')));
    expect(res.status).toBe(403);
  });

  it('rejects an unsupported extension (415)', async () => {
    const res = await fetch(imgUrl(path.join(tmpHome, '.claude', 'notes.txt')));
    expect(res.status).toBe(415);
  });

  it('rejects a missing path query (400)', async () => {
    const res = await fetch(`${base}/img`);
    expect(res.status).toBe(400);
  });
});
