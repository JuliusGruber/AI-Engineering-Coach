/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import {
  loadGitHubAppMetrics,
  parseGitHubAppIssueSessionReferences,
  parseGitHubAppMetricsRows,
} from './github-app-analytics';

function row(date: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    date,
    cohortPullRequestsRaised: 4,
    cohortPullRequestsMerged: 3,
    totalProjectSessions: 12,
    sessionsWithIssue: 7,
    sessionsWithPullRequest: 8,
    sessionsWithMergedPullRequest: 6,
    lastActivityAt: '2026-08-24T10:00:00.000Z',
    ...overrides,
  };
}

function queryResult(
  sql: string,
  references: Record<string, unknown>[] = [],
  workspaceLinks: Record<string, unknown>[] = [],
): string {
  if (sql.includes('WITH RECURSIVE')) return JSON.stringify([row('2026-08-24')]);
  if (sql.includes('FROM session_refs')) return JSON.stringify(references);
  if (sql.includes('workspace_session_aliases')) return JSON.stringify(workspaceLinks);
  throw new Error('Unexpected query');
}

describe('GitHub App analytics parsing', () => {
  it('parses summary and daily PR merge cohorts', () => {
    const metrics = parseGitHubAppMetricsRows(JSON.stringify([
      row('2026-08-23'),
      row('2026-08-24', { cohortPullRequestsRaised: 0, cohortPullRequestsMerged: 0 }),
    ]));

    expect(metrics).toMatchObject({
      totalProjectSessions: 12,
      sessionsWithIssue: 7,
      sessionsWithPullRequest: 8,
      sessionsWithMergedPullRequest: 6,
    });
    expect(metrics.mergeHistory).toEqual([
      { date: '2026-08-23', pullRequestsRaised: 4, pullRequestsMerged: 3 },
      { date: '2026-08-24', pullRequestsRaised: 0, pullRequestsMerged: 0 },
    ]);
  });

  it('parses issue-linked session identifiers', () => {
    expect(parseGitHubAppIssueSessionReferences(JSON.stringify([
      { sessionId: 'session-1' },
      { sessionId: 'session-2' },
    ]))).toEqual(['session-1', 'session-2']);
  });

});

describe('GitHub App analytics availability', () => {
  it('hides the feature when the App database is absent', async () => {
    const metrics = await loadGitHubAppMetrics({
      databasePath: path.join(os.tmpdir(), 'missing-copilot-data.db'),
      sessionStorePath: path.join(os.tmpdir(), 'missing-session-store.db'),
      exists: () => false,
      query: () => Promise.reject(new Error('query should not run')),
    });

    expect(metrics).toEqual({ status: 'absent' });
  });

  it('keeps the feature visible when an installed database cannot be queried', async () => {
    const metrics = await loadGitHubAppMetrics({
      databasePath: path.join(os.tmpdir(), 'copilot-data.db'),
      sessionStorePath: path.join(os.tmpdir(), 'missing-session-store.db'),
      exists: () => true,
      query: () => Promise.reject(new Error('sqlite unavailable')),
    });

    expect(metrics).toEqual({ status: 'unavailable' });
  });

  it('loads seven completed days without querying the optional session store', async () => {
    const databasePath = path.join(os.tmpdir(), 'copilot-data.db');
    const queries: string[] = [];
    const metrics = await loadGitHubAppMetrics({
      databasePath,
      sessionStorePath: path.join(os.tmpdir(), 'missing-session-store.db'),
      exists: filePath => filePath === databasePath,
      query: (_requestedPath, sql) => {
        queries.push(sql);
        return Promise.resolve(queryResult(sql));
      },
    });

    expect(metrics.status).toBe('ready');
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain("VALUES(date('now', '-7 days'))");
    expect(queries[0]).toContain("date('now', '-1 day')");
  });
});

describe('GitHub App issue references', () => {
  it('counts only issue references that map to project workspaces', async () => {
    const databasePath = path.join(os.tmpdir(), 'copilot-data.db');
    const sessionStorePath = path.join(os.tmpdir(), 'session-store.db');
    const metrics = await loadGitHubAppMetrics({
      databasePath,
      sessionStorePath,
      exists: () => true,
      query: (_requestedPath, sql) => Promise.resolve(queryResult(sql, [
        { sessionId: 'issue-session-1' },
        { sessionId: 'unrelated-issue-session' },
      ], [
        { workspaceId: 'workspace-direct', hasDirectIssue: 1, sessionId: null },
        { workspaceId: 'workspace-linked', hasDirectIssue: 0, sessionId: 'issue-session-1' },
        { workspaceId: 'workspace-linked', hasDirectIssue: 0, sessionId: 'alias-session' },
        { workspaceId: 'workspace-unlinked', hasDirectIssue: 0, sessionId: 'other-session' },
      ])),
    });

    expect(metrics.status).toBe('ready');
    if (metrics.status !== 'ready') throw new Error('Expected ready metrics.');
    expect(metrics.metrics.sessionsWithIssue).toBe(2);
  });
});
