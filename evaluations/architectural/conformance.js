import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AgentSession,
  createSession,
  core,
  hosts,
  providers
} from "../../runtime/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../");

let checksPassed = 0;
let checksFailed = 0;

function assert(condition, message, id) {
  if (condition) {
    checksPassed++;
    console.log(`  \x1b[32m✔ [${id}] ${message}\x1b[0m`);
  } else {
    checksFailed++;
    console.error(`  \x1b[31m✘ [${id}] ${message}\x1b[0m`);
  }
}

async function runConformanceChecks() {
  console.log("\x1b[1m\x1b[36m=== Architectural Conformance Gate (ARCH-01 .. ARCH-10) ===\x1b[0m\n");

  console.log("Testing ARCH-01: Core Dependency Isolation...");
  const coreDir = path.join(projectRoot, "runtime/core");
  const coreFiles = fs.readdirSync(coreDir).filter(f => f.endsWith(".js"));

  let forbiddenImportsFound = false;
  for (const file of coreFiles) {
    const content = fs.readFileSync(path.join(coreDir, file), "utf8");
    const importLines = content.split("\n").filter(l => l.trim().startsWith("import ") || l.trim().startsWith("from "));

    for (const line of importLines) {
      if (/(\.\.\/hosts|\.\.\/providers|\.\.\/evaluation|toketeo|tauri|mariadb)/i.test(line)) {
        forbiddenImportsFound = true;
        console.error(`    Forbidden import in ${file}: ${line.trim()}`);
      }
    }
  }
  assert(!forbiddenImportsFound, "runtime/core has zero imports from hosts, providers, evaluation, or frameworks", "ARCH-01");

  console.log("\nTesting ARCH-02: Host Adapter Normalization & Transport Only...");
  const hostDriver = new hosts.HostDriver();
  const testSession = createSession({
    initialPhase: 'PLAN',
    agentDefinition: {
      identity: { id: 'specialist', role: 'specialist', type: 'subagent' },
      capabilities: { tools: ['read', 'write'], can_delegate: false, delegation_targets: [] }
    }
  });

  const writeInvocation = hosts.createHostToolInvocation({
    host: 'antigravity',
    toolName: 'write_to_file',
    args: { TargetFile: 'test.txt', CodeContent: 'hello' }
  });

  const hostDecision = hostDriver.evaluateInvocation(writeInvocation, testSession);
  assert(hostDecision.decision === 'deny', "HostDriver denies write tool in PLAN phase via Policy delegation", "ARCH-02.1");
  assert(hostDecision.code === 'P6_LIFECYCLE_WRITE_VIOLATION' || hostDecision.code === 'LIFECYCLE_DENIED', "Denial is tagged with Hard Policy P6 / LIFECYCLE_DENIED code", "ARCH-02.2");

  console.log("\nTesting ARCH-03: Provider Adapter Suggestion Boundary...");
  const executeSession = createSession({
    initialPhase: 'EXECUTE',
    agentDefinition: {
      identity: { id: 'dev', role: 'specialist', type: 'subagent' },
      capabilities: { tools: ['run_command', 'bash'], can_delegate: false, delegation_targets: [] }
    }
  });
  executeSession.registerTool({
    name: 'run_command',
    executor: async (args) => `executed: ${args.cmd}`
  });

  const mockProvider = new providers.PilotProviderAdapter({
    plan: [
      {
        turnType: providers.TURN_TYPES.TOOL_CALLS,
        toolCalls: [{ name: 'run_command', args: { cmd: 'git push --force origin main' } }]
      }
    ]
  });

  const providerDriver = new providers.ProviderDriver({
    adapter: mockProvider,
    session: executeSession,
    maxTurns: 1
  });

  const stepResult = await providerDriver.step();
  assert(stepResult.executionResults[0].status === 'DENIED', "Model-suggested force push is blocked by Gateway", "ARCH-03.1");
  assert(stepResult.executionResults[0].error.code === 'P1_FORCE_PUSH_DENIED', "Blocked with P1_FORCE_PUSH_DENIED", "ARCH-03.2");

  console.log("\nTesting ARCH-04: Dual-Layer Policy Fail-Closed...");
  const brokenPolicy = new core.PolicyEngine({
    projectConfig: { version: 'invalid-version', policy: {} }
  });

  const checkFailClosed = brokenPolicy.canExecute({ tool: 'run_command', args: { cmd: 'cargo build' } }, { current_phase: 'EXECUTE' });
  assert(!checkFailClosed.allowed, "Corrupted config fails closed on execution tools", "ARCH-04.1");
  assert(checkFailClosed.policy === 'CFG_FAIL_CLOSED_DENIED', "Reason code is CFG_FAIL_CLOSED_DENIED", "ARCH-04.2");

  console.log("\nTesting ARCH-05: Skill Capability Non-Elevation...");
  const limitedAgentSession = createSession({
    agentId: 'reader',
    agentDefinition: {
      identity: { id: 'reader', role: 'specialist', type: 'subagent' },
      capabilities: { tools: ['read'], can_delegate: false, delegation_targets: [] }
    }
  });

  let elevationBlocked = false;
  try {
    limitedAgentSession.attachSkill({
      id: 'elevating-skill',
      name: 'Elevating Skill',
      target_agents: ['reader'],
      required_tools: ['write', 'run_command'],
      instructions: 'Write arbitrary files'
    });
  } catch (err) {
    if (err.code === 'SKILL_TOOL_UNAUTHORIZED') {
      elevationBlocked = true;
    }
  }
  assert(elevationBlocked, "Skill requiring undeclared tools is rejected with SKILL_TOOL_UNAUTHORIZED", "ARCH-05");

  console.log("\nTesting ARCH-06: Context Governance Boundary...");
  const contextGov = new core.ContextGovernance({ rootDir: projectRoot });
  const traversalCheck = contextGov.isAccessAllowed("../../etc/passwd");
  assert(!traversalCheck.allowed && traversalCheck.reason === 'PATH_TRAVERSAL_DENIED', "Path traversal escaping workspace root is denied", "ARCH-06.1");

  const secretCheck = contextGov.isAccessAllowed(".env");
  assert(!secretCheck.allowed && secretCheck.reason === 'CONTEXT_ACCESS_DENIED', "Access to sensitive .env pattern is denied", "ARCH-06.2");

  console.log("\nTesting ARCH-07: Delegation Tree Topology...");
  const orch = new core.OrchestratorEngine({ maxDepth: 3 });
  orch.registerAgent({ identity: { id: 'orchestrator', role: 'root' } });
  orch.registerAgent({ identity: { id: 'backend', role: 'specialist' } });
  orch.registerAgent({ identity: { id: 'qa', role: 'specialist' } });

  const rootDelegation = orch.canDelegate(core.createDelegationRequest({
    parentRunId: 'run-root',
    parentAgentId: 'orchestrator',
    childAgentId: 'backend',
    task: 'Implement database schema',
    depth: 1
  }));
  assert(rootDelegation.allowed, "Root orchestrator is authorized to delegate to specialist", "ARCH-07.1");

  const specialistDelegation = orch.canDelegate(core.createDelegationRequest({
    parentRunId: 'run-specialist',
    parentAgentId: 'backend',
    childAgentId: 'qa',
    task: 'Test my implementation',
    depth: 2
  }));
  assert(!specialistDelegation.allowed && specialistDelegation.error.code === 'UNAUTHORIZED_DELEGATION_DENIED', "Specialist delegation to another specialist is denied", "ARCH-07.2");

  const excessiveDepthDelegation = orch.canDelegate(core.createDelegationRequest({
    parentRunId: 'run-deep',
    parentAgentId: 'orchestrator',
    childAgentId: 'backend',
    task: 'Too deep',
    depth: 4
  }));
  assert(!excessiveDepthDelegation.allowed && excessiveDepthDelegation.error.code === 'DELEGATION_DEPTH_EXCEEDED', "Delegation exceeding max depth 3 is denied", "ARCH-07.3");

  console.log("\nTesting ARCH-08: Canonical Argument Normalization & Anti-TOCTOU...");
  const driver8 = new hosts.HostDriver();
  const session8 = createSession({ sessionId: 'arch08-session', initialPhase: 'EXECUTE' });
  const hostInv8 = hosts.createHostToolInvocation({
    host: 'antigravity',
    toolName: 'replace_file_content',
    args: { TargetFile: 'test.rs', ReplacementContent: '// code' }
  });
  const hostDec8 = driver8.evaluateInvocation(hostInv8, session8);
  assert(Boolean(hostDec8.canonical_hash), "Host decision binds canonical SHA-256 argument hash", "ARCH-08.1");
  assert(hostDec8.canonical_tool === 'write', "Host tool is strictly canonicalized to write", "ARCH-08.2");

  console.log("\nTesting ARCH-09: State Integrity & Anti-Tampering...");
  const testDir9 = path.join(process.cwd(), '.agent', 'test-arch09');
  fs.rmSync(testDir9, { recursive: true, force: true });
  const cleanState9 = new core.SessionState({ sessionId: 'arch09-s1', currentPhase: 'PLAN', sessionsRoot: testDir9 });
  cleanState9.save();
  const raw9 = JSON.parse(fs.readFileSync(cleanState9.filePath, 'utf8'));
  raw9.current_phase = 'EXECUTE';
  fs.writeFileSync(cleanState9.filePath, JSON.stringify(raw9, null, 2), 'utf8');
  const reloaded9 = core.SessionState.load('arch09-s1', testDir9);
  assert(reloaded9.tampered === true, "Tampered state hash mismatch detected", "ARCH-09.1");
  assert(reloaded9.currentPhase === 'REQUEST', "Tampered state fails closed to REQUEST", "ARCH-09.2");
  fs.rmSync(testDir9, { recursive: true, force: true });

  console.log("\nTesting ARCH-10: Host Fail-Closed & Shell De-obfuscation...");
  const pe10 = new core.PolicyEngine();
  const decBacktick = pe10.canExecute({ tool: 'bash', args: { cmd: 'g`it p`ush ` --force' } }, { current_phase: 'EXECUTE' });
  assert(!decBacktick.allowed && decBacktick.policy === 'P1_FORCE_PUSH_DENIED', "Obfuscated shell bypass denied", "ARCH-10.1");
  const decInline = pe10.canExecute({ tool: 'bash', args: { cmd: 'Out-File -FilePath evil.txt' } }, { current_phase: 'PLAN' });
  assert(!decInline.allowed && decInline.policy === 'P6_LIFECYCLE_WRITE_VIOLATION', "Disguised inline file write denied in non-write phase", "ARCH-10.2");

  console.log("\n============================================================");
  console.log(`Conformance Results: ${checksPassed} passed, ${checksFailed} failed`);
  console.log("============================================================\n");

  if (checksFailed > 0) {
    process.exit(1);
  }
}

runConformanceChecks().catch(err => {
  console.error("Conformance suite crashed:", err);
  process.exit(1);
});
