// src/standalone/v1-service-allowed.ts
// The 12 PanelRequestService methods exposed via the standalone service-bridge tier.
// Learning ×4 + Skill ×4 (incl. generateSkillContent) + Context ×1 (= 9, bucket D) +
// bucket-B writes ×3 (installSkill, installCatalogItem, exportSummary) = 12.
// Still excludes createSkill (opens VS Code chat, not an LLM call) and the bucket-E methods
// (getWorkspaceDeps / getSdlc*) that also live in PanelRequestService but are not allowlisted
// here. See docs-fork/superpowers/spec/2026-05-27-standalone-parity-bucket-d-design.md § C and
// docs-fork/superpowers/spec/2026-05-29-standalone-parity-bucket-b-design.md § C.

const _inner = new Set<string>([
  'generateLearningQuiz', 'generateCodeComparison', 'generateDidYouKnow', 'generateLearningResources',
  'generateSkillContent', 'triageSkills', 'triageCatalog', 'discoverCatalog',
  'reviewContextFiles',
  // Bucket B — service-tier writes. installSkill/installCatalogItem write via the vscode-stub
  // workspace.fs seam; exportSummary delegates to exportSummaryFiles through the same seam.
  'installSkill', 'installCatalogItem', 'exportSummary',
]);

function _throwMutation(): never {
  throw new TypeError('V1_SERVICE_ALLOWED is frozen and cannot be mutated');
}

export const V1_SERVICE_ALLOWED: ReadonlySet<string> = new Proxy(_inner, {
  get(target, prop) {
    if (prop === 'add' || prop === 'delete' || prop === 'clear') {
      return _throwMutation;
    }
    const value = Reflect.get(target, prop, target);
    if (typeof value === 'function') {
      return value.bind(target);
    }
    return value;
  },
});
