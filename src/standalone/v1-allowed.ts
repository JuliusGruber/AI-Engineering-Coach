// src/standalone/v1-allowed.ts
// The authoritative v1 method allowlist (see docs-fork/specs/00-overview.md).
// 40 read-only getRpcHandler methods + 2 bucket-A additions (getDataExplorer,
// evaluateExpression) + 3 bucket-D NL-rule methods (explainOccurrence, generateRule,
// compileNlRule) + 7 bucket-B rule/import methods (getRuleEditor, getRuleSource,
// getRulePreview, saveRule, updateRuleThreshold, testRuleLive, importRegistryRules) = 52.
// calibrateRule / runRuleTests remain deferred (no exposed page reaches them).

const _inner = new Set<string>([
  'getWorkspaces', 'getHarnesses', 'getHarnessBreakdown',
  'getDailyActivity', 'getWorkspaceBreakdown', 'getHourlyDistribution',
  'getHeatmap', 'getCodeProduction', 'getConsumption', 'getBurndown',
  'getAiCredits', 'getAiCreditBurndown', 'getTokenCoverage',
  'getDayTimeline', 'getSessions', 'getSessionDetail',
  'getWorkLifeBalance', 'getAntiPatterns', 'getHarnessComparison',
  'getParserCoverage', 'getParserPreview', 'getWorkflowOptimization',
  'getStats', 'getConfigHealth', 'getInsights', 'getFlowState',
  'getContextManagement', 'getWorkspaceContextSessions',
  'getContextRangeAvailability', 'getCalendarActivity',
  'getProjectOverview', 'getImageGallery', 'getSessionImages',
  'getRuleCoverage', 'getFieldSchema', 'getMetricPrimitives',
  'getFunctionCatalog', 'getMetricList', 'getDataExplorerFields',
  'getRegistryCatalog', 'getDataExplorer', 'evaluateExpression',
  'explainOccurrence', 'generateRule', 'compileNlRule',
  // Bucket B — Rule Editor / Anti-Patterns / Import (registry tier). saveRule writes via Node
  // fs (works as-is; trust recording no-ops with no store). getRuleEditor accepts the graceful
  // require('vscode') fallback (workspaceRoot → undefined → personal+builtin layers). testRuleLive
  // is reached by the rule-editor modal (page-antipatterns-editor.ts:297). importRegistryRules has
  // no caller in src/ yet — allowlisted forward-only (exposes the method; no standalone UI hits it).
  'getRuleEditor', 'getRuleSource', 'getRulePreview',
  'saveRule', 'updateRuleThreshold', 'testRuleLive', 'importRegistryRules',
]);

function _throwMutation(): never {
  throw new TypeError('V1_ALLOWED is frozen and cannot be mutated');
}

export const V1_ALLOWED: ReadonlySet<string> = new Proxy(_inner, {
  get(target, prop) {
    if (prop === 'add' || prop === 'delete' || prop === 'clear') {
      return _throwMutation;
    }
    // Use target (not receiver) to satisfy Set's internal-slot requirements.
    const value = Reflect.get(target, prop, target);
    if (typeof value === 'function') {
      return value.bind(target);
    }
    return value;
  },
});
