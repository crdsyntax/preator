import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionState } from '../../runtime/core/state.js';
import { runMigrate } from '../../scripts/migrate-runtime.js';
import { runDoctor } from '../../scripts/doctor.js';

const KEY = 'migration-test-key';
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

function makeTarget() {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'praetor-migrate-'));
  fs.writeFileSync(
    path.join(target, 'runtime.config.json'),
    JSON.stringify({ version: '1.0', workspace: { boundaries: { allowed: ['src'], denied: [] } } }, null, 2)
  );
  return target;
}

function writeLegacySession(target, sessionId, phase = 'PLAN') {
  const state = new SessionState({
    sessionId,
    currentPhase: phase,
    sessionsRoot: path.join(target, '.agent', 'sessions'),
    sealKey: null
  });
  state.save();
  return path.join(target, '.agent', 'sessions', sessionId, 'state.json');
}

console.log('=== Praetor Migration & Doctor Suite (MIG-01 .. MIG-05) ===\n');

test('MIG-01: legacy v1 session is re-sealed to v2', () => {
  const target = makeTarget();
  try {
    writeLegacySession(target, 'legacy-ok');
    const summary = runMigrate(target, { key: KEY });
    assert.strictEqual(summary.resealed, 1);
    assert.strictEqual(summary.quarantined, 0);

    const reloaded = SessionState.load('legacy-ok', path.join(target, '.agent', 'sessions'), { key: KEY });
    assert.strictEqual(reloaded.tampered, false);
    assert.strictEqual(reloaded.sealVersion, 2);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('MIG-02: tampered legacy session is quarantined', () => {
  const target = makeTarget();
  try {
    const file = writeLegacySession(target, 'legacy-bad');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    raw.current_phase = 'EXECUTE';
    fs.writeFileSync(file, JSON.stringify(raw, null, 2));

    const summary = runMigrate(target, { key: KEY });
    assert.strictEqual(summary.quarantined, 1);
    assert.ok(summary.quarantinedSessions.includes('legacy-bad'));
    assert.ok(!fs.existsSync(path.join(target, '.agent', 'sessions', 'legacy-bad')));
    assert.ok(fs.existsSync(path.join(target, '.agent', 'quarantine', 'legacy-bad', 'state.json')));
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('MIG-03: migration is idempotent', () => {
  const target = makeTarget();
  try {
    writeLegacySession(target, 'legacy-idem');
    const first = runMigrate(target, { key: KEY });
    assert.strictEqual(first.resealed, 1);

    const second = runMigrate(target, { key: KEY });
    assert.strictEqual(second.resealed, 0);
    assert.strictEqual(second.alreadySealed, 1);
    assert.strictEqual(second.quarantined, 0);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('MIG-04: dry-run reports without modifying state', () => {
  const target = makeTarget();
  try {
    const file = writeLegacySession(target, 'legacy-dry');
    const before = fs.readFileSync(file, 'utf8');
    const summary = runMigrate(target, { dryRun: true, key: KEY });
    assert.strictEqual(summary.resealed, 1);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), before, 'Dry-run must not modify state.json');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('MIG-05: doctor is healthy after migration and detects tampering', () => {
  const target = makeTarget();
  try {
    writeLegacySession(target, 'doc-ok');
    runMigrate(target, { key: KEY });

    const healthy = runDoctor(target, { key: KEY });
    assert.strictEqual(healthy.healthy, true, JSON.stringify(healthy.checks));

    const file = path.join(target, '.agent', 'sessions', 'doc-ok', 'state.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    raw.status = 'completed';
    fs.writeFileSync(file, JSON.stringify(raw, null, 2));

    const unhealthy = runDoctor(target, { key: KEY });
    assert.strictEqual(unhealthy.healthy, false, 'Doctor must flag an invalid seal');
    assert.ok(unhealthy.sessions.invalid >= 1);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

console.log(`\n============================================================`);
console.log(`Migration & Doctor Results: ${passed} passed, 0 failed (out of ${total})`);
console.log(`============================================================\n`);
