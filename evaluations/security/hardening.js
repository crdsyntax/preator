import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
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

console.log(`=== Praetor Security Hardening Suite (v${VERSION}) (HRD-01 .. HRD-13) ===\n`);

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

test('HRD-12: Symlink path escape and config hardening', () => {
  const root = path.join(os.tmpdir(), `praetor-hrd12-${Date.now()}`);
  const outside = path.join(os.tmpdir(), `praetor-hrd12-out-${Date.now()}`);
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'payload.txt'), 'x');

  let symlinkCreated = false;
  try {
    fs.symlinkSync(outside, path.join(root, 'link'), 'junction');
    symlinkCreated = true;
  } catch {
    console.log('    (symlink creation not permitted on this platform; lexical checks still enforced)');
  }

  try {
    const policy = new PolicyEngine({ projectConfig: { version: '1.0' }, rootDir: root });

    const siblingEscape = policy.canExecute(
      { tool: 'write', args: { path: `${root}-evil/payload.txt` } },
      { current_phase: 'EXECUTE' }
    );
    assert.strictEqual(siblingEscape.allowed, false, 'Sibling prefix escape must be denied');
    assert.strictEqual(siblingEscape.policy, 'P2_PATH_TRAVERSAL_DENIED');

    if (symlinkCreated) {
      const linkEscape = policy.canExecute(
        { tool: 'read', args: { path: 'link/payload.txt' } },
        { current_phase: 'EXECUTE' }
      );
      assert.strictEqual(linkEscape.allowed, false, 'Symlink escape must be denied');

      const allowlisted = new PolicyEngine({
        projectConfig: { version: '1.0', workspace: { symlink_allowlist: ['link'] } },
        rootDir: root
      });
      const linkAllowed = allowlisted.canExecute(
        { tool: 'read', args: { path: 'link/payload.txt' } },
        { current_phase: 'EXECUTE' }
      );
      assert.strictEqual(linkAllowed.allowed, true, 'Sanctioned symlink must be allowed');
    }

    const badFollow = new PolicyEngine({ projectConfig: { version: '1.0', workspace: { follow_symlinks: 'yes' } } });
    assert.strictEqual(badFollow.configValidation.valid, false, 'Non-boolean follow_symlinks must fail closed');

    const badAllowlist = new PolicyEngine({ projectConfig: { version: '1.0', workspace: { symlink_allowlist: 'link' } } });
    assert.strictEqual(badAllowlist.configValidation.valid, false, 'Non-array symlink_allowlist must fail closed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

function withStateKey(key, fn) {
  const saved = process.env.PRAETOR_STATE_SECRET;
  process.env.PRAETOR_STATE_SECRET = key;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env.PRAETOR_STATE_SECRET;
    else process.env.PRAETOR_STATE_SECRET = saved;
  }
}

test('HRD-07: Missing seal or v2 seal without key fails closed', () => {
  const dir = path.join(process.cwd(), '.agent', 'test-hrd07');
  const sessionId = 'hrd07-s1';
  fs.rmSync(dir, { recursive: true, force: true });
  try {
    withStateKey('hrd07-key', () => {
      const st = new SessionState({ sessionId, currentPhase: 'PLAN', sessionsRoot: dir });
      st.save();
      const file = path.join(dir, sessionId, 'state.json');
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      assert.strictEqual(raw.seal_version, 2, 'Key present must produce a v2 seal');

      raw.state_hash = null;
      fs.writeFileSync(file, JSON.stringify(raw, null, 2));
      const missing = SessionState.load(sessionId, dir);
      assert.strictEqual(missing.tampered, true);
      assert.strictEqual(missing.currentPhase, 'REQUEST');
    });

    const restored = new SessionState({ sessionId, currentPhase: 'PLAN', sessionsRoot: dir, sealKey: 'hrd07-key' });
    restored.save();
    delete process.env.PRAETOR_STATE_SECRET;
    const noKey = SessionState.load(sessionId, dir, { key: null });
    assert.strictEqual(noKey.tampered, true, 'v2 seal without a key must fail closed');
  } finally {
    delete process.env.PRAETOR_STATE_SECRET;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('HRD-09b: Bound fields (goal/context) tampering is detected', () => {
  const dir = path.join(process.cwd(), '.agent', 'test-hrd09b');
  const sessionId = 'hrd09b-s1';
  fs.rmSync(dir, { recursive: true, force: true });
  try {
    withStateKey('hrd09b-key', () => {
      const st = new SessionState({
        sessionId,
        goal: 'legitimate goal',
        context: { workspaceRoot: process.cwd() },
        currentPhase: 'EXECUTE',
        sessionsRoot: dir
      });
      st.save();
      const file = path.join(dir, sessionId, 'state.json');
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      raw.goal = 'injected goal';
      raw.context = { workspaceRoot: '/etc' };
      fs.writeFileSync(file, JSON.stringify(raw, null, 2));
      const loaded = SessionState.load(sessionId, dir);
      assert.strictEqual(loaded.tampered, true, 'Tampered goal/context must be detected');
    });
  } finally {
    delete process.env.PRAETOR_STATE_SECRET;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('HRD-13: Legitimate session round-trip is not flagged tampered', () => {
  const dir = path.join(process.cwd(), '.agent', 'test-hrd13');
  const sessionId = 'hrd13-s1';
  fs.rmSync(dir, { recursive: true, force: true });
  try {
    withStateKey('hrd13-key', () => {
      const session = createSession({ sessionId, initialPhase: 'REQUEST', sessionsRoot: dir });
      session.transition('ANALYZE');
      session.transition('PLAN');
      session.state.save();

      const loaded = SessionState.load(sessionId, dir);
      assert.strictEqual(loaded.tampered, false, 'A legitimate sealed session must not be flagged');
      assert.strictEqual(loaded.currentPhase, 'PLAN');
    });
  } finally {
    delete process.env.PRAETOR_STATE_SECRET;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('HRD-08: Deleted or reordered events break the hash chain', () => {
  const dir = path.join(process.cwd(), '.agent', 'test-hrd08');
  const sessionId = 'hrd08-s1';
  fs.rmSync(dir, { recursive: true, force: true });
  try {
    withStateKey('hrd08-key', () => {
      const session = createSession({ sessionId, initialPhase: 'REQUEST', sessionsRoot: dir });
      session.transition('ANALYZE');
      session.transition('PLAN');
      session.state.save();

      const file = path.join(dir, sessionId, 'events.jsonl');
      const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
      assert.ok(lines.length >= 3, 'Expected at least three chained events');

      fs.writeFileSync(file, [lines[0], ...lines.slice(2)].join('\n') + '\n');
      assert.strictEqual(
        SessionState.load(sessionId, dir).tampered,
        true,
        'A deleted event must break the chain and fail closed'
      );
    });
  } finally {
    delete process.env.PRAETOR_STATE_SECRET;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await asyncTest('HRD-10: Approval cannot be self-granted via context/args', async () => {
  const session = createSession({ sessionId: 'appr-self-' + Date.now(), initialPhase: 'EXECUTE' });
  session.registry.register({ name: 'dangerous_op', requiresApproval: true, executor: () => 'RAN' });
  const gateway = new ExecutionGateway({
    registry: session.registry,
    lifecycle: session.lifecycle,
    policy: session.policy,
    approvals: session.approvals,
    events: session.events
  });

  const req = createToolRequest({
    requestId: 'req-self',
    runId: 'run-self',
    toolName: 'dangerous_op',
    phase: 'EXECUTE',
    args: { hasApproval: true },
    riskLevel: 'HIGH'
  });

  const res = await gateway.execute(req, session.state.toJSON(), { hasApproval: true });
  assert.strictEqual(res.status, TOOL_STATUS.DENIED, 'Self-approval must be denied');
  assert.strictEqual(res.error.code, 'APPROVAL_REQUIRED');
});

await asyncTest('HRD-11: Approval grants are action-bound and single-use', async () => {
  const session = createSession({ sessionId: 'appr-bind-' + Date.now(), initialPhase: 'EXECUTE' });
  let runs = 0;
  session.registry.register({ name: 'dangerous_op', requiresApproval: true, executor: () => { runs++; return 'RAN'; } });
  const gateway = new ExecutionGateway({
    registry: session.registry,
    lifecycle: session.lifecycle,
    policy: session.policy,
    approvals: session.approvals,
    events: session.events
  });

  const mk = (requestId, op) => createToolRequest({
    requestId,
    runId: 'run-bind',
    toolName: 'dangerous_op',
    phase: 'EXECUTE',
    args: { op },
    riskLevel: 'HIGH'
  });
  const state = () => session.state.toJSON();

  const denied = await gateway.execute(mk('req-a', 'alpha'), state(), {});
  assert.strictEqual(denied.status, TOOL_STATUS.DENIED);
  assert.strictEqual(denied.error.code, 'APPROVAL_REQUIRED');

  session.decideApproval(session.state.pendingApproval, true, 'approved alpha', 'human');

  const wrongTarget = await gateway.execute(mk('req-b', 'beta'), state(), {});
  assert.strictEqual(wrongTarget.status, TOOL_STATUS.DENIED, 'Grant must be bound to request_id and canonical hash');

  const ok = await gateway.execute(mk('req-a', 'alpha'), state(), {});
  assert.strictEqual(ok.status, TOOL_STATUS.OK, 'Bound and approved request must execute');
  assert.strictEqual(runs, 1);

  const replay = await gateway.execute(mk('req-a', 'alpha'), state(), {});
  assert.strictEqual(replay.status, TOOL_STATUS.DENIED, 'Grant must be single-use');
  assert.strictEqual(runs, 1, 'Tool must not run twice from one grant');
});

console.log(`\n============================================================`);
console.log(`Hardening Results: ${passed} passed, 0 failed (out of ${total})`);
console.log(`============================================================\n`);
