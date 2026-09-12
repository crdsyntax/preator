import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventLog } from '../../runtime/core/events.js';
import { verifyChainSegment } from '../../runtime/core/sealing.js';
import { SessionState } from '../../runtime/core/state.js';
import { withLock, acquireLock, releaseLock } from '../../runtime/core/locks.js';

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

console.log('=== Praetor Concurrency & Locking Suite (CON-01 .. CON-03) ===\n');

test('CON-01: interleaved writers keep the event chain linear', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'praetor-con1-'));
  try {
    const a = new EventLog({ sessionId: 'con1', logDir: dir, key: 'con-key' });
    const b = new EventLog({ sessionId: 'con1', logDir: dir, key: 'con-key' });

    for (let i = 0; i < 12; i++) {
      (i % 2 === 0 ? a : b).append('probe.event', { n: i });
    }

    const events = EventLog.readLogFile(path.join(dir, 'events.jsonl'));
    assert.strictEqual(events.length, 12, 'No events may be lost between writers');
    assert.deepStrictEqual(events.map(e => e.seq), Array.from({ length: 12 }, (_, i) => i));

    const chain = verifyChainSegment(events, { key: 'con-key' });
    assert.strictEqual(chain.valid, true, `Chain must remain valid (${chain.reason} at ${chain.brokenAt})`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CON-02: lock contention fails fast with LOCK_TIMEOUT', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'praetor-con2-'));
  const lockPath = path.join(dir, '.lock');
  try {
    acquireLock(lockPath);
    let code = null;
    try {
      withLock(lockPath, () => 'never', { timeoutMs: 120, retryMs: 10 });
    } catch (err) {
      code = err.code;
    }
    assert.strictEqual(code, 'LOCK_TIMEOUT');
  } finally {
    releaseLock(lockPath);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CON-03: state save is atomic and leaves no lock or temp files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'praetor-con3-'));
  try {
    const st = new SessionState({ sessionId: 'con3', currentPhase: 'PLAN', sessionsRoot: dir });
    st.save();

    const sessionDir = path.join(dir, 'con3');
    const files = fs.readdirSync(sessionDir);
    assert.ok(!files.some(f => f.endsWith('.tmp')), 'No temp files may remain');
    assert.ok(!files.includes('.state.lock'), 'Lock must be released');

    const data = JSON.parse(fs.readFileSync(path.join(sessionDir, 'state.json'), 'utf8'));
    assert.strictEqual(data.current_phase, 'PLAN');

    const loaded = SessionState.load('con3', dir);
    assert.strictEqual(loaded.tampered, false, 'Re-sealed atomic write must verify');
    assert.strictEqual(loaded.currentPhase, 'PLAN');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`\n============================================================`);
console.log(`Concurrency Results: ${passed} passed, 0 failed (out of ${total})`);
console.log(`============================================================\n`);
