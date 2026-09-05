/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Shared edit-delta extraction for CLI harness tool payloads. */

import { countAddedRemoved, countLines, EditLoc, EditLocIndex } from './edit-loc-diff';

export type FileEditLocMap = Map<string, EditLoc>;

export function addFileEditLoc(
  edits: FileEditLocMap,
  file: string,
  added: number,
  removed: number,
): void {
  if (!file) return;
  const current = edits.get(file);
  if (current) {
    current.added += Math.max(0, added);
    current.removed += Math.max(0, removed);
  } else {
    edits.set(file, { added: Math.max(0, added), removed: Math.max(0, removed) });
  }
}

export function recordContentReplacement(
  edits: FileEditLocMap,
  file: string,
  previous: string,
  next: string,
): void {
  const delta = countAddedRemoved(previous, next);
  addFileEditLoc(edits, file, delta.added, delta.removed);
}

export function recordCreatedContent(edits: FileEditLocMap, file: string, content: string): void {
  addFileEditLoc(edits, file, countLines(content), 0);
}

/**
 * Adds a harness-derived request delta unless a host-level source (notably VS Code's
 * chatEditingSessions timeline) already recorded the request. Host telemetry is authoritative
 * for correlated programmatic Claude turns because it includes undo state and file baselines.
 */
export function mergeRequestEditLoc(
  index: EditLocIndex | undefined,
  requestId: string,
  edits: FileEditLocMap,
  authoritative = false,
): void {
  if (!index || !requestId || (!authoritative && edits.size === 0) || index.has(requestId)) return;
  index.set(requestId, new Map(
    [...edits].map(([file, delta]) => [file, { added: delta.added, removed: delta.removed }]),
  ));
}

function normalizeDiffPath(raw: string): string {
  let value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      value = JSON.parse(value) as string;
    } catch {
      value = value.slice(1, -1);
    }
  }
  value = value.split('\t', 1)[0].trim();
  if (value.startsWith('a/') || value.startsWith('b/')) value = value.slice(2);
  return value === '/dev/null' ? '' : value;
}

/**
 * Extracts added/removed line counts from the `*** Begin Patch` format used by GitHub
 * Copilot and Codex, plus ordinary unified diffs used by other harnesses.
 */
export function parseApplyPatch(patch: string): FileEditLocMap {
  const result: FileEditLocMap = new Map();
  const lines = patch.split(/\r?\n/);
  let file = '';
  let inHunk = false;
  let customPatch = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const customHeader = line.match(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/);
    if (customHeader) {
      file = normalizeDiffPath(customHeader[1]);
      inHunk = !line.startsWith('*** Delete File:');
      customPatch = true;
      if (file && !result.has(file)) result.set(file, { added: 0, removed: 0 });
      continue;
    }
    if (line.startsWith('*** Move to: ')) {
      const moved = normalizeDiffPath(line.slice('*** Move to: '.length));
      if (moved) {
        const existing = result.get(file);
        if (existing) {
          result.delete(file);
          addFileEditLoc(result, moved, existing.added, existing.removed);
        }
        file = moved;
      }
      continue;
    }
    if (line.startsWith('diff --git ')) {
      file = '';
      inHunk = false;
      customPatch = false;
      continue;
    }
    // `---`/`+++` only introduce a file when they appear as a pair. Inside a hunk a removed
    // line whose content starts with `-- ` (a SQL or Lua comment, say) is serialized as
    // `--- ...`, and treating that as a header would misattribute the rest of the hunk.
    if (!customPatch && line.startsWith('--- ') && lines[i + 1]?.startsWith('+++ ')) {
      const oldFile = normalizeDiffPath(line.slice(4));
      file = normalizeDiffPath(lines[i + 1].slice(4)) || oldFile;
      if (file && !result.has(file)) result.set(file, { added: 0, removed: 0 });
      inHunk = false;
      i++;
      continue;
    }
    if (!customPatch && line.startsWith('@@')) {
      inHunk = true;
      continue;
    }
    if (!file || !inHunk) continue;
    if (line.startsWith('+')) addFileEditLoc(result, file, 1, 0);
    else if (line.startsWith('-')) addFileEditLoc(result, file, 0, 1);
  }

  return result;
}

export function mergeFileEditLoc(target: FileEditLocMap, source: FileEditLocMap): void {
  for (const [file, delta] of source) addFileEditLoc(target, file, delta.added, delta.removed);
}
