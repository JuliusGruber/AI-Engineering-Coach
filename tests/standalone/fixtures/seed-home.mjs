// tests/standalone/fixtures/seed-home.mjs
// Writes synthetic Claude Code session logs under <home>/.claude/projects/, spanning the
// last 7 days, so every standalone nav page renders without console errors. Timestamps are
// relative to Date.now() so date-windowed pages stay populated regardless of when CI runs.
// Format per src/core/parser-claude.ts (JSONL: one JSON object per line).
import * as fs from 'node:fs';
import * as path from 'node:path';

const MODELS = ['claude-opus-4-20250805', 'claude-sonnet-4-20250514'];
const TOOLS = ['Write', 'Edit', 'Read', 'Skill'];
const DAY = 86_400_000;

export function seedHome(home) {
  const projectsDir = path.join(home, '.claude', 'projects');
  const projects = ['-Users-coach-demo-api', '-Users-coach-demo-web']; // → two workspaces
  const now = Date.now();

  for (const proj of projects) {
    const dir = path.join(projectsDir, proj);
    fs.mkdirSync(dir, { recursive: true });
    for (let d = 0; d < 7; d++) {
      const sessionId = `sess-${proj.slice(-3)}-${d}`;
      const base = now - d * DAY - 3 * 3_600_000; // mid-day each of the last 7 days
      const lines = [];
      for (let turn = 0; turn < 3; turn++) {
        const userTs = new Date(base + turn * 120_000).toISOString();
        lines.push(JSON.stringify({
          type: 'user',
          timestamp: userTs,
          sessionId,
          cwd: `/Users/coach/${proj}`,
          message: { role: 'user', content: [{ type: 'text', text: `task ${turn} on day ${d}` }] },
        }));
        const asstTs = new Date(base + turn * 120_000 + 30_000).toISOString();
        lines.push(JSON.stringify({
          type: 'assistant',
          timestamp: asstTs,
          sessionId,
          message: {
            role: 'assistant',
            model: MODELS[turn % MODELS.length],
            content: [
              { type: 'text', text: `Working on task ${turn}.` },
              { type: 'tool_use', name: TOOLS[turn % TOOLS.length], input: { file_path: `/Users/coach/${proj}/f${turn}.ts`, content: 'x' } },
            ],
            usage: { input_tokens: 1200 + turn * 100, output_tokens: 300 + turn * 50, cache_read_input_tokens: 500 },
          },
        }));
      }
      fs.writeFileSync(path.join(dir, `${sessionId}.jsonl`), lines.join('\n') + '\n');
    }
  }
  return projectsDir;
}

// `node seed-home.mjs <home>` for manual inspection.
if (process.argv[2]) {
  const dir = seedHome(process.argv[2]);
  process.stdout.write(`seeded ${dir}\n`);
}
