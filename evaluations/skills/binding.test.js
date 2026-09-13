import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDefaultSkillCatalog } from '../../runtime/core/skills.js';
import { getDefaultAgentCatalog } from '../../runtime/core/agents.js';
import { createSession } from '../../runtime/session.js';

let passed = 0;
let total = 0;

function test(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  \u2714 [${name}] PASS`);
  } catch (err) {
    console.error(`  \u2718 [${name}] FAIL: ${err.message}`);
    throw err;
  }
}

const EXPECTED_SKILLS = [
  'orchestration',
  'backend-engineering',
  'frontend-engineering',
  'database-engineering',
  'qa-testing',
  'code-review',
  'security-devops',
  'architecture',
  'engineering-standards',
  'security-standards'
];

console.log('=== Praetor Skill Binding Suite (SKB-01 .. SKB-03) ===\n');

test('SKB-01: every agent role has its own skill in the catalog', () => {
  const catalog = getDefaultSkillCatalog();
  for (const id of EXPECTED_SKILLS) {
    assert.ok(catalog.has(id), `missing skill: ${id}`);
  }
});

test('SKB-02: agents declare their skills in capabilities', () => {
  const agents = getDefaultAgentCatalog();
  const backend = agents.get('backend-engineer');
  assert.ok(backend, 'backend-engineer must exist');
  assert.ok(backend.capabilities.skills.includes('backend-engineering'), JSON.stringify(backend.capabilities.skills));

  const architect = agents.get('architect');
  assert.ok(architect.capabilities.skills.includes('architecture'), JSON.stringify(architect.capabilities.skills));

  const root = agents.get('orchestrator');
  assert.ok(root.capabilities.skills.includes('orchestration'), JSON.stringify(root.capabilities.skills));
});

test('SKB-03: sessions auto-attach the agent declared skills', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'praetor-skb-'));
  try {
    const agents = getDefaultAgentCatalog();
    const backendDef = agents.get('backend-engineer');
    const session = createSession({
      sessionId: 'skb3',
      agentDefinition: backendDef,
      initialPhase: 'PLAN',
      sessionsRoot: path.join(dir, '.agent', 'sessions')
    });
    const attached = session.getAttachedSkills().map(s => s.id);
    assert.ok(attached.includes('backend-engineering'), JSON.stringify(attached));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`\n============================================================`);
console.log(`Skill Binding Results: ${passed} passed, 0 failed (out of ${total})`);
console.log(`============================================================\n`);
