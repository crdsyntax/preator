import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSession } from '../../runtime/session.js';
import { defaultTaskExecutor } from '../../runtime/core/executor.js';

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'praetor-cancel-'));
}

console.log('=== Praetor Cancellation & Timeout Suite (CAN-01 .. CAN-03) ===\n');

await test('CAN-01: aborting a session cancels an in-flight tool', async () => {
  const dir = makeDir();
  try {
    const session = createSession({ sessionId: 'can1', initialPhase: 'EXECUTE', sessionsRoot: dir });
    session.registerTool({
      name: 'long_op',
      executor: (args, ctx) => new Promise(resolve => {
        const timer = setTimeout(() => resolve('done'), 3000);
        ctx.signal?.addEventListener('abort', () => clearTimeout(timer), { once: true });
      })
    });

    const inFlight = session.executeTool('long_op', {});
    await new Promise(resolve => setTimeout(resolve, 20));
    session.abort('user cancelled');

    let code = null;
    try {
      await inFlight;
    } catch (err) {
      code = err.code;
    }
    assert.strictEqual(code, 'CANCELLED');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await test('CAN-02: tool timeout aborts execution', async () => {
  const dir = makeDir();
  try {
    const session = createSession({ sessionId: 'can2', initialPhase: 'EXECUTE', sessionsRoot: dir });
    session.registerTool({ name: 'hang', timeoutMs: 60, executor: () => new Promise(() => {}) });

    let code = null;
    try {
      await session.executeTool('hang', {});
    } catch (err) {
      code = err.code;
    }
    assert.strictEqual(code, 'TIMEOUT');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await test('CAN-03: task-level timeout returns cancelled status', async () => {
  const dir = makeDir();
  try {
    const session = createSession({ sessionId: 'can3', initialPhase: 'REQUEST', sessionsRoot: dir });

    const result = await defaultTaskExecutor.execute(session, {
      specialists: ['backend-engineer'],
      timeoutMs: 80,
      childExecutorFn: (child) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          resolve({ specialistId: child.agentId, status: 'completed', inspection: { findings: 'ok' } });
        }, 3000);
        session.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          const err = new Error('TASK_TIMEOUT');
          err.code = 'CANCELLED';
          reject(err);
        }, { once: true });
      })
    });

    assert.strictEqual(result.status, 'cancelled', result.error);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`\n============================================================`);
console.log(`Cancellation Results: ${passed} passed, 0 failed (out of ${total})`);
console.log(`============================================================\n`);
