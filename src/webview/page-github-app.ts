/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { GitHubAppMetrics, GitHubAppSnapshot } from '../core/types';
import { createChart, COLORS, formatNum } from './shared';
import { CanvasEl, html, render, type ComponentChildren } from './render';

interface FunnelStage {
  className: string;
  width: number;
  count: number;
  label: string;
  detail: string;
}

function percentage(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function funnelStage(stage: FunnelStage): ComponentChildren {
  return html`
    <li class=${`gha-funnel-stage ${stage.className}`} style=${`--funnel-width:${stage.width}%`}>
      <div class="gha-funnel-stage-body">
        <span class="gha-stage-number">${formatNum(stage.count)}</span>
        <span class="gha-funnel-stage-copy"><strong>${stage.label}</strong><small>${stage.detail}</small></span>
      </div>
    </li>`;
}

function projectSessionsStage(metrics: GitHubAppMetrics): ComponentChildren {
  const sessionsWithoutIssue = metrics.totalProjectSessions - metrics.sessionsWithIssue;
  return html`
    <li
      class="gha-funnel-stage gha-funnel-stage-start"
      style="--funnel-width:100%"
      aria-label=${`${formatNum(metrics.totalProjectSessions)} project sessions: ${formatNum(metrics.sessionsWithIssue)} with an issue and ${formatNum(sessionsWithoutIssue)} without an issue`}
    >
      <div class="gha-funnel-stage-body gha-funnel-stage-body-start">
        <div class="gha-funnel-stage-total">
          <span class="gha-stage-number">${formatNum(metrics.totalProjectSessions)}</span>
          <span class="gha-funnel-stage-copy"><strong>Project sessions</strong><small>100% started</small></span>
        </div>
        <dl class="gha-funnel-origin-breakdown">
          <div>
            <dt><i class="gha-dot gha-dot-issue"></i>With issue</dt>
            <dd>${formatNum(metrics.sessionsWithIssue)}</dd>
          </div>
          <div>
            <dt><i class="gha-dot gha-dot-direct"></i>Without issue</dt>
            <dd>${formatNum(sessionsWithoutIssue)}</dd>
          </div>
        </dl>
      </div>
    </li>`;
}

function deliveryFunnel(metrics: GitHubAppMetrics): ComponentChildren {
  const pullRequestRate = percentage(metrics.sessionsWithPullRequest, metrics.totalProjectSessions);
  const mergeRate = percentage(metrics.sessionsWithMergedPullRequest, metrics.totalProjectSessions);
  const pullRequestMergeRate = percentage(metrics.sessionsWithMergedPullRequest, metrics.sessionsWithPullRequest);
  return html`
    <ol class="gha-funnel" aria-label="Project session delivery funnel">
      ${projectSessionsStage(metrics)}
      ${funnelStage({
        className: 'gha-funnel-stage-pr',
        width: Math.max(46, pullRequestRate),
        count: metrics.sessionsWithPullRequest,
        label: 'Sessions with a PR',
        detail: `${pullRequestRate}% of sessions`,
      })}
      ${funnelStage({
        className: 'gha-funnel-stage-merged',
        width: Math.max(34, mergeRate),
        count: metrics.sessionsWithMergedPullRequest,
        label: 'Sessions with a merged PR',
        detail: `${pullRequestMergeRate}% of PR sessions`,
      })}
    </ol>`;
}

function formatLastActivity(value: string | null): string {
  if (!value) return 'No activity yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function renderUnavailable(container: HTMLElement): void {
  render(html`
    <div class="gha-page">
      <header class="gha-header">
        <div>
          <h1>GitHub App</h1>
          <p>Project-session productivity from the local GitHub Copilot app.</p>
        </div>
      </header>
      <div class="gha-empty" role="status">
        <div class="gha-empty-icon">!</div>
        <div>
          <h2>Productivity data is not available</h2>
          <p>The GitHub Copilot app is installed, but its local database could not be read. Make sure the <code>sqlite3</code> command is available, then reload the dashboard.</p>
        </div>
      </div>
    </div>`, container);
}

function funnelSection(metrics: GitHubAppMetrics): ComponentChildren {
  const mergeRate = percentage(metrics.sessionsWithMergedPullRequest, metrics.totalProjectSessions);
  return html`
    <section class="gha-funnel-card" aria-labelledby="gha-delivery-title">
      <div class="gha-section-heading">
        <div>
          <h2 id="gha-delivery-title">Delivery funnel</h2>
          <p>Follow project sessions through raised and merged pull requests.</p>
        </div>
        <span>${mergeRate}% reach merge</span>
      </div>
      ${metrics.totalProjectSessions === 0
        ? html`<div class="gha-inline-empty">Create a project session in the GitHub Copilot app to start this delivery path.</div>`
        : deliveryFunnel(metrics)}
    </section>`;
}

function mergeRatioSection(metrics: GitHubAppMetrics): ComponentChildren {
  const { recentRaised, recentMerged } = metrics.mergeHistory.reduce(
    (totals, day) => ({
      recentRaised: totals.recentRaised + day.pullRequestsRaised,
      recentMerged: totals.recentMerged + day.pullRequestsMerged,
    }),
    { recentRaised: 0, recentMerged: 0 },
  );
  const hasRecentPullRequests = recentRaised > 0;
  return html`
    <section class="gha-merge-ratio" aria-labelledby="gha-merge-ratio-title">
      <div class="gha-section-heading">
        <div>
          <h2 id="gha-merge-ratio-title">PR merge ratio · last 7 days</h2>
          <p>Current merged share of PRs from project sessions created on each completed day.</p>
        </div>
      </div>
      <div class="gha-merge-ratio-layout">
        ${hasRecentPullRequests
          ? html`<${CanvasEl} id="githubAppMergeRatioChart" height=${210} />`
          : html`<div class="gha-inline-empty">No PRs were raised in the last seven completed days.</div>`}
        <dl class="gha-merge-ratio-stats">
          <div><dt>7-day merge ratio</dt><dd>${hasRecentPullRequests ? `${percentage(recentMerged, recentRaised)}%` : '—'}</dd><small>${formatNum(recentMerged)} of ${formatNum(recentRaised)} PRs</small></div>
          <div><dt>PRs raised</dt><dd>${formatNum(recentRaised)}</dd><small>Last 7 completed days</small></div>
          <div><dt>PRs merged</dt><dd>${formatNum(recentMerged)}</dd><small>From these daily cohorts</small></div>
        </dl>
      </div>
      <p class="gha-cohort-note">Days are grouped by project-session creation date. Ratios update when those PRs merge.</p>
    </section>`;
}

function renderMergeRatioChart(metrics: GitHubAppMetrics): void {
  if (!metrics.mergeHistory.some(day => day.pullRequestsRaised > 0)) return;
  const labels = metrics.mergeHistory.map(item => {
    const [, month, day] = item.date.split('-');
    return `${month}/${day}`;
  });
  createChart('githubAppMergeRatioChart', 'line', {
    labels,
    datasets: [
      {
        type: 'bar',
        label: 'PRs raised',
        data: metrics.mergeHistory.map(day => day.pullRequestsRaised),
        yAxisID: 'count',
        backgroundColor: COLORS.blue + '3D',
        borderColor: COLORS.blue,
        borderWidth: 1,
        borderRadius: 2,
        order: 2,
      },
      {
        label: 'Merge ratio',
        data: metrics.mergeHistory.map(day => day.pullRequestsRaised > 0
          ? percentage(day.pullRequestsMerged, day.pullRequestsRaised)
          : null),
        yAxisID: 'ratio',
        backgroundColor: COLORS.green + '1F',
        borderColor: COLORS.green,
        borderWidth: 2,
        pointBackgroundColor: COLORS.green,
        pointRadius: 3,
        tension: 0.28,
        spanGaps: false,
        fill: true,
        order: 1,
      },
    ],
  }, {
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { position: 'bottom' } },
    scales: {
      x: { grid: { display: false } },
      ratio: { position: 'left', min: 0, max: 100, ticks: { callback: (value: number | string) => `${value}%` } },
      count: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, ticks: { precision: 0 } },
    },
  });
}

function renderMetrics(container: HTMLElement, metrics: GitHubAppMetrics): void {
  render(html`
    <div class="gha-page">
      <header class="gha-header">
        <div>
          <h1>GitHub App</h1>
          <p>Follow project sessions from their starting context through pull request delivery.</p>
        </div>
        <div class="gha-last-activity">
          <span>Last activity</span>
          <strong>${formatLastActivity(metrics.lastActivityAt)}</strong>
        </div>
      </header>
      ${funnelSection(metrics)}
      ${mergeRatioSection(metrics)}
    </div>`, container);

  renderMergeRatioChart(metrics);
}

export function renderGitHubApp(container: HTMLElement, snapshot: GitHubAppSnapshot): void {
  if (snapshot.status !== 'ready') {
    renderUnavailable(container);
    return;
  }
  renderMetrics(container, snapshot.metrics);
}
