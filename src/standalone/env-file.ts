// src/standalone/env-file.ts
// The standalone `coach` CLI reads its LLM provider key from process.env only
// (detectProvider in llm-provider.ts). Users naturally drop the key in a .env file
// and expect it to be picked up, but nothing loaded it. This is a minimal, dependency-free
// loader: parse KEY=VALUE lines and apply them WITHOUT overriding variables already set in
// the real environment (so an exported key or one injected by `bws run` always wins).
// Deliberately NOT a full dotenv: no variable expansion, no inline-comment stripping.
import * as fs from 'fs';

/** Parse .env file contents into a flat map. Blank lines and `#` comments are skipped. */
export function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split('\n')) {
    const line = rawLine.replace(/\r$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue; // no '=' (-1) or empty key (0)
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    out[key] = stripQuotes(line.slice(eq + 1).trim());
  }
  return out;
}

/** Strip a single pair of matching surrounding double or single quotes. */
function stripQuotes(value: string): string {
  if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value[value.length - 1] === value[0]) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Read `filePath`, applying each KEY=VALUE to `env` only when the key is not already set.
 * A missing file is a silent no-op. Returns the names actually applied (for an optional log line).
 */
export function loadEnvFile(filePath: string, env: NodeJS.ProcessEnv = process.env): string[] {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return []; // no .env in the working directory — nothing to load
  }
  const applied: string[] = [];
  for (const [key, value] of Object.entries(parseEnvFile(content))) {
    if (env[key] === undefined) {
      env[key] = value;
      applied.push(key);
    }
  }
  return applied;
}
