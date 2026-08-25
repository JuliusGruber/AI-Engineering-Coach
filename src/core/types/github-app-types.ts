/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface GitHubAppMergeDay {
  date: string;
  pullRequestsRaised: number;
  pullRequestsMerged: number;
}

export interface GitHubAppMetrics {
  totalProjectSessions: number;
  sessionsWithIssue: number;
  sessionsWithPullRequest: number;
  sessionsWithMergedPullRequest: number;
  lastActivityAt: string | null;
  mergeHistory: GitHubAppMergeDay[];
}

export type GitHubAppSnapshot =
  | { status: 'absent' }
  | { status: 'unavailable' }
  | { status: 'ready'; metrics: GitHubAppMetrics };
