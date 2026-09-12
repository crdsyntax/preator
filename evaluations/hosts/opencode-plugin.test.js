import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluateOpencodeTool } from '../../runtime/hosts/opencode-plugin-core.js';
import { OpenCodeHostAdapter } from '../../runtime/hosts/opencode.js';

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'praetor-ocplug-'));
}

console.log('=== Praetor OpenCode Plugin Suite (OCP-01 .. OCP-03) ===\n');

test('OCP-01: read is allowed, direct write is denied in the initial phase', () => {
  const dir = makeDir();
  try {
    const read = evaluateOpencodeTool('read', { filePath: 'package.json' }, { cwd: dir, sessionId: 'ocp1' });
    assert.strictEqual(read.decision, 'allow', JSON.stringify(read));

    const write = evaluateOpencodeTool('write', { filePath: 'src/x.js', content: 'x' }, { cwd: dir, sessionId: 'ocp1' });
    assert.strictEqual(write.decision, 'deny', JSON.stringify(write));
    assert.strictEqual(write.code, 'LIFECYCLE_DENIED');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('OCP-02: dangerous shell commands are denied', () => {
  const dir = makeDir();
  try {
    const push = evaluateOpencodeTool('bash', { command: 'git push --force origin main' }, { cwd: dir, sessionId: 'ocp2' });
    assert.strictEqual(push.decision, 'deny', JSON.stringify(push));

    const destructive = evaluateOpencodeTool('bash', { command: 'rm -rf /' }, { cwd: dir, sessionId: 'ocp2' });
    assert.strictEqual(destructive.decision, 'deny', JSON.stringify(destructive));

    const missing = evaluateOpencodeTool('', {}, { cwd: dir, sessionId: 'ocp2' });
    assert.strictEqual(missing.decision, 'deny');
    assert.strictEqual(missing.code, 'INVALID_HOST_INVOCATION');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('OCP-03: setup installs the auto-discovered plugin and verifies', () => {
  const dir = makeDir();
  try {
    const res = new OpenCodeHostAdapter().setup(dir);
    assert.ok(fs.existsSync(res.pluginPath), 'Plugin must be installed');
    const code = fs.readFileSync(res.pluginPath, 'utf8');
    assert.ok(code.includes('tool.execute.before'), 'Plugin must hook tool.execute.before');
    assert.ok(!code.includes('{{PRAETOR_RUNTIME_ROOT}}'), 'Placeholder must be replaced');
    assert.ok(fs.existsSync(res.configPath), 'opencode.json must exist');

    const verified = new OpenCodeHostAdapter().verify(dir);
    assert.strictEqual(verified.success, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`\n============================================================`);
console.log(`OpenCode Plugin Results: ${passed} passed, 0 failed (out of ${total})`);
console.log(`============================================================\n`);
