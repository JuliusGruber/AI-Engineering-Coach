/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import {
  FileEditLocMap,
  mergeRequestEditLoc,
  parseApplyPatch,
  recordContentReplacement,
  recordCreatedContent,
} from './edit-tool-diff';

describe('edit tool deltas', () => {
  it('parses Copilot/Codex apply_patch additions, updates, and moves per file', () => {
    const edits = parseApplyPatch([
      '*** Begin Patch',
      '*** Add File: src/new.ts',
      '+export const one = 1;',
      '+export const two = 2;',
      '*** Update File: src/app.ts',
      '@@',
      '-const oldValue = 1;',
      '+const newValue = 2;',
      '+const extra = 3;',
      '*** Move to: src/main.ts',
      '*** Delete File: src/removed.ts',
      '*** End Patch',
    ].join('\n'));

    expect(edits.get('src/new.ts')).toEqual({ added: 2, removed: 0 });
    expect(edits.get('src/main.ts')).toEqual({ added: 2, removed: 1 });
    // The freeform delete command does not include deleted content, but the file is still known.
    expect(edits.get('src/removed.ts')).toEqual({ added: 0, removed: 0 });
  });

  it('parses ordinary unified diff hunks without counting file headers', () => {
    const edits = parseApplyPatch([
      'diff --git a/src/app.ts b/src/app.ts',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1,2 +1,2 @@',
      '-old',
      '+new',
      ' unchanged',
    ].join('\n'));

    expect(edits.get('src/app.ts')).toEqual({ added: 1, removed: 1 });
  });

  it('does not treat a removed comment line as a unified diff file header', () => {
    const edits = parseApplyPatch([
      'diff --git a/db/schema.sql b/db/schema.sql',
      '--- a/db/schema.sql',
      '+++ b/db/schema.sql',
      '@@ -1,4 +1,4 @@',
      '--- legacy column, kept for backfill',
      '-  legacy_id INTEGER,',
      '+-- replaced by the surrogate key',
      '+  surrogate_id INTEGER,',
      ' );',
    ].join('\n'));

    expect(edits.size).toBe(1);
    expect(edits.get('db/schema.sql')).toEqual({ added: 2, removed: 2 });
  });

  it('records create and replacement deltas using logical lines', () => {
    const edits: FileEditLocMap = new Map();
    recordCreatedContent(edits, 'new.ts', 'a\nb\n');
    recordContentReplacement(edits, 'app.ts', 'a\nold', 'a\nnew\nextra');

    expect(edits.get('new.ts')).toEqual({ added: 2, removed: 0 });
    expect(edits.get('app.ts')).toEqual({ added: 2, removed: 1 });
  });

  it('does not overwrite an authoritative host delta for a correlated request', () => {
    const index = new Map([['request_1', new Map([['file:///app.ts', { added: 1, removed: 0 }]])]]);
    const harnessEdits = new Map([['app.ts', { added: 20, removed: 10 }]]);

    mergeRequestEditLoc(index, 'request_1', harnessEdits);

    expect(index.get('request_1')).toEqual(new Map([['file:///app.ts', { added: 1, removed: 0 }]]));
  });
});
