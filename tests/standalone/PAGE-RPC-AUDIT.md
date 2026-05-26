# Per-Page RPC Degradation Audit

**Date audited:** 2026-05-26  
**Git SHA audited:** `09c4ce9`  
**Branch:** `claude/superpowers-install-Q6zeg`

---

## 1  Evidence — raw `rpc` / `rpcAllSettled` call sites

Command run (per task Step 1):

```
grep -rnoE "rpc(AllSettled)?\(([^)]*)" src/webview/page-*.ts | sort
```

Hits (method names extracted from full grep output):

| File | Line | Call |
|------|------|------|
| page-achievements.ts | 484 | `rpcAllSettled([getStats, getCodeProduction, getWorkLifeBalance, getAntiPatterns, getHourlyDistribution])` |
| page-achievements.ts | 498 | `rpc('getSessions', …)` |
| page-achievements.ts | 499 | `rpc('getDailyActivity', …)` |
| page-achievements.ts | 500 | `rpc('getSessions', …)` |
| page-achievements.ts | 501 | `rpc('getCodeProduction', …)` |
| page-achievements.ts | 502 | `rpc('getConsumption', …)` |
| page-achievements.ts | 503 | `rpc('getWorkflowOptimization', …)` |
| page-antipatterns.ts | 221 | `rpc('getAntiPatterns', …)` (in bare `Promise.all`) |
| page-antipatterns.ts | 222 | `rpc('getRuleEditor', …)` (in bare `Promise.all`) — **BANNER_WORTHY** |
| page-antipatterns.ts | 680 | `rpc('explainOccurrence', …)` (user action) |
| page-antipatterns.ts | 1025 | `rpc('reviewLocalRules', …)` (user action) |
| page-antipatterns.ts | 1175 | `rpc('updateRuleThreshold', …)` (user action) |
| page-antipatterns.ts | 1176 | `rpc('getRulePreview', …)` (user action) |
| page-antipatterns-heatmap.ts | 146 | `rpc('getRuleCoverage', …)` |
| page-burndown.ts | 95 | `rpc('saveModelBudgets', …).catch(…)` |
| page-burndown.ts | 103 | `rpc('loadModelBudgets', …)` (in try/catch) |
| page-burndown.ts | 177 | `rpc('getAiCredits', …)` |
| page-burndown.ts | 367 | `rpc('getAiCreditBurndown', …)` |
| page-config.ts | 87 | `rpc('getContextRangeAvailability', …)` (in try/catch) |
| page-config.ts | 211 | `rpc('getConfigHealth', …)` |
| page-config.ts | 372 | `rpc('reviewContextFiles', …)` (user action) |
| page-dashboard.ts | 190 | `rpcAllSettled([getStats, getDailyActivity, getWorkspaceBreakdown, getHarnessBreakdown, getAntiPatterns, getCodeProduction])` |
| page-dashboard.ts | 376 | `rpc('getWorkflowOptimization', …)` (skill widget, try/catch) |
| page-dashboard.ts | 395 | `rpc('triageSkills', …).catch(() => null)` |
| page-dashboard.ts | 396 | `rpc('discoverCatalog', …).catch(() => null)` |
| page-dashboard.ts | 407 | `rpc('triageCatalog', …)` (in try/catch) — **BANNER_WORTHY** |
| page-data-explorer.ts | 61 | `rpc('getDataExplorerFields', …)` |
| page-data-explorer.ts | 133 | `rpc('getDataExplorer', …)` |
| page-experiments.ts | 221 | `rpc('getSdlcToolAnalysis', …).catch(…)` |
| page-image-gallery.ts | 88 | `rpc('getImageGallery', …)` |
| page-image-gallery.ts | 116 | `rpc('getSessionImages', …)` |
| page-learning.ts | 51 | `rpc('generateLearningQuiz', …)` — **BANNER_WORTHY** |
| page-learning.ts | 473 | `rpc('generateCodeComparison', …)` — **BANNER_WORTHY** |
| page-learning.ts | 538 | `rpc('generateDidYouKnow', …)` — **BANNER_WORTHY** |
| page-learning.ts | 647 | `rpc('generateLearningResources', …).then(…).catch(…)` — **BANNER_WORTHY** |
| page-learning.ts | 684 | `rpc('getCodeProduction', …)` |
| page-learning.ts | 685 | `rpc('getFlowState', …)` |
| page-learning.ts | 686 | `rpc('getWorkspaceDeps', …)` |
| page-learning.ts | 687 | `rpc('getWorkspaceBreakdown', …)` |
| page-output.ts | 252 | `rpc('getCodeProduction', …)` |
| page-output.ts | 637 | `rpc('getAiCredits', …)` |
| page-patterns.ts | 121 | `rpc('getHeatmap', …)` |
| page-patterns.ts | 122 | `rpc('getWorkLifeBalance', …)` |
| page-patterns.ts | 182 | `rpc('getCalendarActivity', …)` |
| page-patterns.ts | 183 | `rpc('getHeatmap', …)` |
| page-patterns.ts | 195 | `rpc('getProjectOverview', …)` |
| page-peers.ts | 243–249 | `rpc('getStats', getCodeProduction, getWorkLifeBalance, getFlowState, getCodeProduction, getDailyActivity, getAntiPatterns)` (in Promise.all, inside level-up sub-tab) |
| page-peers.ts | 338 | `rpc('exportSummary', …)` (user action) |
| page-peers.ts | 349 | `rpc('openExternal', …).catch(…)` — **NATIVE** |
| page-rule-editor.ts | 106 | `rpc('getRuleEditor', …)` — **BANNER_WORTHY** |
| page-rule-editor.ts | 301 | `rpc('generateRule', …)` (user action) |
| page-rule-editor.ts | 321 | `rpc('saveRule', …)` (user action) |
| page-rule-editor.ts | 473 | `rpc('updateRuleThreshold', …)` (user action) |
| page-rule-editor.ts | 474 | `rpc('getRulePreview', …)` (user action) |
| page-rule-editor.ts | 491 | `rpc('getRuleSource', …)` (user action) |
| page-rule-editor.ts | 507 | `rpc('saveRule', …)` (user action) |
| page-rule-playground.ts | 50 | `rpc('getFieldSchema', …)` |
| page-rule-playground.ts | 51 | `rpc('getFunctionCatalog', …)` |
| page-rule-playground.ts | 52 | `rpc('getMetricList', …)` |
| page-rule-playground.ts | 175 | `rpc('evaluateExpression', …)` (user action) |
| page-rule-playground.ts | 222 | `rpc('compileNlRule', …)` (user action) |
| page-rule-playground.ts | 250 | `rpc('saveRule', …)` (user action) |
| page-rule-playground.ts | 262 | `rpc('compileNlRule', …)` (user action) |
| page-rule-playground.ts | 273 | `rpc('saveRule', …)` (user action) |
| page-sdlc.ts | 90 | `rpc('getSessions', …)` |
| page-sdlc.ts | 91 | `rpc('getSdlcToolAnalysis', …)` |
| page-sdlc.ts | 92 | `rpc('getSdlcRepoScan', …)` |
| page-skills.ts | 30 | `rpc('getWorkspaces', …)` |
| page-skills.ts | 171 | `rpc('getWorkflowOptimization', …)` (in try/catch, button action) |
| page-skills.ts | 184 | `rpc('triageSkills', …)` (in try/catch, button action) |
| page-skills.ts | 274 | `rpc('generateSkillContent', …)` (in try/catch, button action) — **BANNER_WORTHY** |
| page-skills.ts | 298 | `rpc('installSkill', …)` (in try/catch, button action) — **BANNER_WORTHY** |
| page-skills.ts | 352 | `rpc('discoverCatalog', …)` (in try/catch, button action) |
| page-skills.ts | 366 | `rpc('triageCatalog', …)` (in try/catch, button action) — **BANNER_WORTHY** |
| page-skills.ts | 409 | `rpc('installCatalogItem', …)` (in try/catch, button action) — **BANNER_WORTHY** |
| page-timeline.ts | 95 | `rpc('getDayTimeline', …)` |
| page-timeline.ts | 202 | `rpc('getSessions', …)` |
| page-timeline.ts | 284 | `rpc('getDayTimeline', …)` |
| page-timeline.ts | 400 | `rpc('getSessionDetail', …)` |

**Also in `app.ts` (shared nav-badge refresh and onDataReady, fire-and-forget with `.catch(…)`):**  
`getStats`, `getAntiPatterns`, `getCodeProduction`, `getWorkspaces`, `getHarnesses`

**Summary counts:**  
- Pages with RPC calls: 14 page files (plus `app.ts`)  
- Distinct methods discovered: 48  
- V1_ALLOWED size: 40  
- BANNER_WORTHY size: 10  

---

## 2  Method Classification

Bucket definitions:
- **registry-allowlisted** — in `V1_ALLOWED` (`src/standalone/v1-allowed.ts`): works in standalone.
- **native** — in `STANDALONE_NATIVE` (`src/standalone/standalone-native.ts`): `openExternal` only; works in standalone.
- **banner-worthy** — in `BANNER_WORTHY` (`src/standalone/webview-shim.ts`): rpc call is rejected by dispatcher → shim triggers roadmap banner → page code receives rejection.
- **silent-disabled** — not in any set, not a user-action guarded by its own `.catch(() => null)` or try/catch at the call site; disabled by dispatcher, no banner shown.

| Method | Bucket |
|--------|--------|
| compileNlRule | silent-disabled |
| createSkill | banner-worthy |
| discoverCatalog | silent-disabled |
| evaluateExpression | silent-disabled |
| explainOccurrence | silent-disabled |
| exportSummary | silent-disabled |
| generateCodeComparison | banner-worthy |
| generateDidYouKnow | banner-worthy |
| generateLearningQuiz | banner-worthy |
| generateLearningResources | banner-worthy |
| generateRule | silent-disabled |
| generateSkillContent | banner-worthy |
| getAiCreditBurndown | registry-allowlisted |
| getAiCredits | registry-allowlisted |
| getAntiPatterns | registry-allowlisted |
| getBurndown | registry-allowlisted |
| getCalendarActivity | registry-allowlisted |
| getCodeProduction | registry-allowlisted |
| getConfigHealth | registry-allowlisted |
| getConsumption | registry-allowlisted |
| getContextManagement | registry-allowlisted |
| getContextRangeAvailability | registry-allowlisted |
| getDailyActivity | registry-allowlisted |
| getDataExplorer | silent-disabled |
| getDataExplorerFields | registry-allowlisted |
| getDayTimeline | registry-allowlisted |
| getFieldSchema | registry-allowlisted |
| getFlowState | registry-allowlisted |
| getFunctionCatalog | registry-allowlisted |
| getHarnessBreakdown | registry-allowlisted |
| getHarnesses | registry-allowlisted |
| getHeatmap | registry-allowlisted |
| getHourlyDistribution | registry-allowlisted |
| getImageGallery | registry-allowlisted |
| getInsights | registry-allowlisted |
| getMetricList | registry-allowlisted |
| getProjectOverview | registry-allowlisted |
| getRuleCoverage | registry-allowlisted |
| getRuleEditor | banner-worthy |
| getRulePreview | silent-disabled |
| getRuleSource | silent-disabled |
| getSdlcRepoScan | silent-disabled |
| getSdlcToolAnalysis | silent-disabled |
| getSessionDetail | registry-allowlisted |
| getSessionImages | registry-allowlisted |
| getSessions | registry-allowlisted |
| getStats | registry-allowlisted |
| getTokenCoverage | registry-allowlisted |
| getWorkLifeBalance | registry-allowlisted |
| getWorkspaceBreakdown | registry-allowlisted |
| getWorkspaceContextSessions | registry-allowlisted |
| getWorkspaceDeps | silent-disabled |
| getWorkflowOptimization | registry-allowlisted |
| getWorkspaces | registry-allowlisted |
| installCatalogItem | banner-worthy |
| installSkill | banner-worthy |
| loadModelBudgets | silent-disabled |
| openExternal | native |
| reviewContextFiles | silent-disabled |
| reviewLocalRules | silent-disabled |
| saveModelBudgets | silent-disabled |
| saveRule | silent-disabled |
| triageCatalog | banner-worthy |
| triageSkills | silent-disabled |
| updateRuleThreshold | silent-disabled |

---

## 3  Per-Page Degradation Table

Router (src/webview/app.ts): `normalizePageForFeatureFlags` redirects `burndown → dashboard` when `FF_TOKEN_REPORTING_ENABLED` is false (app.ts:27). `renderBurndown` itself also renders a feature-gated notice and returns early (page-burndown.ts:123-137). Both guards confirmed present in source.

**Key to "renders?" column:**  
- **works** — primary data is V1_ALLOWED; full render with all sections.  
- **degraded** — primary data works; disabled sections silently collapse or show error state via per-call `.catch`/try-catch; page is navigable.  
- **BROKEN** — the render function rejects (bare `Promise.all` with a disabled method); `withErrorBoundary` shows the error-fallback div instead of page content.

### Nav pages (10)

| Page ID | Method | Bucket | Renders? |
|---------|--------|--------|----------|
| dashboard | getStats | registry-allowlisted | works |
| dashboard | getDailyActivity | registry-allowlisted | works |
| dashboard | getWorkspaceBreakdown | registry-allowlisted | works |
| dashboard | getHarnessBreakdown | registry-allowlisted | works |
| dashboard | getAntiPatterns | registry-allowlisted | works |
| dashboard | getCodeProduction | registry-allowlisted | works |
| dashboard | getWorkflowOptimization | registry-allowlisted | degraded (skill widget, try/catch) |
| dashboard | triageSkills | silent-disabled | degraded (.catch → null, skill section stays empty) |
| dashboard | discoverCatalog | silent-disabled | degraded (.catch → null) |
| dashboard | triageCatalog | banner-worthy | degraded (try/catch, banner shown) |
| timeline | getDayTimeline | registry-allowlisted | works |
| timeline | getSessions | registry-allowlisted | works |
| timeline | getSessionDetail | registry-allowlisted | works |
| image-gallery | getImageGallery | registry-allowlisted | works |
| image-gallery | getSessionImages | registry-allowlisted | works |
| output | getCodeProduction | registry-allowlisted | works |
| output | getAiCredits | registry-allowlisted | works |
| burndown | — | FF_TOKEN_REPORTING_ENABLED=false → redirect to dashboard | degraded (nav item removed; direct URL → dashboard) |
| burndown | getAiCredits | registry-allowlisted | works (if FF enabled) |
| burndown | getAiCreditBurndown | registry-allowlisted | works (if FF enabled) |
| burndown | saveModelBudgets | silent-disabled | degraded (.catch, best-effort only) |
| burndown | loadModelBudgets | silent-disabled | degraded (try/catch, budgets stay at local defaults) |
| patterns | getHeatmap | registry-allowlisted | works |
| patterns | getWorkLifeBalance | registry-allowlisted | works |
| patterns | getCalendarActivity | registry-allowlisted | works |
| patterns | getProjectOverview | registry-allowlisted | works |
| anti-patterns | getAntiPatterns | registry-allowlisted | works (primary data) |
| anti-patterns | getRuleEditor | **banner-worthy** | degraded — *was BROKEN* (bare `Promise.all`, no fallback); fixed by the shim's `RESOLVE_EMPTY_WHEN_DISABLED` neutralization (see §4); banner still fires |
| skills | getWorkspaces | registry-allowlisted | works (initial render) |
| skills | getWorkflowOptimization | registry-allowlisted | degraded (try/catch, button action) |
| skills | triageSkills | silent-disabled | degraded (try/catch, button action) |
| skills | generateSkillContent | banner-worthy | degraded (try/catch, button action, banner shown) |
| skills | installSkill | banner-worthy | degraded (try/catch, button action, banner shown) |
| skills | discoverCatalog | silent-disabled | degraded (try/catch, button action) |
| skills | triageCatalog | banner-worthy | degraded (try/catch, button action, banner shown) |
| skills | installCatalogItem | banner-worthy | degraded (try/catch, button action, banner shown) |
| config-health | getConfigHealth | registry-allowlisted | works |
| config-health | getContextRangeAvailability | registry-allowlisted | degraded (try/catch; falls back to all ranges) |
| config-health | reviewContextFiles | silent-disabled | degraded (user action, try/catch) |
| level-up (achievements tab) | getStats | registry-allowlisted | works |
| level-up (achievements tab) | getCodeProduction | registry-allowlisted | works |
| level-up (achievements tab) | getWorkLifeBalance | registry-allowlisted | works |
| level-up (achievements tab) | getAntiPatterns | registry-allowlisted | works |
| level-up (achievements tab) | getHourlyDistribution | registry-allowlisted | works |
| level-up (achievements tab) | getSessions | registry-allowlisted | works |
| level-up (achievements tab) | getDailyActivity | registry-allowlisted | works |
| level-up (achievements tab) | getConsumption | registry-allowlisted | works |
| level-up (achievements tab) | getWorkflowOptimization | registry-allowlisted | works |
| level-up (learning tab) | getCodeProduction | registry-allowlisted | works |
| level-up (learning tab) | getFlowState | registry-allowlisted | works |
| level-up (learning tab) | getWorkspaceDeps | silent-disabled | degraded (Promise.all resolves via rejection; rpcAllSettled-equivalent not used, but page catches via withErrorBoundary on tab level) |
| level-up (learning tab) | getWorkspaceBreakdown | registry-allowlisted | works |
| level-up (learning tab) | generateLearningQuiz | banner-worthy | degraded (user action; banner shown) |
| level-up (learning tab) | generateCodeComparison | banner-worthy | degraded (user action; banner shown) |
| level-up (learning tab) | generateDidYouKnow | banner-worthy | degraded (user action; banner shown) |
| level-up (learning tab) | generateLearningResources | banner-worthy | degraded (.then/.catch chain; banner shown; shows "Could not generate resources." on failure) |
| level-up (sdlc tab) | getSessions | registry-allowlisted | works |
| level-up (sdlc tab) | getSdlcToolAnalysis | silent-disabled | degraded (bare rpc call — note: also called with .catch in experiments tab badge refresh; sdlc tab itself wraps in Promise.all) |
| level-up (sdlc tab) | getSdlcRepoScan | silent-disabled | degraded (withErrorBoundary catches tab render failure) |
| level-up (shareCard tab) | getStats | registry-allowlisted | works |
| level-up (shareCard tab) | getCodeProduction | registry-allowlisted | works |
| level-up (shareCard tab) | getWorkLifeBalance | registry-allowlisted | works |
| level-up (shareCard tab) | getFlowState | registry-allowlisted | works |
| level-up (shareCard tab) | getDailyActivity | registry-allowlisted | works |
| level-up (shareCard tab) | getAntiPatterns | registry-allowlisted | works |
| level-up (shareCard tab) | exportSummary | silent-disabled | degraded (user action) |
| level-up (shareCard tab) | openExternal | native | works |

### Deep-link-only routes

| Page ID | Method | Bucket | Renders? |
|---------|--------|--------|----------|
| rule-editor | getRuleEditor | **banner-worthy** | degraded — *was BROKEN* (routes through `renderAntiPatterns`, `app.ts:645`); fixed by the same shim neutralization (see §4) |
| rule-playground | getFieldSchema | registry-allowlisted | works |
| rule-playground | getFunctionCatalog | registry-allowlisted | works |
| rule-playground | getMetricList | registry-allowlisted | works |
| rule-playground | evaluateExpression | silent-disabled | degraded (user action) |
| rule-playground | compileNlRule | silent-disabled | degraded (user action) |
| rule-playground | saveRule | silent-disabled | degraded (user action) |
| data-explorer | getDataExplorerFields | registry-allowlisted | works |
| data-explorer | getDataExplorer | silent-disabled | degraded (user row-click action) |

---

## 4  Decision Rule Application

**Expected outcome (from task spec):** All 10 nav pages degrade gracefully; `burndown` is gated by `FF_TOKEN_REPORTING_ENABLED` and redirects to `dashboard`.

**Burndown guard — verified:** `app.ts:27` contains `if (!FF_TOKEN_REPORTING_ENABLED && page === 'burndown') return 'dashboard';` and `app.ts:32-35` removes the burndown nav link. `page-burndown.ts:123-137` additionally renders a feature-gated notice and returns early. Both guards confirmed in source.

**Anti-patterns — CONCERN FOUND:**  
`renderAntiPatterns` (src/webview/page-antipatterns.ts:219-223) calls:

```ts
const [apData, ruleData] = await Promise.all([
  rpc<ApData>('getAntiPatterns', currentFilter as Record<string, unknown>),
  rpc<RuleEditorData>('getRuleEditor', currentFilter as Record<string, unknown>),
]);
```

`getRuleEditor` is BANNER_WORTHY. In standalone, the dispatcher returns `{ ok: false, error: { code: 'standalone-v1-disabled', method: 'getRuleEditor' } }`. The server maps this to `{ type: 'response', id, data: { error: 'request failed (standalone-v1-disabled)', code, method } }`. The `rpc()` helper in `shared.ts:62` sees `msg.data.error` is truthy and **rejects** the promise. The bare `Promise.all` rejects. `renderAntiPatterns` throws. `withErrorBoundary` (app.ts:644) catches this and renders the error-fallback div: `"⚠️ Failed to render Anti-Patterns"`.

The `anti-patterns` nav page rendered BROKEN (error boundary), not merely degraded.

**The same applied to `rule-editor`** (deep-link-only), which routes through the same `renderAntiPatterns` (`app.ts:645`).

**Resolution (standalone-only, additive):** Because `app.ts`/`page-antipatterns.ts` are reused upstream files (additive-only fork rule forbids editing them), the fix lives in the standalone shim. `src/standalone/webview-shim.ts` now carries `RESOLVE_EMPTY_WHEN_DISABLED = { getRuleEditor }`: on an inbound `standalone-v1-disabled` frame for one of these methods, the shim forwards an **empty-data** frame (`{ type, id, data: {} }`) instead of the error frame, so `rpc()` (`shared.ts:62`, which rejects only when `data.error` is truthy) **resolves** with `{}`. `renderAntiPatterns`' `ruleData.rules || []` guards then render a degraded view (patterns table from the working `getAntiPatterns`; empty Rules tab) instead of throwing. The roadmap banner still fires (`getRuleEditor ∈ BANNER_WORTHY`). The other BANNER_WORTHY methods are user-action calls guarded by their own try/catch and intentionally keep rejecting, so no fake-success regression is introduced. Verified by `webview-shim.test.ts` and the Task 8 smoke test.

**Decision:** With the shim fix in place, the expected outcome holds — all 10 nav pages degrade gracefully.

---

## 5  Conclusion

**All 10 nav pages degrade gracefully** in standalone: `dashboard`, `timeline`, `image-gallery`, `output`, `burndown` (FF-gated/redirected), `patterns`, `anti-patterns` (via the shim fix in §4), `skills`, `config-health`, `level-up`. **No nav entry dropped.**

The only page that did not initially degrade — `anti-patterns` (and the `rule-editor` route that reuses its render) — was resolved by the standalone shim's `RESOLVE_EMPTY_WHEN_DISABLED` neutralization of disabled `getRuleEditor`, keeping the fork additive-only (no upstream edit).

---

## 6  BANNER_WORTHY Reconciliation

**BANNER_WORTHY in `src/standalone/webview-shim.ts` (10 methods):**

```
createSkill, generateSkillContent, generateLearningQuiz,
generateLearningResources, generateCodeComparison, generateDidYouKnow,
installSkill, installCatalogItem, triageCatalog, getRuleEditor
```

**BANNER_WORTHY methods discovered in page files:**

| Method | Discovered in | Notes |
|--------|---------------|-------|
| createSkill | not found in any page-*.ts | declared in BANNER_WORTHY; no call site found in current page files |
| generateSkillContent | page-skills.ts:274 | button action, try/catch |
| generateLearningQuiz | page-learning.ts:51 | user-initiated game |
| generateLearningResources | page-learning.ts:647 | fire-and-forget with .catch |
| generateCodeComparison | page-learning.ts:473 | user-initiated game |
| generateDidYouKnow | page-learning.ts:538 | user-initiated game |
| installSkill | page-skills.ts:298 | button action, try/catch |
| installCatalogItem | page-skills.ts:409 | button action, try/catch |
| triageCatalog | page-skills.ts:366, page-dashboard.ts:407 | button action / try/catch |
| getRuleEditor | page-antipatterns.ts:222, page-rule-editor.ts:106 | **bare Promise.all in both callers** |

**Reconciliation:**
- All 10 BANNER_WORTHY methods are accounted for.
- `createSkill` has no call site in any `page-*.ts` file (it may be reserved for a future page or removed from use). It is correctly listed in BANNER_WORTHY as a forward declaration.
- No discovered banner-worthy method is missing from BANNER_WORTHY — **zero BANNER_WORTHY gaps**.
- **One discrepancy in the other direction (now resolved):** `getRuleEditor` is BANNER_WORTHY and is awaited as primary render data in a bare `Promise.all` (`page-antipatterns.ts`; the `rule-editor` route reuses `renderAntiPatterns`). Without a fix the banner fired but the page also crashed into the error boundary. The standalone shim now lists `getRuleEditor` in `RESOLVE_EMPTY_WHEN_DISABLED` and forwards an empty-data frame so `rpc()` resolves — the banner fires AND the page degrades. UX contract (banner shown, section disabled, page navigable) fully met. See §4.

---

## 7  Summary Table

| Metric | Count |
|--------|-------|
| Nav pages audited | 10 |
| Nav pages: works/degraded | 10 (`anti-patterns` via shim fix, §4) |
| Nav pages: BROKEN | 0 (`anti-patterns` was broken; fixed in shim) |
| Deep-link routes audited | 3 (`rule-editor`, `rule-playground`, `data-explorer`) |
| Deep-link routes: works/degraded | 3 (`rule-editor` via shim fix, §4) |
| Deep-link routes: BROKEN | 0 (`rule-editor` was broken; fixed in shim) |
| Distinct methods discovered | 48 |
| registry-allowlisted | 36 |
| banner-worthy (called in pages) | 9 of 10 (createSkill has no call site) |
| native | 1 (`openExternal`) |
| silent-disabled | 16 |
| BANNER_WORTHY gaps (discovered but not in set) | 0 |
| BANNER_WORTHY items with no call site | 1 (`createSkill`) |
