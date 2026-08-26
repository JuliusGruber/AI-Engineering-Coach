/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Tests for the GitHub Copilot CLI events parser, focused on the streaming async path added for
 * issue #106 (parseCLIEventsFileAsync) and the resilient recordFailedFile catch. */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, it, expect, beforeEach } from 'vitest';
import { EditLocIndex } from './edit-loc-diff';
import { parseCLIEventsFile, parseCLIEventsFileAsync } from './parser-vscode-cli';
import { getParseWarningCounts, resetParseWarnings } from './parser-shared';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-engineer-coach-cli-'));
  tempDirs.push(dir);
  return dir;
}

/** Write an events.jsonl from a list of event objects and return its path. */
function writeEvents(events: Array<Record<string, unknown>>): string {
  const dir = makeTempDir();
  const fp = path.join(dir, 'events.jsonl');
  fs.writeFileSync(fp, events.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf-8');
  return fp;
}

const SAMPLE_EVENTS: Array<Record<string, unknown>> = [
  { type: 'session.start', timestamp: '2025-06-15T10:00:00Z', data: { sessionId: 'sess-1', startTime: '2025-06-15T10:00:00Z', selectedModel: 'claude-sonnet-4' } },
  { type: 'user.message', timestamp: '2025-06-15T10:00:01Z', data: { content: 'add a function', agentMode: 'agent' } },
  { type: 'assistant.message', id: 'a1', timestamp: '2025-06-15T10:00:02Z', data: { content: 'Sure, editing now.', outputTokens: 12 } },
  { type: 'tool.execution_start', timestamp: '2025-06-15T10:00:03Z', data: { toolName: 'edit', arguments: { path: 'foo.ts', new_str: 'export const x = 1;' } } },
  { type: 'session.shutdown', timestamp: '2025-06-15T10:00:05Z', data: { modelMetrics: { 'claude-sonnet-4': { usage: { inputTokens: 100, outputTokens: 12 } } } } },
];

beforeEach(() => resetParseWarnings());

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('parseCLIEventsFileAsync', () => {
  it('parses a well-formed events file into a CLI session', async () => {
    const fp = writeEvents(SAMPLE_EVENTS);
    const session = await parseCLIEventsFileAsync(fp, 'ws-1', 'My Workspace');

    expect(session).not.toBeNull();
    expect(session!.sessionId).toBe('sess-1');
    expect(session!.harness).toBe('GitHub Copilot CLI');
    expect(session!.workspaceId).toBe('ws-1');
    expect(session!.workspaceName).toBe('My Workspace');
    expect(session!.endReason).toBe('shutdown');
    expect(session!.requests).toHaveLength(1);

    const req = session!.requests[0];
    expect(req.messageText).toBe('add a function');
    expect(req.editedFiles).toContain('foo.ts');
    expect(req.toolsUsed).toContain('edit');
  });

  it('reports byte progress ending at the total file size', async () => {
    const fp = writeEvents(SAMPLE_EVENTS);
    const total = fs.statSync(fp).size;
    const progress: Array<[number, number]> = [];

    await parseCLIEventsFileAsync(fp, 'ws-1', 'My Workspace', undefined, (read, t) => progress.push([read, t]));

    // Small files finish in one chunk, so onProgress fires once with the final totals.
    expect(progress.at(-1)).toEqual([total, total]);
  });

  it('returns null and records a failed file when the path cannot be read', async () => {
    const dir = makeTempDir();
    const missing = path.join(dir, 'does-not-exist.jsonl');

    const session = await parseCLIEventsFileAsync(missing, 'ws-1', 'My Workspace');

    expect(session).toBeNull();
    expect(getParseWarningCounts().skippedFiles).toBe(1);
  });

  it('returns null for a file with no recognizable events', async () => {
    const fp = writeEvents([{ type: 'unknown.event', data: {} }]);
    const session = await parseCLIEventsFileAsync(fp, 'ws-1', 'My Workspace');
    expect(session).toBeNull();
  });

  it('produces the same requests as the synchronous parser', async () => {
    const fp = writeEvents(SAMPLE_EVENTS);
    const sync = parseCLIEventsFile(fp, 'ws-1', 'My Workspace');
    const asyncResult = await parseCLIEventsFileAsync(fp, 'ws-1', 'My Workspace');

    expect(asyncResult).not.toBeNull();
    expect(sync).not.toBeNull();
    expect(asyncResult!.requests.map((r) => r.messageText)).toEqual(sync!.requests.map((r) => r.messageText));
    expect(asyncResult!.requests[0].editedFiles).toEqual(sync!.requests[0].editedFiles);
  });
});

describe('CLI edit delta extraction', () => {
  it('captures freeform apply_patch arguments used by current Copilot CLI and App sessions', () => {
    const fp = writeEvents([
      { type: 'session.start', data: { sessionId: 'sess-patch' } },
      { type: 'user.message', data: { content: 'patch it' } },
      {
        type: 'tool.execution_start',
        data: {
          toolName: 'apply_patch',
          arguments: [
            '*** Begin Patch',
            '*** Update File: src/app.ts',
            '@@',
            '-const oldValue = 1;',
            '+const newValue = 2;',
            '+const extra = 3;',
            '*** End Patch',
          ].join('\n'),
        },
      },
      { type: 'assistant.message', id: 'assistant-patch', data: { content: 'Done.' } },
    ]);
    const editLocIndex: EditLocIndex = new Map();

    const session = parseCLIEventsFile(fp, 'ws', 'Workspace', undefined, editLocIndex);

    expect(session?.requests[0].editedFiles).toEqual(['src/app.ts']);
    expect(editLocIndex.get('assistant-patch')?.get('src/app.ts')).toEqual({ added: 2, removed: 1 });
  });

  it('diffs edit old_str/new_str payloads instead of counting all replacement text', () => {
    const fp = writeEvents([
      { type: 'session.start', data: { sessionId: 'sess-edit' } },
      { type: 'user.message', data: { content: 'edit it' } },
      {
        type: 'tool.execution_start',
        data: {
          toolName: 'edit',
          arguments: { path: 'src/app.ts', old_str: 'a\nold', new_str: 'a\nnew\nextra' },
        },
      },
      { type: 'assistant.message', id: 'assistant-edit', data: { content: 'Done.' } },
    ]);
    const editLocIndex: EditLocIndex = new Map();

    parseCLIEventsFile(fp, 'ws', 'Workspace', undefined, editLocIndex);

    expect(editLocIndex.get('assistant-edit')?.get('src/app.ts')).toEqual({ added: 2, removed: 1 });
  });

  it('does not count failed edit tool attempts', () => {
    const fp = writeEvents([
      { type: 'session.start', data: { sessionId: 'sess-failed' } },
      { type: 'user.message', data: { content: 'edit it' } },
      {
        type: 'tool.execution_start',
        data: {
          toolCallId: 'call-failed',
          toolName: 'edit',
          arguments: { path: 'src/app.ts', old_str: 'old', new_str: 'new' },
        },
      },
      {
        type: 'tool.execution_complete',
        data: { toolCallId: 'call-failed', success: false, error: { message: 'not applied' } },
      },
      { type: 'assistant.message', id: 'assistant-failed', data: { content: 'The edit failed.' } },
    ]);
    const editLocIndex: EditLocIndex = new Map();

    const session = parseCLIEventsFile(fp, 'ws', 'Workspace', undefined, editLocIndex);

    expect(session?.requests[0].editedFiles).toEqual([]);
    expect(editLocIndex.size).toBe(0);
  });

  it('does not count correlated edit calls without a completion event', () => {
    const fp = writeEvents([
      { type: 'session.start', data: { sessionId: 'sess-incomplete' } },
      { type: 'user.message', data: { content: 'edit it' } },
      {
        type: 'tool.execution_start',
        data: {
          toolCallId: 'call-incomplete',
          toolName: 'edit',
          arguments: { path: 'src/app.ts', old_str: 'old', new_str: 'new' },
        },
      },
      { type: 'assistant.message', id: 'assistant-incomplete', data: { content: 'Editing...' } },
    ]);
    const editLocIndex: EditLocIndex = new Map();

    const session = parseCLIEventsFile(fp, 'ws', 'Workspace', undefined, editLocIndex);

    expect(session?.requests[0].editedFiles).toEqual([]);
    expect(editLocIndex.size).toBe(0);
  });
});
