import { describe, expect, it } from 'vitest';
import { V1_SERVICE_ALLOWED } from '../v1-service-allowed';

describe('V1_SERVICE_ALLOWED', () => {
  it('contains exactly the documented 15 service methods', () => {
    expect(V1_SERVICE_ALLOWED.size).toBe(15);
  });

  it('is frozen / readonly', () => {
    expect(() => {
      (V1_SERVICE_ALLOWED as Set<string>).add('totallyNew');
    }).toThrow();
    expect(V1_SERVICE_ALLOWED.size).toBe(15);
  });

  it('includes the Learning, Skill-triage, and Context methods', () => {
    for (const m of [
      'generateLearningQuiz', 'generateCodeComparison', 'generateDidYouKnow', 'generateLearningResources',
      'generateSkillContent', 'triageSkills', 'triageCatalog', 'discoverCatalog', 'reviewContextFiles',
    ]) {
      expect(V1_SERVICE_ALLOWED.has(m)).toBe(true);
    }
  });

  it('includes the bucket-B service write methods', () => {
    for (const m of ['installSkill', 'installCatalogItem', 'exportSummary']) {
      expect(V1_SERVICE_ALLOWED.has(m)).toBe(true);
    }
  });

  it('excludes createSkill (VS Code chat) and getSdlcGitHubData (needs auth/network)', () => {
    expect(V1_SERVICE_ALLOWED.has('createSkill')).toBe(false);
    expect(V1_SERVICE_ALLOWED.has('getSdlcGitHubData')).toBe(false);
  });

  it('includes the bucket-E local-scan methods', () => {
    for (const m of ['getSdlcToolAnalysis', 'getSdlcRepoScan', 'getWorkspaceDeps']) {
      expect(V1_SERVICE_ALLOWED.has(m)).toBe(true);
    }
  });
});
