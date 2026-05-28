// tests/standalone/fixtures/fake-llm-server.mjs
// Schema-valid canned LLM responses for standalone integration + Playwright smoke (no
// real API key). Routes on a substring of the system prompt (both providers carry it in
// messages[].content). Responses are shaped as Anthropic bodies ({content:[{text}]})
// because the fixtures set ANTHROPIC_API_KEY. Reused in-process by integration tests and
// forked as a sidecar by the Playwright global-setup.
import * as http from 'node:http';
import { pathToFileURL } from 'node:url';

// A rule markdown that parseRule accepts (mirrors core/rule-compiler.ts compileHeuristic
// output for a "short prompts" rule), wrapped in a fenced block as the LLM would emit it.
const RULE_MD = [
  '```markdown',
  '---',
  'id: flag-short-prompts',
  'name: flag short prompts',
  'group: prompt-quality',
  'severity: medium',
  'scope: requests',
  'version: 1',
  'tags: [custom]',
  'thresholds:',
  '  maxLength: 30',
  '  maxRatio: 0.3',
  '  minSample: 5',
  '---',
  '',
  '# Description',
  'flag short prompts',
  '',
  '# Filter',
  'messageLength < {{thresholds.maxLength}} AND messageLength > 0',
  '',
  '# Trigger',
  'ratio > {{thresholds.maxRatio}} AND count > {{thresholds.minSample}}',
  '',
  '# When Triggered',
  '{{count}} of {{total}} items ({{pct}}) match this pattern.',
  '',
  '# How to Improve',
  'Review the flagged items and adjust your workflow accordingly.',
  '',
  '# Examples',
  '"{{messageText | truncate:80}}"',
  '',
  '# Test Cases',
  '- input: { "messageLength": 10 }',
  '  expect: flagged',
  '- input: { "messageLength": 200 }',
  '  expect: clean',
  '```',
].join('\n');

const QUIZ = { items: Array.from({ length: 3 }, (_, i) => ({
  question: `Q${i}: what does this snippet print?`,
  choices: ['a', 'b', 'c', 'd'],
  correctIndex: 0,
  explanation: 'because of evaluation order',
  difficulty: 'easy',
  topic: 'general',
})) };
const CODE_REVIEW = { items: [{ snippetA: 'a()', snippetB: 'b()', betterSnippet: 'A', title: 't', category: 'performance', explanation: 'e', difficulty: 'easy', language: 'ts' }] };
const DID_YOU_KNOW = { items: [{ fact: 'a useful fact', project: 'demo', category: 'api' }] };
const RESOURCES = { items: [{ title: 'Docs', url: 'https://example.com/docs', type: 'Concept', reason: 'relevant' }] };
const TRIAGE = { items: [{ id: 'c1', verdict: 'strong', reason: 'repeated workflow', suggestedSkillName: 'parse-logs' }] };
const CATALOG = { items: [{ id: 'demo-skill', reason: 'matches your repeated packaging workflow' }] };
const CONTEXT = { items: [{ workspaceId: 'demo', overallScore: 70, categoryScores: { clarity: 70 }, findings: [], missingFiles: [], summary: 'ok' }] };

function routeText(prompt) {
  if (prompt.includes('multiple-choice questions')) return JSON.stringify(QUIZ);
  if (prompt.includes('code comparison rounds')) return JSON.stringify(CODE_REVIEW);
  if (prompt.includes('Did you know')) return JSON.stringify(DID_YOU_KNOW);
  if (prompt.includes('learning resource')) return JSON.stringify(RESOURCES);
  if (prompt.includes('repeatable activities')) return JSON.stringify(TRIAGE);
  if (prompt.includes('recommending GitHub Copilot customization')) return JSON.stringify(CATALOG);
  if (prompt.includes('evaluating AI coding assistant context files')) return JSON.stringify(CONTEXT);
  if (prompt.includes('rule compiler')) return RULE_MD;
  if (prompt.includes('SKILL.md')) return '# Demo Skill\n\nGenerated body.';
  return 'ok';
}

export function createFakeLlmServer() {
  return http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let prompt = '';
      try { prompt = JSON.stringify(JSON.parse(body || '{}').messages ?? []); } catch { /* ignore */ }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ content: [{ type: 'text', text: routeText(prompt) }] }));
    });
  });
}

// `node fake-llm-server.mjs [port]` — the Playwright sidecar. Prints the bound URL to stderr.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createFakeLlmServer();
  server.listen(Number(process.argv[2]) || 0, '127.0.0.1', () => {
    const addr = server.address();
    process.stderr.write(`fake-llm running at http://127.0.0.1:${addr.port}\n`);
  });
}
