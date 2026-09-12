import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  SEAL_VERSION,
  SEAL_ALGOS,
  GENESIS_HASH,
  stableStringify,
  resolveStateKey,
  ensureStateKeyFile,
  createSeal,
  verifySeal,
  legacyStateHash,
  eventHash,
  verifyEventChain
} from '../../runtime/core/sealing.js';
import { resolveWithinRoot, isWithinRoot } from '../../runtime/core/paths.js';

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

console.log('=== Praetor Sealing & Path Helpers Suite (SLB-01 .. SLB-12) ===\n');

test('SLB-01: stableStringify is key-order independent', () => {
  const a = stableStringify({ b: 1, a: { d: 2, c: [3, 4] } });
  const b = stableStringify({ a: { c: [3, 4], d: 2 }, b: 1 });
  assert.strictEqual(a, b);
});

test('SLB-02: v1 seal is legacy-compatible sha256', () => {
  const fields = { sessionId: 's1', currentPhase: 'PLAN', iteration: 0, status: 'running', agentId: 'orchestrator' };
  const seal = createSeal({ fields, key: null, version: 1 });
  assert.strictEqual(seal.seal_version, 1);
  assert.strictEqual(seal.seal_algo, SEAL_ALGOS.V1);
  assert.strictEqual(seal.state_hash, legacyStateHash(fields));
  assert.ok(verifySeal({ fields, seal }));
});

test('SLB-03: v2 seal uses HMAC and verifies only with correct key', () => {
  const fields = { sessionId: 's1', currentPhase: 'EXECUTE', iteration: 1, status: 'running', agentId: 'orchestrator', pendingApproval: null };
  const seal = createSeal({ fields, key: 'correct-key', version: SEAL_VERSION });
  assert.strictEqual(seal.seal_version, 2);
  assert.strictEqual(seal.seal_algo, SEAL_ALGOS.V2);
  assert.ok(verifySeal({ fields, seal, key: 'correct-key' }));
  assert.ok(!verifySeal({ fields, seal, key: 'wrong-key' }));
  assert.ok(!verifySeal({ fields, seal, key: null }));
});

test('SLB-04: tampered fields fail verification', () => {
  const fields = { sessionId: 's1', currentPhase: 'PLAN', iteration: 0, status: 'running', agentId: 'orchestrator', pendingApproval: null };
  const seal = createSeal({ fields, key: 'k', version: SEAL_VERSION });
  assert.ok(!verifySeal({ fields: { ...fields, currentPhase: 'EXECUTE' }, seal, key: 'k' }));
});

test('SLB-05: malformed hash is rejected', () => {
  const fields = { sessionId: 's1', currentPhase: 'PLAN', iteration: 0, status: 'running', agentId: 'orchestrator' };
  assert.ok(!verifySeal({ fields, seal: { seal_version: 1, state_hash: 'not-a-hash' } }));
  assert.ok(!verifySeal({ fields, seal: { seal_version: 1, state_hash: null } }));
});

test('SLB-06: valid event chain verifies', () => {
  const events = [];
  let prev = GENESIS_HASH;
  for (let i = 0; i < 3; i++) {
    const base = { event_id: `e${i}`, session_id: 's1', event_type: 'lifecycle.phase_changed', seq: i, prev_hash: prev, phase: 'PLAN' };
    const h = eventHash(base, prev, { key: 'k' });
    const evt = { ...base, event_hash: h };
    events.push(evt);
    prev = h;
  }
  const result = verifyEventChain(events, { key: 'k' });
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.terminalHash, prev);
});

test('SLB-07: content tampering breaks the chain', () => {
  const events = [];
  let prev = GENESIS_HASH;
  for (let i = 0; i < 3; i++) {
    const base = { event_id: `e${i}`, session_id: 's1', event_type: 'tool.completed', seq: i, prev_hash: prev, status: 'ok' };
    const h = eventHash(base, prev, { key: 'k' });
    events.push({ ...base, event_hash: h });
    prev = h;
  }
  events[1].status = 'denied';
  const result = verifyEventChain(events, { key: 'k' });
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.brokenAt, 1);
});

test('SLB-08: deleting or reordering events is detected', () => {
  const events = [];
  let prev = GENESIS_HASH;
  for (let i = 0; i < 4; i++) {
    const base = { event_id: `e${i}`, session_id: 's1', event_type: 'x', seq: i, prev_hash: prev };
    const h = eventHash(base, prev, { key: 'k' });
    events.push({ ...base, event_hash: h });
    prev = h;
  }
  const removed = [events[0], events[1], events[3]];
  assert.strictEqual(verifyEventChain(removed, { key: 'k' }).valid, false);
  const swapped = [events[0], events[2], events[1], events[3]];
  assert.strictEqual(verifyEventChain(swapped, { key: 'k' }).valid, false);
});

test('SLB-09: resolveStateKey precedence and required failure', () => {
  const savedEnv = process.env.PRAETOR_STATE_SECRET;
  const tmpKey = path.join(os.tmpdir(), `praetor-key-${Date.now()}`);
  try {
    delete process.env.PRAETOR_STATE_SECRET;
    assert.strictEqual(resolveStateKey({ key: 'explicit', keyPath: tmpKey }), 'explicit');
    process.env.PRAETOR_STATE_SECRET = 'from-env';
    assert.strictEqual(resolveStateKey({ keyPath: tmpKey }), 'from-env');
    delete process.env.PRAETOR_STATE_SECRET;
    assert.strictEqual(resolveStateKey({ keyPath: tmpKey }), null);
    assert.throws(() => resolveStateKey({ keyPath: tmpKey, required: true }), /STATE_KEY_REQUIRED/);
  } finally {
    if (savedEnv === undefined) delete process.env.PRAETOR_STATE_SECRET;
    else process.env.PRAETOR_STATE_SECRET = savedEnv;
  }
});

test('SLB-10: ensureStateKeyFile is stable and idempotent', () => {
  const tmpKey = path.join(os.tmpdir(), `praetor-keyfile-${Date.now()}`, 'state.key');
  try {
    const first = ensureStateKeyFile(tmpKey);
    const second = ensureStateKeyFile(tmpKey);
    assert.strictEqual(first, second);
    assert.ok(/^[0-9a-f]{64}$/.test(first));
    assert.ok(fs.existsSync(tmpKey));
  } finally {
    fs.rmSync(path.dirname(tmpKey), { recursive: true, force: true });
  }
});

test('SLB-11: resolveWithinRoot denies escapes and sibling prefixes', () => {
  const root = path.join(os.tmpdir(), `praetor-root-${Date.now()}`);
  const sibling = `${root}-evil`;
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(sibling, { recursive: true });
  try {
    assert.strictEqual(resolveWithinRoot(root, 'src/a.js').allowed, true);
    assert.strictEqual(resolveWithinRoot(root, '../outside.txt').allowed, false);
    assert.strictEqual(resolveWithinRoot(root, sibling + '/payload.txt').allowed, false);
    assert.strictEqual(isWithinRoot(root, path.join(sibling, 'x')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(sibling, { recursive: true, force: true });
  }
});

test('SLB-12: symlink escape denied unless allowlisted', () => {
  const root = path.join(os.tmpdir(), `praetor-link-${Date.now()}`);
  const outside = path.join(os.tmpdir(), `praetor-out-${Date.now()}`);
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'x');
  let created = false;
  try {
    fs.symlinkSync(outside, path.join(root, 'link'), 'junction');
    created = true;
  } catch {
    console.log('    (symlink creation not permitted on this platform; skipping)');
  }
  try {
    if (created) {
      assert.strictEqual(resolveWithinRoot(root, 'link/secret.txt').allowed, false);
      assert.strictEqual(
        resolveWithinRoot(root, 'link/secret.txt', { symlinkAllowlist: ['link'] }).allowed,
        true
      );
      assert.strictEqual(resolveWithinRoot(root, 'link/secret.txt', { followSymlinks: true }).allowed, true);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

console.log(`\n============================================================`);
console.log(`Sealing & Path Results: ${passed} passed, 0 failed (out of ${total})`);
console.log(`============================================================\n`);
