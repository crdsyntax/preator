#!/usr/bin/env bun

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PRAETOR_ROOT = path.resolve(__dirname, "..");
const PKG = JSON.parse(fs.readFileSync(path.join(PRAETOR_ROOT, "package.json"), "utf8"));
const PRAETOR_VERSION = PKG.version;

const HOOK_TEMPLATE_PATH = path.join(PRAETOR_ROOT, "runtime", "hosts", "templates", "praetor-hook.js");
const RUNTIME_ANTIGRAVITY_PATH = path.join(PRAETOR_ROOT, "runtime", "hosts", "antigravity.js").replace(/\\/g, "/");

function printHelp() {
  console.log(`
\x1b[1m\x1b[36mPraetor CLI\x1b[0m v${PRAETOR_VERSION} - Universal Governed Agent Runtime Framework

\x1b[1mUSAGE\x1b[0m
  $ praetor <command> [options]

\x1b[1mCOMMANDS\x1b[0m
  \x1b[32msetup\x1b[0m [targetPath]    Configure Praetor governance in target project (.agents/hooks.json)
  \x1b[32mhook\x1b[0m                  Execute Antigravity hook interceptor via stdin/stdout
  \x1b[32mverify\x1b[0m [targetPath]   Run automated intercept tests against project's Praetor hook
  \x1b[32mversion\x1b[0m, \x1b[32m-v\x1b[0m           Print Praetor version
  \x1b[32mhelp\x1b[0m, \x1b[32m-h\x1b[0m              Show this help message

\x1b[1mSETUP OPTIONS\x1b[0m
  --force               Overwrite existing hook script if present
  --no-config           Do not generate baseline runtime.config.json
  --no-verify           Skip post-setup verification probe

\x1b[1mEXAMPLES\x1b[0m
  $ praetor setup
  $ praetor setup D:\\Documents\\GitHub\\toketeo
  $ praetor verify D:\\Documents\\GitHub\\toketeo
`);
}

export function runSetup(targetDir = process.cwd(), options = {}) {
  const resolvedTarget = path.resolve(targetDir);
  console.log(`\x1b[1m\x1b[36m=== Praetor Setup (v${PRAETOR_VERSION}) ===\x1b[0m`);
  console.log(`Target project: \x1b[33m${resolvedTarget}\x1b[0m\n`);

  if (!fs.existsSync(resolvedTarget)) {
    throw new Error(`Target directory does not exist: ${resolvedTarget}`);
  }

  const agentsDir = path.join(resolvedTarget, ".agents");
  if (!fs.existsSync(agentsDir)) {
    fs.mkdirSync(agentsDir, { recursive: true });
    console.log(`  ✔ Created directory: .agents/`);
  } else {
    console.log(`  ✔ Directory exists: .agents/`);
  }

  const hookDest = path.join(agentsDir, "praetor-hook.js");
  if (!fs.existsSync(HOOK_TEMPLATE_PATH)) {
    throw new Error(`Hook template not found: ${HOOK_TEMPLATE_PATH}`);
  }

  let hookCode = fs.readFileSync(HOOK_TEMPLATE_PATH, "utf8");
  hookCode = hookCode.replace("{{PRAETOR_RUNTIME_PATH}}", RUNTIME_ANTIGRAVITY_PATH);

  if (fs.existsSync(hookDest) && !options.force) {
    console.log(`  ✔ Thin hook already exists: .agents/praetor-hook.js (use --force to overwrite)`);
  } else {
    fs.writeFileSync(hookDest, hookCode, "utf8");
    console.log(`  ✔ Installed thin hook: .agents/praetor-hook.js`);
  }

  const hooksJsonPath = path.join(agentsDir, "hooks.json");
  let hooksConfig = {
    $schema: "https://raw.githubusercontent.com/google/antigravity/main/schemas/hooks.schema.json",
    version: "1.0",
    hooks: {
      PreToolUse: []
    }
  };

  if (fs.existsSync(hooksJsonPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(hooksJsonPath, "utf8"));
      hooksConfig = { ...hooksConfig, ...existing };
      if (!hooksConfig.hooks) hooksConfig.hooks = {};
      if (!Array.isArray(hooksConfig.hooks.PreToolUse)) hooksConfig.hooks.PreToolUse = [];
    } catch (err) {
      console.warn(`  ⚠ Warning reading existing hooks.json (${err.message}). Re-initializing.`);
    }
  }

  const hookCommand = "bun .agents/praetor-hook.js";
  const existingIdx = hooksConfig.hooks.PreToolUse.findIndex(h =>
    h.command && (h.command.includes("praetor") || h.command.includes("antigravity.js"))
  );

  const hookEntry = {
    matcher: "*",
    command: hookCommand,
    timeout: 10
  };

  if (existingIdx !== -1) {
    hooksConfig.hooks.PreToolUse[existingIdx] = hookEntry;
    console.log(`  ✔ Updated existing Praetor entry in: .agents/hooks.json`);
  } else {
    hooksConfig.hooks.PreToolUse.push(hookEntry);
    console.log(`  ✔ Added Praetor PreToolUse hook to: .agents/hooks.json`);
  }

  fs.writeFileSync(hooksJsonPath, JSON.stringify(hooksConfig, null, 2), "utf8");

  const runtimeConfigPath = path.join(resolvedTarget, "runtime.config.json");
  if (!fs.existsSync(runtimeConfigPath) && !options.noConfig) {
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

  if (!options.noVerify) {
    console.log(`\nVerifying thin hook execution in target project...`);
    const verifyResult = runVerify(resolvedTarget);
    if (!verifyResult) {
      console.warn(`\x1b[33mSetup completed with verification warnings.\x1b[0m`);
      return false;
    }
  }

  console.log(`\n\x1b[32m✔ Praetor successfully instantiated in ${resolvedTarget}\x1b[0m\n`);
  return true;
}

export function runVerify(targetDir = process.cwd()) {
  const resolvedTarget = path.resolve(targetDir);
  const hookScript = path.join(resolvedTarget, ".agents", "praetor-hook.js");

  if (!fs.existsSync(hookScript)) {
    console.error(`\x1b[31mError: Hook script not found at ${hookScript}\x1b[0m`);
    return false;
  }

  function probe(payload) {
    const res = spawnSync("bun", [hookScript], {
      cwd: resolvedTarget,
      input: JSON.stringify(payload) + "\n",
      encoding: "utf8"
    });

    if (res.error) {
      throw res.error;
    }
    try {
      return JSON.parse(res.stdout.trim());
    } catch (err) {
      throw new Error(`Hook output is not valid JSON: '${res.stdout.trim()}' (stderr: ${res.stderr})`);
    }
  }

  try {
    const res1 = probe({
      toolCall: { name: "view_file", args: { AbsolutePath: "package.json" } },
      stepIdx: 1
    });
    if (res1.decision !== "allow") {
      console.error(`  ✘ Probe 1 Failed: Expected allow for view_file, got ${res1.decision} (${res1.reason})`);
      return false;
    }
    console.log(`  ✔ [Probe 1: Read Tool] Decision: allow`);

    const res2 = probe({
      toolCall: { name: "run_command", args: { CommandLine: "git push --force origin main" } },
      stepIdx: 2
    });
    if (res2.decision !== "deny") {
      console.error(`  ✘ Probe 2 Failed: Expected deny for git push --force, got ${res2.decision}`);
      return false;
    }
    console.log(`  ✔ [Probe 2: Destructive Command] Decision: deny (${res2.reason})`);

    const emptyRes = spawnSync("bun", [hookScript], {
      cwd: resolvedTarget,
      input: "\n",
      encoding: "utf8"
    });
    const parsedEmpty = JSON.parse(emptyRes.stdout.trim());
    if (parsedEmpty.decision !== "deny" || parsedEmpty.code !== "HOOK_FAIL_CLOSED") {
      console.error(`  ✘ Probe 3 Failed: Empty stdin did not fail-closed to deny`);
      return false;
    }
    console.log(`  ✔ [Probe 3: Fail-Closed Stdin] Decision: deny (HOOK_FAIL_CLOSED)`);

    return true;
  } catch (err) {
    console.error(`\x1b[31mVerification failed: ${err.message}\x1b[0m`);
    return false;
  }
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

  if (cmd === "hook" || cmd === "intercept") {
    const { AntigravityHostAdapter } = await import("../runtime/hosts/antigravity.js");
    await AntigravityHostAdapter.runCli();
    process.exit(0);
  }

  if (cmd === "setup") {
    const target = args[1] && !args[1].startsWith("-") ? args[1] : process.cwd();
    const force = args.includes("--force");
    const noConfig = args.includes("--no-config");
    const noVerify = args.includes("--no-verify");

    try {
      const ok = runSetup(target, { force, noConfig, noVerify });
      process.exit(ok ? 0 : 1);
    } catch (err) {
      console.error(`\x1b[31mSetup error: ${err.message}\x1b[0m`);
      process.exit(1);
    }
  }

  if (cmd === "verify") {
    const target = args[1] && !args[1].startsWith("-") ? args[1] : process.cwd();
    console.log(`\x1b[1m\x1b[36m=== Praetor Hook Verification ===\x1b[0m`);
    console.log(`Target: \x1b[33m${path.resolve(target)}\x1b[0m\n`);
    const ok = runVerify(target);
    process.exit(ok ? 0 : 1);
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
