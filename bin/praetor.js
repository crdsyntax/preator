#!/usr/bin/env bun

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultHostRegistry } from "../runtime/hosts/registry.js";
import { AntigravityHostAdapter } from "../runtime/hosts/antigravity.js";
import { McpHostAdapter } from "../runtime/hosts/mcp.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PRAETOR_ROOT = path.resolve(__dirname, "..");
const PKG = JSON.parse(fs.readFileSync(path.join(PRAETOR_ROOT, "package.json"), "utf8"));
const PRAETOR_VERSION = PKG.version;

function printHelp() {
  const hosts = defaultHostRegistry.list().map(h => `    • ${h.name.padEnd(12)} - ${h.description}`).join("\n");
  console.log(`
\x1b[1m\x1b[36mPraetor CLI\x1b[0m v${PRAETOR_VERSION} - Governed Execution Runtime for AI Agent Tasks

\x1b[1mUSAGE\x1b[0m
  $ praetor <command> [options]

\x1b[1mCOMMANDS\x1b[0m
  \x1b[32mtask\x1b[0m [create] [goal]    Create and initialize a Praetor Governed Task Session
  \x1b[32msetup\x1b[0m [targetPath]    Configure project to use Praetor as governed execution runtime
  \x1b[32mhosts\x1b[0m [targetPath]    List all supported host adapters and detection status
  \x1b[32mverify\x1b[0m [targetPath]   Verify host connection to Praetor execution runtime
  \x1b[32mmigrate\x1b[0m [targetPath]  Re-seal legacy (v1) session state to v2; quarantine invalid sessions
  \x1b[32mdoctor\x1b[0m [targetPath]   Check seal key, session integrity and runtime configuration
  \x1b[32maudit\x1b[0m verify <id>   Reconstruct and verify a session's seal, event chain and trace
  \x1b[32mhook\x1b[0m [hostName]       Execute stdio interceptor for host (default: antigravity)
  \x1b[32mmcp\x1b[0m                   Execute Model Context Protocol (MCP) stdio server
  \x1b[32mversion\x1b[0m, \x1b[32m-v\x1b[0m           Print Praetor version
  \x1b[32mhelp\x1b[0m, \x1b[32m-h\x1b[0m              Show this help message

\x1b[1mSUPPORTED HOSTS\x1b[0m
${hosts}

\x1b[1mSETUP OPTIONS\x1b[0m
  --host <name>         Target host adapter (if omitted, runs auto-detection)
  --force               Overwrite existing configuration or scripts
  --no-config           Do not generate baseline runtime.config.json
  --no-verify           Skip post-setup verification probe

\x1b[1mEXAMPLES\x1b[0m
  $ praetor hosts
  $ praetor setup D:\\Documents\\GitHub\\my-project --host opencode
  $ praetor setup D:\\Documents\\GitHub\\my-project --host claude
  $ praetor setup D:\\Documents\\GitHub\\my-project --host antigravity
  $ praetor setup D:\\Documents\\GitHub\\my-project --host mcp
  $ praetor verify D:\\Documents\\GitHub\\my-project --host opencode
`);
}

function ensureBaselineConfig(targetDir) {
  const runtimeConfigPath = path.join(targetDir, "runtime.config.json");
  if (!fs.existsSync(runtimeConfigPath)) {
    const defaultConfig = {
      $schema: "./schemas/runtime.config.schema.json",
      version: "1.0",
      runtime: {
        log_level: "info",
        sessions_dir: ".agent/sessions",
        max_delegation_depth: 3,
        max_concurrency: 4
      },
      workspace: {
        boundaries: {
          allowed: ["src", "app", "pkg", "agents", "docs", "scripts"],
          denied: ["node_modules", ".git", ".env"]
        }
      },
      policy: {
        denied_tools: [],
        phase_rules: {
          REQUEST: { allowed_tools: ["view_file", "list_dir", "grep_search", "search_web", "read"] },
          ANALYZE: { allowed_tools: ["view_file", "list_dir", "grep_search", "search_web", "read"] },
          PLAN: { allowed_tools: ["view_file", "list_dir", "grep_search", "read"] },
          REVIEW: { allowed_tools: ["view_file", "list_dir", "grep_search", "read"] },
          EXECUTE: { allowed_tools: ["*"] },
          VERIFY: { allowed_tools: ["*"] },
          DOCUMENT: { allowed_tools: ["write_to_file", "replace_file_content", "multi_replace_file_content", "view_file", "read", "write"] },
          COMPLETE: { allowed_tools: [] }
        }
      }
    };
    fs.writeFileSync(runtimeConfigPath, JSON.stringify(defaultConfig, null, 2), "utf8");
    console.log(`  ✔ Created baseline: runtime.config.json`);
  }
}

export function runHostsList(targetDir = process.cwd()) {
  const resolvedTarget = path.resolve(targetDir);
  console.log(`\x1b[1m\x1b[36m=== Praetor Supported Host Integrations ===\x1b[0m`);
  console.log(`Inspecting target: \x1b[33m${resolvedTarget}\x1b[0m\n`);

  const adapters = defaultHostRegistry.list();
  for (const adapter of adapters) {
    const isDetected = adapter.detect(resolvedTarget);
    const statusLabel = isDetected ? `\x1b[32m✔ DETECTED\x1b[0m` : `\x1b[90m- not detected\x1b[0m`;
    console.log(`  ${adapter.name.padEnd(14)} [${statusLabel.padEnd(20)}] : ${adapter.description}`);
  }
  console.log("");
}

export function runSetup(targetDir = process.cwd(), options = {}) {
  const resolvedTarget = path.resolve(targetDir);

  if (!fs.existsSync(resolvedTarget)) {
    throw new Error(`Target directory does not exist: ${resolvedTarget}`);
  }

  let selectedAdapter = null;

  if (options.host) {
    selectedAdapter = defaultHostRegistry.get(options.host);
    if (!selectedAdapter) {
      const valid = defaultHostRegistry.list().map(h => h.name).join(", ");
      throw new Error(`Unsupported host: '${options.host}'. Available hosts: ${valid}`);
    }
  } else {
    const detected = defaultHostRegistry.detect(resolvedTarget);
    if (detected.length === 1) {
      selectedAdapter = detected[0];
      console.log(`  ℹ Auto-detected host: \x1b[32m${selectedAdapter.name}\x1b[0m`);
    } else if (detected.length > 1) {
      const names = detected.map(d => d.name).join(", ");
      console.error(`\x1b[33mMultiple host environments detected in ${resolvedTarget}: [${names}]\x1b[0m`);
      console.error(`Please explicitly specify target host with:`);
      console.error(`  $ praetor setup ${resolvedTarget} --host <name>\n`);
      return false;
    } else {
      const valid = defaultHostRegistry.list().map(h => `  • --host ${h.name.padEnd(12)} (${h.description})`).join("\n");
      console.error(`\x1b[33mNo host environment detected in ${resolvedTarget}.\x1b[0m`);
      console.error(`Please explicitly specify target host to configure:\n${valid}\n`);
      return false;
    }
  }

  console.log(`\x1b[1m\x1b[36m=== Praetor Setup [Host: ${selectedAdapter.name}] (v${PRAETOR_VERSION}) ===\x1b[0m`);
  console.log(`Target project: \x1b[33m${resolvedTarget}\x1b[0m\n`);

  const result = selectedAdapter.setup(resolvedTarget, options);
  console.log(`  ✔ Configured runtime integration for: \x1b[32m${selectedAdapter.name}\x1b[0m`);

  if (!options.noConfig) {
    ensureBaselineConfig(resolvedTarget);
  }

  if (!options.noVerify) {
    console.log(`\nVerifying host integration...`);
    try {
      selectedAdapter.verify(resolvedTarget);
      console.log(`  ✔ Integration verification passed for: \x1b[32m${selectedAdapter.name}\x1b[0m`);
    } catch (err) {
      console.warn(`  ⚠ Verification warning: ${err.message}`);
    }
  }

  console.log(`\n\x1b[32m✔ Praetor governed execution runtime enabled for host '${selectedAdapter.name}' in ${resolvedTarget}\x1b[0m\n`);
  return true;
}

export function runVerify(targetDir = process.cwd(), options = {}) {
  const resolvedTarget = path.resolve(targetDir);

  let selectedAdapter = null;
  if (options.host) {
    selectedAdapter = defaultHostRegistry.get(options.host);
    if (!selectedAdapter) {
      const valid = defaultHostRegistry.list().map(h => h.name).join(", ");
      throw new Error(`Unsupported host: '${options.host}'. Available hosts: ${valid}`);
    }
  } else {
    const detected = defaultHostRegistry.detect(resolvedTarget);
    if (detected.length === 1) {
      selectedAdapter = detected[0];
    } else if (detected.length > 1) {
      throw new Error(`Multiple hosts detected: [${detected.map(d => d.name).join(', ')}]. Specify --host <name>`);
    } else {
      throw new Error(`No host detected in ${resolvedTarget}. Specify --host <name>`);
    }
  }

  console.log(`\x1b[1m\x1b[36m=== Praetor Verification [Host: ${selectedAdapter.name}] ===\x1b[0m`);
  console.log(`Target: \x1b[33m${resolvedTarget}\x1b[0m\n`);

  selectedAdapter.verify(resolvedTarget);
  console.log(`  ✔ Verification successful for host: \x1b[32m${selectedAdapter.name}\x1b[0m\n`);
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] || "help";

  if (cmd === "--version" || cmd === "-v" || cmd === "version") {
    console.log(`Praetor v${PRAETOR_VERSION}`);
    process.exit(0);
  }

  if (cmd === "--help" || cmd === "-h" || cmd === "help") {
    printHelp();
    process.exit(0);
  }

  if (cmd === "hosts") {
    const target = args[1] && !args[1].startsWith("-") ? args[1] : process.cwd();
    runHostsList(target);
    process.exit(0);
  }

  if (cmd === "hook" || cmd === "intercept") {
    const hostName = (args[1] && !args[1].startsWith("-") ? args[1] : "antigravity").toLowerCase();
    if (hostName === "mcp") {
      await McpHostAdapter.runCli();
    } else {
      await AntigravityHostAdapter.runCli();
    }
    process.exit(0);
  }

  if (cmd === "mcp") {
    await McpHostAdapter.runCli();
    process.exit(0);
  }

  if (cmd === "task") {
    const sub = args[1];
    let goal = "";
    for (let i = 1; i < args.length; i++) {
      if ((args[i] === "--goal" || args[i] === "-g" || args[i] === "--task") && args[i + 1]) {
        goal = args[i + 1];
        i++;
      } else if (i === 1 && sub !== "create" && sub !== "execute" && sub !== "get" && !args[i].startsWith("-")) {
        goal = args[i];
      } else if (i === 2 && sub === "create" && !args[i].startsWith("-")) {
        goal = args[i];
      }
    }
    const { createTask, executeTask, getTask } = await import("../protocol/index.js");
    if (sub === "execute") {
      const target = args[2] || goal;
      const executed = await executeTask(target);
      console.log(JSON.stringify(executed, null, 2));
      process.exit(0);
    }
    if (sub === "get") {
      const target = args[2];
      const taskInfo = getTask(target);
      console.log(JSON.stringify(taskInfo, null, 2));
      process.exit(0);
    }
    const task = createTask({ goal });
    const output = {
      taskId: task.taskId,
      sessionId: task.sessionId,
      status: "governed",
      phase: task.phase,
      goal: task.goal,
      audit_seal: task.audit_seal,
      created_at: task.createdAt
    };
    console.log(JSON.stringify(output, null, 2));
    process.exit(0);
  }

  if (cmd === "setup") {
    let target = process.cwd();
    let host = null;
    const force = args.includes("--force");
    const noConfig = args.includes("--no-config");
    const noVerify = args.includes("--no-verify");

    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--host" && args[i + 1]) {
        host = args[i + 1];
        i++;
      } else if (!args[i].startsWith("-")) {
        target = args[i];
      }
    }

    try {
      const ok = runSetup(target, { host, force, noConfig, noVerify });
      process.exit(ok ? 0 : 1);
    } catch (err) {
      console.error(`\x1b[31mSetup error: ${err.message}\x1b[0m`);
      process.exit(1);
    }
  }

  if (cmd === "verify") {
    let target = process.cwd();
    let host = null;
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--host" && args[i + 1]) {
        host = args[i + 1];
        i++;
      } else if (!args[i].startsWith("-")) {
        target = args[i];
      }
    }

    try {
      const ok = runVerify(target, { host });
      process.exit(ok ? 0 : 1);
    } catch (err) {
      console.error(`\x1b[31mVerification error: ${err.message}\x1b[0m`);
      process.exit(1);
    }
  }

  if (cmd === "migrate") {
    const target = args[1] && !args[1].startsWith("-") ? args[1] : process.cwd();
    const dryRun = args.includes("--dry-run");
    try {
      const { runMigrate } = await import("../scripts/migrate-runtime.js");
      const summary = runMigrate(target, { dryRun });
      console.log(JSON.stringify(summary, null, 2));
      process.exit(summary.errors.length > 0 ? 1 : 0);
    } catch (err) {
      console.error(`\x1b[31mMigrate error: ${err.message}\x1b[0m`);
      process.exit(1);
    }
  }

  if (cmd === "doctor") {
    const target = args[1] && !args[1].startsWith("-") ? args[1] : process.cwd();
    try {
      const { runDoctor } = await import("../scripts/doctor.js");
      const report = runDoctor(target);
      console.log(`\x1b[1m\x1b[36m=== Praetor Doctor ===\x1b[0m`);
      console.log(`Target: ${report.target}\n`);
      for (const check of report.checks) {
        const mark = check.ok ? "\x1b[32m\u2714\x1b[0m" : "\x1b[31m\u2718\x1b[0m";
        console.log(`  ${mark} ${check.id}: ${check.message}`);
      }
      console.log(`\n${report.healthy ? "\x1b[32mHealthy\x1b[0m" : "\x1b[31mIssues detected\x1b[0m"}\n`);
      process.exit(report.healthy ? 0 : 1);
    } catch (err) {
      console.error(`\x1b[31mDoctor error: ${err.message}\x1b[0m`);
      process.exit(1);
    }
  }

  if (cmd === "audit") {
    const sub = args[1];
    if (sub !== "verify") {
      console.error("Usage: praetor audit verify <sessionId> [targetPath]");
      process.exit(1);
    }
    const sessionId = args[2];
    const target = args[3] && !args[3].startsWith("-") ? args[3] : process.cwd();
    if (!sessionId) {
      console.error("Usage: praetor audit verify <sessionId> [targetPath]");
      process.exit(1);
    }
    try {
      const { verifySession } = await import("../scripts/audit-session.js");
      const report = verifySession(sessionId, { targetDir: target });
      console.log(JSON.stringify(report, null, 2));
      process.exit(report.valid ? 0 : 1);
    } catch (err) {
      console.error(`\x1b[31mAudit error: ${err.message}\x1b[0m`);
      process.exit(1);
    }
  }

  console.error(`Unknown command: ${cmd}`);
  printHelp();
  process.exit(1);
}

if (import.meta.main || (process.argv[1] && process.argv[1].endsWith("praetor.js"))) {
  main().catch(err => {
    console.error(`Fatal CLI error: ${err.message}`);
    process.exit(1);
  });
}
