import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runDoctor } from '../../scripts/doctor.js';
import { AntigravityHostAdapter } from '../../runtime/hosts/antigravity.js';
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'praetor-doc-'));
  fs.writeFileSync(path.join(dir, 'runtime.config.json'), JSON.stringify({ version: '1.0' }, null, 2));
  return dir;
}

console.log('=== Praetor Doctor Hosts Suite (DOC-01 .. DOC-02) ===\n');

test('DOC-01: doctor validates both host integrations as healthy', () => {
  const dir = makeDir();
  try {
    new AntigravityHostAdapter().setup(dir);
    new OpenCodeHostAdapter().setup(dir);

    const report = runDoctor(dir);
    assert.deepStrictEqual(report.hosts.sort(), ['antigravity', 'opencode']);
    assert.deepStrictEqual(report.hostIssues, []);
    assert.strictEqual(report.healthy, true, JSON.stringify(report.checks));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('DOC-02: doctor flags an invalid Antigravity hooks schema', () => {
  const dir = makeDir();
  try {
    new AntigravityHostAdapter().setup(dir);
    fs.writeFileSync(path.join(dir, '.agents', 'hooks.json'), JSON.stringify({
      'other-hook': { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: './other.sh' }] }] }
    }, null, 2));

    const report = runDoctor(dir);
    assert.strictEqual(report.healthy, false);
    assert.ok(report.hostIssues.some(i => i.includes('antigravity')), JSON.stringify(report.hostIssues));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`\n============================================================`);
console.log(`Doctor Hosts Results: ${passed} passed, 0 failed (out of ${total})`);
console.log(`============================================================\n`);
