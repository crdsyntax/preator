import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSession } from '../../runtime/session.js';
import { verifySession } from '../../scripts/audit-session.js';

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

function makeDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'praetor-audit-'));
}

function sessionsRoot(dir) {
  return path.join(dir, '.agent', 'sessions');
}

console.log('=== Praetor Audit Verify Suite (AUD-01 .. AUD-03) ===\n');

test('AUD-01: a healthy session verifies clean', () => {
  const dir = makeDir();
  try {
    const session = createSession({ sessionId: 'aud1', initialPhase: 'REQUEST', sessionsRoot: sessionsRoot(dir) });
    session.transition('ANALYZE');
    session.transition('PLAN');
    session.state.save();

    const report = verifySession('aud1', { targetDir: dir });
    assert.strictEqual(report.found, true);
    assert.strictEqual(report.valid, true, JSON.stringify(report));
    assert.strictEqual(report.chain.valid, true);
    assert.strictEqual(report.trace.matches, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('AUD-02: a tampered state fails verification', () => {
  const dir = makeDir();
  try {
    const session = createSession({ sessionId: 'aud2', initialPhase: 'REQUEST', sessionsRoot: sessionsRoot(dir) });
    session.transition('ANALYZE');
    session.state.save();

    const stateFile = path.join(sessionsRoot(dir), 'aud2', 'state.json');
    const raw = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    raw.current_phase = 'EXECUTE';
    fs.writeFileSync(stateFile, JSON.stringify(raw, null, 2));

    const report = verifySession('aud2', { targetDir: dir });
    assert.strictEqual(report.valid, false);
    assert.strictEqual(report.seal.valid, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('AUD-03: a deleted event breaks the chain', () => {
  const dir = makeDir();
  try {
    const session = createSession({ sessionId: 'aud3', initialPhase: 'REQUEST', sessionsRoot: sessionsRoot(dir) });
    session.transition('ANALYZE');
    session.transition('PLAN');
    session.state.save();

    const eventsFile = path.join(sessionsRoot(dir), 'aud3', 'events.jsonl');
    const lines = fs.readFileSync(eventsFile, 'utf8').trim().split('\n');
    fs.writeFileSync(eventsFile, [lines[0], ...lines.slice(2)].join('\n') + '\n');

    const report = verifySession('aud3', { targetDir: dir });
    assert.strictEqual(report.valid, false);
    assert.strictEqual(report.chain.valid, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`\n============================================================`);
console.log(`Audit Verify Results: ${passed} passed, 0 failed (out of ${total})`);
console.log(`============================================================\n`);
