#!/usr/bin/env bun

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../");

let checksPassed = 0;
let checksFailed = 0;

function assert(condition, message) {
  if (condition) {
    checksPassed++;
    console.log(`  \x1b[32m✔ ${message}\x1b[0m`);
  } else {
    checksFailed++;
    console.error(`  \x1b[31m✘ ${message}\x1b[0m`);
  }
}

async function runCliTests() {
  console.log("\x1b[1m\x1b[36m=== Testing Praetor Setup CLI & Thin Hook (§F9.3) ===\x1b[0m\n");

  const tempDir = path.join(os.tmpdir(), `praetor-consumer-test-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    console.log(`[Test 1] Running 'praetor setup' on consumer project: ${tempDir}`);
    const setupCli = spawnSync("bun", ["bin/praetor.js", "setup", tempDir], {
      cwd: projectRoot,
      encoding: "utf8"
    });

    assert(setupCli.status === 0, "praetor setup exited with status code 0");

    const hookPath = path.join(tempDir, ".agents", "praetor-hook.js");
    const hooksJsonPath = path.join(tempDir, ".agents", "hooks.json");
    const configPath = path.join(tempDir, "runtime.config.json");

    assert(fs.existsSync(hookPath), "Generated thin hook at .agents/praetor-hook.js");
    assert(fs.existsSync(hooksJsonPath), "Generated .agents/hooks.json");
    assert(fs.existsSync(configPath), "Generated baseline runtime.config.json");

    const hooksJson = JSON.parse(fs.readFileSync(hooksJsonPath, "utf8"));
    const preToolHooks = hooksJson?.hooks?.PreToolUse || [];
    assert(preToolHooks.length > 0, ".agents/hooks.json contains PreToolUse array");

    const hookEntry = preToolHooks.find(h => h.command && h.command.includes("praetor-hook.js"));
    assert(!!hookEntry, "PreToolUse entry invokes .agents/praetor-hook.js");
    assert(hookEntry.matcher === "*", "Hook matcher covers all tools (*)");

    function sendHook(payload) {
      const res = spawnSync("bun", [hookPath], {
        cwd: tempDir,
        input: typeof payload === "string" ? payload : JSON.stringify(payload) + "\n",
        encoding: "utf8"
      });
      try {
        return JSON.parse(res.stdout.trim());
      } catch (err) {
        throw new Error(`Failed to parse stdout: '${res.stdout}' (stderr: ${res.stderr})`);
      }
    }

    console.log("\n[Test 2] Probing view_file tool invocation (REQUEST phase)...");
    const resAllow = sendHook({
      toolCall: {
        name: "view_file",
        args: { AbsolutePath: "runtime.config.json" }
      },
      conversationId: `conv-allow-${Date.now()}`,
      stepIdx: 1
    });
    assert(resAllow.decision === "allow", "view_file is allowed in initial REQUEST phase");

    console.log("\n[Test 3] Probing destructive 'git push --force' tool invocation...");
    const resDenyDestructive = sendHook({
      toolCall: {
        name: "run_command",
        args: { CommandLine: "git push --force origin main" }
      },
      conversationId: `conv-deny-${Date.now()}`,
      stepIdx: 2
    });
    assert(resDenyDestructive.decision === "deny", "git push --force is strictly denied");
    assert(resDenyDestructive.code === "P1_FORCE_PUSH_DENIED", "Reason code is P1_FORCE_PUSH_DENIED");

    console.log("\n[Test 4] Probing 'git push origin main' tool invocation...");
    const resAsk = sendHook({
      toolCall: {
        name: "run_command",
        args: { CommandLine: "git push origin main" }
      },
      conversationId: `conv-ask-${Date.now()}`,
      stepIdx: 3
    });
    assert(resAsk.decision === "ask", "git push requires human confirmation (ask)");

    console.log("\n[Test 5] Probing fail-closed response on corrupted JSON stdin...");
    const resCorrupt = sendHook("{{ INVALID JSON DATA");
    assert(resCorrupt.decision === "deny", "Corrupted stdin fails-closed to deny");
    assert(resCorrupt.code === "HOOK_FAIL_CLOSED", "Corrupted stdin code is HOOK_FAIL_CLOSED");

    console.log("\n[Test 6] Probing fail-closed response on empty stdin...");
    const resEmpty = sendHook("   \n");
    assert(resEmpty.decision === "deny", "Empty stdin fails-closed to deny");
    assert(resEmpty.code === "HOOK_FAIL_CLOSED", "Empty stdin code is HOOK_FAIL_CLOSED");

    console.log("\n[Test 7] Testing 'praetor verify' command on target directory...");
    const verifyCli = spawnSync("bun", ["bin/praetor.js", "verify", tempDir], {
      cwd: projectRoot,
      encoding: "utf8"
    });
    assert(verifyCli.status === 0, "praetor verify exited with status 0");

  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }

  console.log(`\n============================================================`);
  console.log(`Setup CLI Test Results: ${checksPassed} passed, ${checksFailed} failed`);
  console.log(`============================================================\n`);

  if (checksFailed > 0) {
    process.exit(1);
  }
}

runCliTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
