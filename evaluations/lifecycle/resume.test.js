import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PersistentTaskStore } from '../../protocol/store.js';
import { createTask, executeTask, approveTask } from '../../protocol/task.js';

let passed = 0;
let total = 0;

async function test(name, fn) {
  total++;
  try {
    await fn();
    passed++;
    console.log(`  \u2714 [${name}] PASS`);
  } catch (err) {
    console.error(`  \u2718 [${name}] FAIL: ${err.message}`);
    throw err;
  }
}

function makeDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'praetor-resume-'));
}

console.log('=== Praetor Resume & Rehydration Suite (RES-01 .. RES-03) ===\n');

await test('RES-01: a task resumes in a new process from its persisted phase', async () => {
  const dir = makeDir();
  try {
    const store1 = new PersistentTaskStore(dir);
    const task = createTask({ goal: 'optimizar frontend y base de datos' }, store1);
    const record1 = store1.get(task.taskId);
    record1.session.transition('ANALYZE');
    record1.session.transition('PLAN');
    record1.session.transition('REVIEW');
    record1.session.state.save();
    store1.set(task.taskId, record1);

    const store2 = new PersistentTaskStore(dir);
    const pre = store2.get(task.taskId);
    assert.strictEqual(pre.phase, 'REVIEW', 'Store must reconstruct the persisted phase');

    const res = await executeTask(task.taskId, {}, store2);
    assert.strictEqual(res.status, 'completed', res.error);
    assert.strictEqual(res.phase, 'COMPLETE');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await test('RES-02: resume pauses on pending approval and completes after approval', async () => {
  const dir = makeDir();
  try {
    const store1 = new PersistentTaskStore(dir);
    const task = createTask({ goal: 'desplegar backend seguro' }, store1);
    const record1 = store1.get(task.taskId);
    record1.session.transition('ANALYZE');
    record1.session.transition('PLAN');
    record1.session.transition('REVIEW');
    record1.session.requestApproval('deploy', 'Deploy requires human approval');
    record1.session.state.save();
    store1.set(task.taskId, record1);

    const store2 = new PersistentTaskStore(dir);
    const pending = await executeTask(task.taskId, {}, store2);
    assert.strictEqual(pending.status, 'pending_approval', 'Execution must pause on pending approval');
    assert.ok(pending.approvalId, 'Pending approval id must be surfaced');

    const approval = await approveTask(task.taskId, null, { approved: true, resolvedBy: 'tester', reason: 'go' }, store2);
    assert.ok(approval.approvedId, 'Approval must be resolved');

    const done = await executeTask(task.taskId, {}, store2);
    assert.strictEqual(done.status, 'completed', done.error);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await test('RES-03: a tampered state aborts resume before any transition', async () => {
  const dir = makeDir();
  try {
    const store1 = new PersistentTaskStore(dir);
    const task = createTask({ goal: 'tarea comprometida' }, store1);

    const stateFile = path.join(dir, '.agent', 'sessions', task.taskId, 'state.json');
    const raw = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    raw.current_phase = 'COMPLETE';
    fs.writeFileSync(stateFile, JSON.stringify(raw, null, 2));

    const store2 = new PersistentTaskStore(dir);
    const res = await executeTask(task.taskId, {}, store2);
    assert.strictEqual(res.status, 'failed');
    assert.match(res.error, /TAMPERED/);
    assert.notStrictEqual(res.phase, 'COMPLETE', 'Tampered resume must not reach COMPLETE');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`\n============================================================`);
console.log(`Resume Results: ${passed} passed, 0 failed (out of ${total})`);
console.log(`============================================================\n`);
