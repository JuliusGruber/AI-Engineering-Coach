#!/usr/bin/env node
// scripts/parity-gap.mjs — §4 automated parity-gap detection.
//
// Computes  gap = universe \ exposed  where
//   universe = keyof ExtensionMethodMap (extends RpcMethodMap), read at upstream/main
//              so the fork's own additive edits never fold into the universe.
//   exposed  = V1_ALLOWED ∪ V1_SERVICE_ALLOWED ∪ keys(STANDALONE_NATIVE), read at HEAD.
// Then cross-references shipped-page call sites (silent degradations) and flags
// methods upstream added since the fork's merge-base ("allowlist decision needed").
//
// Prints a report to stdout. It does NOT overwrite docs-fork/STANDALONE-PARITY-GAPS.md —
// that doc carries human bucket A–F / difficulty / Effect curation; the skill drafts it
// from report-template.md using this output.
//
// Run from the repo root:
//   node .claude/skills/merging-upstream/scripts/parity-gap.mjs
import { execSync } from 'node:child_process';

const sh = (cmd) => execSync(cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const tryGrep = (cmd) => { try { return sh(cmd); } catch { return ''; } }; // git grep exits 1 on no match

// recorded baseline (§4.3) — counts prove the parser counted the Set literally and did
// not pick up comment tokens. These are EXPECTED-to-evolve as the fork allowlists more;
// a mismatch is a DRIFT note for a human, not a hard failure.
const BASELINE = { v1: 52, service: 12, native: 1, exposed: 65 };

// ---- refs --------------------------------------------------------------------
const base = sh('git merge-base HEAD upstream/main').trim();
const head = sh('git rev-parse upstream/main').trim();
const behind = sh('git rev-list --count HEAD..upstream/main').trim();

// ---- parsers -----------------------------------------------------------------
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

function interfaceBody(src, name) {
  const m = new RegExp(`^export interface ${name}\\b[^{]*\\{`, 'm').exec(src);
  if (!m) throw new Error(`interface ${name} not found in rpc-types.ts`);
  const rest = src.slice(m.index + m[0].length);
  const close = /^\}/m.exec(rest); // members are one-per-line; first col-0 } closes the interface
  return rest.slice(0, close ? close.index : undefined);
}
function methodKeys(body) {
  const re = /^\s+([A-Za-z_$][\w$]*)\s*:\s*\{\s*params\b/gm;
  const out = new Set(); let m;
  while ((m = re.exec(stripComments(body)))) out.add(m[1]);
  return out;
}
function setLiterals(src) {
  const m = /new Set<string>\(\[([\s\S]*?)\]\)/.exec(src);
  if (!m) throw new Error('Set<string> literal not found');
  const clean = stripComments(m[1]); // <- strip BEFORE extracting, else require('vscode') leaks
  const out = new Set(); const lit = /['"]([A-Za-z_$][\w$]*)['"]/g; let x;
  while ((x = lit.exec(clean))) out.add(x[1]);
  return out;
}
function nativeKeys(src) {
  const out = new Set(); let inside = false;
  for (const raw of src.split('\n')) {
    const line = raw.replace(/\/\/.*$/, '');
    if (!inside) { if (/export const STANDALONE_NATIVE\b/.test(line)) inside = true; continue; }
    const km = /^  ([A-Za-z_$][\w$]*)\s*:/.exec(line); // top-level (2-space) keys only
    if (km) out.add(km[1]);
    if (/^\};/.test(line)) break;
  }
  return out;
}
const union = (...sets) => { const o = new Set(); for (const s of sets) for (const v of s) o.add(v); return o; };

// ---- universe (upstream ref) + base universe (for "newly appeared") ----------
const rpcHead = sh('git show upstream/main:src/core/types/rpc-types.ts');
const rpcBase = sh(`git show ${base}:src/core/types/rpc-types.ts`);
const universe = union(methodKeys(interfaceBody(rpcHead, 'RpcMethodMap')),
                       methodKeys(interfaceBody(rpcHead, 'ExtensionMethodMap')));
const universeBase = union(methodKeys(interfaceBody(rpcBase, 'RpcMethodMap')),
                           methodKeys(interfaceBody(rpcBase, 'ExtensionMethodMap')));

// ---- exposed (HEAD) ----------------------------------------------------------
const v1 = setLiterals(sh('git show HEAD:src/standalone/v1-allowed.ts'));
const service = setLiterals(sh('git show HEAD:src/standalone/v1-service-allowed.ts'));
const native = nativeKeys(sh('git show HEAD:src/standalone/standalone-native.ts'));
const exposed = union(v1, service, native);

// ---- gap + delta -------------------------------------------------------------
const gap = [...universe].filter((m) => !exposed.has(m)).sort();
const newSinceBase = [...universe].filter((m) => !universeBase.has(m)).sort();

// ---- report ------------------------------------------------------------------
const flag = (n, want) => (n === want ? 'OK' : `DRIFT (baseline ${want})`);
const out = [];
out.push(`# parity-gap — derived ${base.slice(0, 7)} (merge-base) -> re-verified ${head.slice(0, 7)} (upstream/main), ${behind} behind`);
out.push('');
out.push('## counts (regression assertions — count the Set literally, never the header comment)');
out.push(`  V1_ALLOWED         = ${v1.size}   ${flag(v1.size, BASELINE.v1)}`);
out.push(`  V1_SERVICE_ALLOWED = ${service.size}   ${flag(service.size, BASELINE.service)}`);
out.push(`  STANDALONE_NATIVE  = ${native.size}    ${flag(native.size, BASELINE.native)}`);
out.push(`  exposed (union)    = ${exposed.size}   ${flag(exposed.size, BASELINE.exposed)}`);
out.push(`  universe (upstream)= ${universe.size}`);
out.push(`  gap                = ${gap.length}   (universe \\ exposed)`);
out.push('');
out.push('## gap methods (universe \\ exposed) — bucket / difficulty / Effect stay HUMAN');
for (const m of gap) {
  const loc = tryGrep(`git grep -n "  ${m}:" upstream/main -- src/core/types/rpc-types.ts`)
    .split('\n')[0].trim().replace(/^upstream\/main:/, '');
  out.push(`  - ${m}${loc ? `   (${loc.split(':').slice(0, 2).join(':')})` : ''}`);
}
out.push('');
out.push('## per-method degradations — shipped-page call sites for gap methods (STEP 7)');
let anyDeg = false;
for (const m of gap) {
  const hits = tryGrep(`git grep -n "${m}" -- "src/webview/page-*.ts"`).trim();
  if (hits) {
    anyDeg = true;
    out.push(`  ${m}: CALLED by a shipped page but NOT exposed -> silent degradation`);
    for (const line of hits.split('\n')) out.push(`      ${line}`);
  }
}
if (!anyDeg) out.push('  (no gap method is called by a shipped src/webview/page-*.ts — gaps are unreachable, not silent)');
out.push('');
out.push('## newly-appeared upstream methods since merge-base — ALLOWLIST DECISION NEEDED');
if (newSinceBase.length === 0) out.push('  (none — the upstream RPC surface is unchanged since the fork base)');
else for (const m of newSinceBase) {
  const tag = exposed.has(m) ? '(already exposed)' : gap.includes(m) ? '(currently a GAP)' : '';
  out.push(`  - ${m}   ${tag}`);
}
out.push('');
console.log(out.join('\n'));
