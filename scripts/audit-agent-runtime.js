#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import {
  createSession,
  core,
  providers,
  hosts,
  evaluation
} from '../runtime/index.js';

let passed = 0;
let failed = 0;

function check(title, condition) {
  if (condition) {
    passed++;
    console.log(`  \x1b[32m✔ ${title}\x1b[0m`);
  } else {
    failed++;
    console.error(`  \x1b[31m✘ ${title}\x1b[0m`);
  }
}

async function runAudit() {
  console.log("\x1b[1m\x1b[36m=== Praetor Framework Audit (v0.9.1) ===\x1b[0m\n");

  console.log("1. Lifecycle State Machine Audit...");
  const lm = new core.LifecycleMachine('REQUEST');
  check("Initial phase is REQUEST", lm.getPhase() === 'REQUEST');
  check("Can transition to ANALYZE", lm.canTransition('ANALYZE'));
  check("Cannot jump directly to EXECUTE", !lm.canTransition('EXECUTE'));
  lm.transition('ANALYZE');
  check("Transitioned to ANALYZE", lm.getPhase() === 'ANALYZE');
  check("Write disallowed in ANALYZE", !lm.isWriteAllowed());

  console.log("\n2. Catalogs & Profiles Audit...");
  const ac = new core.AgentCatalog();
  const agents = ac.loadFromDir('agents');
  check("Loaded canonical agent profiles (>=9)", agents.length >= 9);
  check("Architecture agent is present", ac.has('architect'));
  check("Root orchestrator is present", ac.has('orchestrator'));
  check("Backend engineer is present", ac.has('backend-engineer'));
  check("Frontend engineer is present", ac.has('frontend-engineer'));
  check("Database engineer is present", ac.has('database-engineer'));
  check("QA tester is present", ac.has('qa-tester'));

  const sc = new core.SkillCatalog();
  const skills = sc.loadFromDir('skills');
  check("Loaded multi-stack skills (>=4)", skills.length >= 4);
  check("Code conventions skill is present", sc.has('code-conventions'));
  check("Rust Cargo skill is present", sc.has('rust-cargo'));
  check("Next.js React skill is present", sc.has('nextjs-react'));
  check("Database SQL skill is present", sc.has('database-sql'));
  check("Git Workflow skill is present", sc.has('git-workflow'));

  console.log("\n3. Dual-Layer Policy Engine Audit...");
  const policy = new core.PolicyEngine();
  const allowRead = policy.canExecute({ tool: 'read', args: { path: 'src/main.rs' } }, { current_phase: 'ANALYZE' });
  check("Read tool allowed in ANALYZE", allowRead.allowed);

  const blockWrite = policy.canExecute({ tool: 'write', args: { path: 'src/main.rs' } }, { current_phase: 'ANALYZE' });
  check("Write tool denied in ANALYZE", !blockWrite.allowed && blockWrite.policy === 'P6_LIFECYCLE_WRITE_VIOLATION');

  const blockForcePush = policy.canExecute({ tool: 'run_command', args: { cmd: 'git push --force origin main' } }, { current_phase: 'EXECUTE' });
  check("Force-push strictly denied in EXECUTE", !blockForcePush.allowed && blockForcePush.policy === 'P1_FORCE_PUSH_DENIED');

  const blockDestructive = policy.canExecute({ tool: 'run_command', args: { cmd: 'rm -rf /' } }, { current_phase: 'EXECUTE' });
  check("Destructive root command strictly denied", !blockDestructive.allowed && blockDestructive.policy === 'P1_DESTRUCTIVE_COMMAND_DENIED');

  const askPush = policy.canExecute({ tool: 'run_command', args: { cmd: 'git push origin main' } }, { current_phase: 'EXECUTE' });
  check("Git push demands human approval", !askPush.allowed && askPush.policy === 'P1_PUSH_APPROVAL_REQUIRED');

  console.log("\n4. Host Adapter & Normalization Audit...");
  const hd = new hosts.HostDriver();
  check("Normalize replace_file_content to write", hd.normalizeToolName('replace_file_content') === 'write');
  check("Normalize run_command to bash", hd.normalizeToolName('run_command') === 'bash');
  check("Normalize view_file to read", hd.normalizeToolName('view_file') === 'read');

  console.log("\n5. Context Governance & Deterministic Retrieval Audit...");
  const session = createSession({
    agentId: 'backend-engineer',
    initialPhase: 'ANALYZE'
  });
  const bundle = await session.retrieveContext({
    sources: ['agents/core/engineering.md'],
    maxTokens: 500
  });
  check("Context bundle resolved", Boolean(bundle));
  check("Bundle has valid SHA-256 hash", typeof bundle.bundle_hash === 'string' && bundle.bundle_hash.length === 64);
  check("Bundle total tokens within budget", bundle.total_tokens <= 500);

  console.log("\n6. Runtime Configuration Audit...");
  check("runtime.config.json exists", fs.existsSync('runtime.config.json'));
  const cfg = JSON.parse(fs.readFileSync('runtime.config.json', 'utf8'));
  check("Config version is 1.0 (Praetor v0.9.1)", cfg.version === '1.0');
  check("Config defines workspace boundaries", Boolean(cfg.workspace?.boundaries?.allowed));

  console.log("\n============================================================");
  console.log(`Audit Results: ${passed} passed, ${failed} failed`);
  console.log("============================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runAudit().catch(err => {
  console.error("Audit crashed:", err);
  process.exit(1);
});
