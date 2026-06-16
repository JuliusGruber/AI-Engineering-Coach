/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * Incremental, tool-agnostic line counting for VS Code chatEditingSessions.
 *
 * VS Code persists a timeline of edit operations per agent session. Models that use
 * apply_patch (OpenAI/Codex) re-serialize the WHOLE file as a `textEdit` after every
 * small change, so naively summing the lines in each payload counts the unchanged body
 * of a file many times over. Models that use ranged string-replace edits (Anthropic)
 * conversely under-count, since only inserted newlines were tallied.
 *
 * This module reconstructs each file version from its baseline and counts only the lines
 * that are new compared to the previous version of that same file. The diff is a linear
 * multiset comparison of line hashes, so it stays O(payload chars) — the same asymptotic
 * class as the previous newline scan — while removing the per-tool bias.
 */

/** A monaco-style range as serialized in the edit-state timeline (1-based, end-exclusive). */
export interface RangeLike {
  startLineNumber?: number;
  startColumn?: number;
  endLineNumber?: number;
  endColumn?: number;
}

/** A single text edit within a `textEdit` operation. */
export interface TextEditLike {
  range?: RangeLike;
  text?: string;
}

/** A file operation entry from `timeline.operations`. */
export interface EditOpLike {
  type: string;
  requestId?: string;
  uri?: { external?: string };
  epoch?: number;
  edits?: TextEditLike[];
}

/** A baseline entry from `timeline.fileBaselines` (full pre-edit content for a request). */
export interface FileBaselineLike {
  uri?: { external?: string };
  requestId?: string;
  content?: string;
}

/** The `timeline` object inside a chatEditingSessions `state.json`. */
export interface EditTimelineLike {
  operations?: EditOpLike[];
  fileBaselines?: [string, FileBaselineLike][];
}

/** Resolves the session-initial content for a file URI (read from `contents/<hash>`). */
export type InitialContentResolver = (uriExternal: string) => string | undefined;

/** Lines the model added and removed for a single (request, file) cell. */
export interface EditLoc {
  added: number;
  removed: number;
}

/** Per-request, per-file produced-line tallies: requestId -> fileUri -> {added, removed}. */
export type EditLocIndex = Map<string, Map<string, EditLoc>>;

const NEWLINE = 10;

/** djb2 (xor variant) hash of a line slice, computed without allocating a substring. */
function hashLineSlice(text: string, start: number, end: number): number {
  let h = 5381;
  for (let i = start; i < end; i++) {
    h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  }
  return h;
}

/** Invokes `cb` once per newline-delimited segment (matching `split('\n')`), including a trailing empty segment. */
function forEachLineHash(text: string, cb: (h: number) => void): void {
  let segStart = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === NEWLINE) {
      cb(hashLineSlice(text, segStart, i));
      segStart = i + 1;
    }
  }
  cb(hashLineSlice(text, segStart, text.length));
}

/** Logical line count: newlines plus a final line when the text does not end in a newline. '' -> 0. */
export function countLines(text: string): number {
  if (text.length === 0) return 0;
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === NEWLINE) n++;
  }
  if (text.charCodeAt(text.length - 1) !== NEWLINE) n++;
  return n;
}

/**
 * Counts how many lines of `next` are new compared to `prev`, treating lines as an
 * unordered multiset. Reworked or reordered lines that already existed are not counted;
 * lines that were replaced are counted as new. Linear in the size of both inputs.
 */
export function countAddedLines(prev: string, next: string): number {
  const counts = new Map<number, number>();
  forEachLineHash(prev, h => counts.set(h, (counts.get(h) ?? 0) + 1));
  let added = 0;
  forEachLineHash(next, h => {
    const c = counts.get(h);
    if (c && c > 0) {
      counts.set(h, c - 1);
    } else {
      added++;
    }
  });
  return added;
}

/**
 * Counts, in a single multiset pass, how many lines of `next` are new versus `prev`
 * (`added`) and how many lines of `prev` are gone from `next` (`removed`). Lines are
 * treated as an unordered multiset, so reordering counts as neither. Linear in both inputs.
 */
export function countAddedRemoved(prev: string, next: string): EditLoc {
  const counts = new Map<number, number>();
  forEachLineHash(prev, h => counts.set(h, (counts.get(h) ?? 0) + 1));
  let added = 0;
  forEachLineHash(next, h => {
    const c = counts.get(h);
    if (c && c > 0) {
      counts.set(h, c - 1);
    } else {
      added++;
    }
  });
  let removed = 0;
  for (const c of counts.values()) if (c > 0) removed += c;
  return { added, removed };
}

/**
 * Reconstructs the file content after applying a `textEdit` operation's edits to `content`.
 * Ranges are 1-based line/column and end-exclusive (monaco semantics). Edits are applied
 * bottom-up so earlier offsets remain valid. Edits without a range are appended.
 */
export function applyTextEdits(content: string, edits: TextEditLike[] | undefined): string {
  if (!edits || edits.length === 0) return content;

  const lineStart: number[] = [0];
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === NEWLINE) lineStart.push(i + 1);
  }
  const offsetOf = (line: number, col: number): number => {
    const li = (line | 0) - 1;
    if (li >= lineStart.length) return content.length;
    let off = lineStart[Math.max(li, 0)] + Math.max((col | 0) - 1, 0);
    if (off < 0) off = 0;
    if (off > content.length) off = content.length;
    return off;
  };

  const resolved: { start: number; end: number; text: string }[] = [];
  const appended: string[] = [];
  for (const e of edits) {
    const text = e?.text ?? '';
    const r = e?.range;
    if (!r || typeof r.startLineNumber !== 'number') {
      appended.push(text);
      continue;
    }
    let start = offsetOf(r.startLineNumber, r.startColumn ?? 1);
    let end = offsetOf(r.endLineNumber ?? r.startLineNumber, r.endColumn ?? r.startColumn ?? 1);
    if (end < start) {
      const tmp = start;
      start = end;
      end = tmp;
    }
    resolved.push({ start, end, text });
  }

  resolved.sort((a, b) => b.start - a.start || b.end - a.end);
  let result = content;
  for (const r of resolved) {
    result = result.slice(0, r.start) + r.text + result.slice(r.end);
  }
  if (appended.length > 0) result += appended.join('');
  return result;
}

/** Builds a `${uri}::${requestId}` -> pre-request baseline content lookup. */
function buildBaselineMap(timeline: EditTimelineLike): Map<string, string> {
  const baselineByKey = new Map<string, string>();
  for (const entry of timeline.fileBaselines ?? []) {
    const baseline = entry?.[1];
    const uri = baseline?.uri?.external;
    const reqId = baseline?.requestId;
    if (uri && reqId) baselineByKey.set(`${uri}::${reqId}`, baseline.content ?? '');
  }
  return baselineByKey;
}

/** Groups `textEdit` operations by file URI, preserving input order. */
function groupTextEditOpsByFile(ops: EditOpLike[]): Map<string, EditOpLike[]> {
  const byFile = new Map<string, EditOpLike[]>();
  for (const op of ops) {
    if (op.type !== 'textEdit') continue;
    const uri = op.uri?.external;
    if (!uri || !op.requestId) continue;
    let arr = byFile.get(uri);
    if (!arr) {
      arr = [];
      byFile.set(uri, arr);
    }
    arr.push(op);
  }
  return byFile;
}

/** Records `added`/`removed` lines against a (request, file) cell, summing into any existing value. */
function addLoc(editLocIndex: EditLocIndex, reqId: string, uri: string, added: number, removed: number): void {
  if (added <= 0 && removed <= 0) return;
  let fileMap = editLocIndex.get(reqId);
  if (!fileMap) {
    fileMap = new Map();
    editLocIndex.set(reqId, fileMap);
  }
  const cur = fileMap.get(uri);
  if (cur) {
    cur.added += added;
    cur.removed += removed;
  } else {
    fileMap.set(uri, { added, removed });
  }
}

/** Chooses the diff seed for a request: per-request baseline, then session-initial, then carry-over. */
function seedPrev(
  prev: string | undefined,
  uri: string,
  reqId: string,
  baselineByKey: Map<string, string>,
  resolveInitialContent?: InitialContentResolver,
): string {
  const baseline = baselineByKey.get(`${uri}::${reqId}`);
  if (baseline !== undefined) return baseline;
  if (prev === undefined) return resolveInitialContent?.(uri) ?? '';
  return prev;
}

/** Walks one file's operations in epoch order, attributing newly produced lines to each request. */
function accumulateFileOps(
  uri: string,
  fileOps: EditOpLike[],
  baselineByKey: Map<string, string>,
  editLocIndex: EditLocIndex,
  resolveInitialContent?: InitialContentResolver,
): void {
  fileOps.sort((a, b) => (a.epoch ?? 0) - (b.epoch ?? 0));
  let prev: string | undefined;
  let lastReqId: string | undefined;
  for (const op of fileOps) {
    const reqId = op.requestId!;
    if (reqId !== lastReqId) {
      prev = seedPrev(prev, uri, reqId, baselineByKey, resolveInitialContent);
      lastReqId = reqId;
    }
    const next = applyTextEdits(prev!, op.edits);
    if (prev === '') {
      addLoc(editLocIndex, reqId, uri, countLines(next), 0);
    } else {
      const { added, removed } = countAddedRemoved(prev!, next);
      addLoc(editLocIndex, reqId, uri, added, removed);
    }
    prev = next;
  }
}

/**
 * Walks a session's edit timeline and records, per request and file, the number of lines
 * the model actually produced — reconstructing each file version and counting only the
 * lines that are new versus the previous version of that file.
 *
 * `prev` (the seed for the diff) is chosen per request in priority order:
 *   1. the per-request baseline (`fileBaselines[`${uri}::${requestId}`]`) — the file's
 *      content at the start of that request, including any manual edits;
 *   2. otherwise, for the first request to touch the file, the session-initial content
 *      (resolved from `initialFileContents` via `resolveInitialContent`);
 *   3. otherwise, the reconstructed state carried over from the previous request;
 *   4. otherwise empty — the file is treated as genuinely new and counted in full.
 */
export function accumulateEditLoc(
  timeline: EditTimelineLike | undefined,
  editLocIndex: EditLocIndex,
  resolveInitialContent?: InitialContentResolver,
): void {
  const ops = timeline?.operations;
  if (!ops || ops.length === 0) return;

  const baselineByKey = buildBaselineMap(timeline);
  const byFile = groupTextEditOpsByFile(ops);
  for (const [uri, fileOps] of byFile) {
    accumulateFileOps(uri, fileOps, baselineByKey, editLocIndex, resolveInitialContent);
  }
}
