import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSession } from '../../runtime/session.js';
import { SessionState } from '../../runtime/core/state.js';

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'praetor-fsmreset-'));
}

function driveToComplete(session) {
  for (const phase of ['ANALYZE', 'PLAN', 'REVIEW', 'EXECUTE', 'VERIFY', 'DOCUMENT', 'COMPLETE']) {
    session.transition(phase);
  }
}

console.log('=== Praetor FSM Reset Suite (RST-01 .. RST-03) ===\n');

test('RST-01: silent COMPLETE -> REQUEST transition is denied', () => {
  const dir = makeDir();
  try {
    const session = createSession({ sessionId: 'rst1', initialPhase: 'REQUEST', sessionsRoot: dir });
    driveToComplete(session);
    assert.strictEqual(session.getPhase(), 'COMPLETE');

    let code = null;
    try {
      session.transition('REQUEST');
    } catch (err) {
      code = err.code;
    }
    assert.strictEqual(code, 'LIFECYCLE_SKIP_DENIED');
    assert.strictEqual(session.getPhase(), 'COMPLETE');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('RST-02: newRun requires a reason and is audited', () => {
  const dir = makeDir();
  try {
    const session = createSession({ sessionId: 'rst2', initialPhase: 'REQUEST', sessionsRoot: dir });
    driveToComplete(session);

    let code = null;
    try {
      session.newRun({ reason: '', actor: 'ops' });
    } catch (err) {
      code = err.code;
    }
    assert.strictEqual(code, 'FSM_RESET_REASON_REQUIRED');
    assert.strictEqual(session.getPhase(), 'COMPLETE');

    const result = session.newRun({ reason: 'New iteration requested by operator', actor: 'ops' });
    assert.strictEqual(result.previous, 'COMPLETE');
    assert.strictEqual(session.getPhase(), 'REQUEST');

    const resetEvent = session.events.list().find(e => e.event_type === 'lifecycle.reset');
    assert.ok(resetEvent, 'Reset must be audited');
    assert.strictEqual(resetEvent.reason, 'New iteration requested by operator');
    assert.strictEqual(resetEvent.actor, 'ops');

    session.state.save();
    const loaded = SessionState.load('rst2', dir);
    assert.strictEqual(loaded.tampered, false, 'Audited reset must remain sealed and consistent');
    assert.strictEqual(loaded.currentPhase, 'REQUEST');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('RST-03: newRun from a non-COMPLETE phase is denied', () => {
  const dir = makeDir();
  try {
    const session = createSession({ sessionId: 'rst3', initialPhase: 'REQUEST', sessionsRoot: dir });
    session.transition('ANALYZE');

    let code = null;
    try {
      session.newRun({ reason: 'premature reset', actor: 'ops' });
    } catch (err) {
      code = err.code;
    }
    assert.strictEqual(code, 'FSM_RESET_NOT_ALLOWED');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`\n============================================================`);
console.log(`FSM Reset Results: ${passed} passed, 0 failed (out of ${total})`);
console.log(`============================================================\n`);
