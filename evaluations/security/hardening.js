import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createSession, VERSION } from '../../runtime/index.js';
import { ExecutionGateway } from '../../runtime/core/gateway.js';
import { ToolRegistry } from '../../runtime/core/registry.js';
import { PolicyEngine } from '../../runtime/core/policy.js';
import { LifecycleMachine } from '../../runtime/core/lifecycle.js';
import { createToolRequest, createToolResult, TOOL_STATUS } from '../../runtime/core/contracts.js';
import { SessionState } from '../../runtime/core/state.js';
import { AntigravityHostAdapter } from '../../runtime/hosts/antigravity.js';
import { HostDriver } from '../../runtime/hosts/driver.js';
import { createHostToolInvocation } from '../../runtime/hosts/contracts.js';

console.log(`=== Praetor Security Hardening Suite (v${VERSION}) (HRD-01 .. HRD-06) ===\n`);

let passed = 0;
let total = 0;

function test(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  ✔ [${name}] PASS`);
  } catch (err) {
    console.error(`  ✘ [${name}] FAIL: ${err.message}`);
    throw err;
  }
}

async function asyncTest(name, fn) {
  total++;
  try {
    await fn();
    passed++;
    console.log(`  ✔ [${name}] PASS`);
  } catch (err) {
    console.error(`  ✘ [${name}] FAIL: ${err.message}`);
    throw err;
  }
}

await asyncTest('HRD-01: Anti-TOCTOU Argument Tampering Denied', async () => {
  const driver = new HostDriver();
  const session = createSession({ sessionId: 'toctou-session', initialPhase: 'EXECUTE' });

  const benignInvocation = createHostToolInvocation({
    host: 'antigravity',
    toolName: 'write_to_file',
    args: { TargetFile: 'src/main.rs', CodeContent: 'fn main() {}' }
  });
  const decision = driver.evaluateInvocation(benignInvocation, session);
  assert.strictEqual(decision.decision, 'allow', 'Benign write must be authorized');
  assert.ok(decision.canonical_hash, 'Decision must contain canonical_hash');

  const registry = new ToolRegistry();
  registry.register({
    name: 'write_to_file',
    isWrite: true,
    executor: () => ({ success: true })
  });

  const gateway = new ExecutionGateway({
    registry,
    lifecycle: session.lifecycle,
    policy: session.policy
  });

  const tamperedRequest = createToolRequest({
    runId: 'run-toctou',
    toolName: 'write_to_file',
    phase: 'EXECUTE',
    args: { TargetFile: 'src/main.rs', CodeContent: 'MALICIOUS EXPLOIT INJECTION' }
  });

  const result = await gateway.execute(tamperedRequest, session.state, {
    hostDecision: decision
  });

  assert.strictEqual(result.status, TOOL_STATUS.DENIED, 'Tampered execution must be denied');
  assert.strictEqual(result.error.code, 'TOCTOU_MISMATCH_DENIED', 'Reason must be TOCTOU_MISMATCH_DENIED');
});

test('HRD-02: Tampered state.json on disk fails closed to REQUEST', () => {
  const tempSessionsDir = path.join(process.cwd(), '.agent', 'test-tamper-sessions');
  const sessionId = 'tampered-session-001';
  const sessionDir = path.join(tempSessionsDir, sessionId);

  fs.rmSync(sessionDir, { recursive: true, force: true });
  fs.mkdirSync(sessionDir, { recursive: true });

  const legitimateState = new SessionState({
    sessionId,
    currentPhase: 'PLAN',
    iteration: 2,
    sessionsRoot: tempSessionsDir
  });
  legitimateState.save();

  const rawState = JSON.parse(fs.readFileSync(legitimateState.filePath, 'utf8'));
  rawState.current_phase = 'EXECUTE';
  fs.writeFileSync(legitimateState.filePath, JSON.stringify(rawState, null, 2), 'utf8');

  const loadedState = SessionState.load(sessionId, tempSessionsDir);
  assert.strictEqual(loadedState.tampered, true, 'State must be flagged as tampered');
  assert.strictEqual(loadedState.currentPhase, 'REQUEST', 'Tampered state must fail-closed reset to REQUEST');

  fs.rmSync(tempSessionsDir, { recursive: true, force: true });
});

test('HRD-03: PowerShell backtick evasion is de-obfuscated and blocked', () => {
  const policy = new PolicyEngine();

  const obfuscatedCmd = 'g`it p`ush ` --force';
  const decision = policy.canExecute(
    { tool: 'run_command', args: { CommandLine: obfuscatedCmd } },
    { current_phase: 'EXECUTE' }
  );

  assert.strictEqual(decision.allowed, false, 'Obfuscated force push must be blocked');
  assert.strictEqual(decision.policy, 'P1_FORCE_PUSH_DENIED', 'Must match P1_FORCE_PUSH_DENIED');
});

test('HRD-04: PowerShell Base64 encoded destructive command is decoded and denied', () => {
  const policy = new PolicyEngine();

  const utf16Buf = Buffer.from('rm -rf /', 'utf16le');
  const b64 = utf16Buf.toString('base64');
  const encodedCmd = `powershell.exe -EncodedCommand ${b64}`;

  const decision = policy.canExecute(
    { tool: 'run_command', args: { CommandLine: encodedCmd } },
    { current_phase: 'EXECUTE' }
  );

  assert.strictEqual(decision.allowed, false, 'Base64 destructive command must be blocked');
  assert.strictEqual(decision.policy, 'P1_DESTRUCTIVE_COMMAND_DENIED', 'Must match P1_DESTRUCTIVE_COMMAND_DENIED');
});

test('HRD-05: Inline shell write (Set-Content) in PLAN phase is blocked', () => {
  const policy = new PolicyEngine();

  const inlineWriteCmd = 'Set-Content -Path malicious.js -Value "console.log(1)"';
  const decision = policy.canExecute(
    { tool: 'run_command', args: { CommandLine: inlineWriteCmd } },
    { current_phase: 'PLAN' }
  );

  assert.strictEqual(decision.allowed, false, 'Inline shell write in PLAN must be blocked');
  assert.strictEqual(decision.policy, 'P6_LIFECYCLE_WRITE_VIOLATION', 'Must match P6_LIFECYCLE_WRITE_VIOLATION');
});

test('HRD-06: Host Hook fails closed on corrupt/missing input', () => {

  assert.throws(
    () => AntigravityHostAdapter.parseHookInput('{ "invalid_json": '),
    /Failed to parse Antigravity hook stdin JSON/,
    'Corrupted JSON must throw parsing error'
  );

  const driver = new HostDriver();
  const session = createSession({ sessionId: 'hook-session' });
  const decision = driver.evaluateInvocation({}, session);

  assert.strictEqual(decision.decision, 'deny', 'Empty host invocation must be denied');
  assert.strictEqual(decision.code, 'INVALID_HOST_INVOCATION', 'Code must be INVALID_HOST_INVOCATION');
});

console.log(`\n============================================================`);
console.log(`Hardening Results: ${passed} passed, 0 failed (out of ${total})`);
console.log(`============================================================\n`);
