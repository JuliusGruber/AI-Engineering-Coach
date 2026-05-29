// src/standalone/v1-service-allowed.ts
// The 9 PanelRequestService methods exposed via the standalone service-bridge tier
// (bucket D). Learning ×4 + Skill ×4 (incl. generateSkillContent) + Context ×1.
// Excludes createSkill (opens VS Code chat, not an LLM call) and the bucket-B/E methods
// (installSkill / installCatalogItem / exportSummary / getWorkspaceDeps / getSdlc*) that
// also live in PanelRequestService but are not allowlisted here. See
// docs-fork/superpowers/spec/2026-05-27-standalone-parity-bucket-d-design.md § C.

const _inner = new Set<string>([
  'generateLearningQuiz', 'generateCodeComparison', 'generateDidYouKnow', 'generateLearningResources',
  'generateSkillContent', 'triageSkills', 'triageCatalog', 'discoverCatalog',
  'reviewContextFiles',
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
