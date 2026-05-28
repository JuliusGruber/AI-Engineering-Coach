// src/standalone/v1-allowed.ts
// The authoritative v1 method allowlist (see docs-fork/specs/00-overview.md).
// 40 read-only getRpcHandler methods + 2 bucket-A additions (getDataExplorer,
// evaluateExpression) + 3 bucket-D NL-rule methods (explainOccurrence, generateRule,
// compileNlRule, now LLM-backed via the vscode.lm stub) = 45. getRuleEditor is
// deliberately excluded (its handler calls require('vscode')); calibrateRule/
// runRuleTests are deferred (no exposed page reaches them).

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
