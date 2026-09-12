#!/usr/bin/env bun

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { defaultHostRegistry } from "../../runtime/hosts/registry.js";
import { createSession } from "../../runtime/session.js";

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
  console.log("\x1b[1m\x1b[36m=== Testing Praetor Host Registry & Agnostic CLI (§F9.4) ===\x1b[0m\n");

  const tempDir = path.join(os.tmpdir(), `praetor-consumer-test-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    console.log("[Test 1] Testing 'praetor hosts' command...");
    const hostsCli = spawnSync("bun", ["bin/praetor.js", "hosts", tempDir], {
      cwd: projectRoot,
      encoding: "utf8"
    });
    assert(hostsCli.status === 0, "praetor hosts exited with status code 0");
    assert(hostsCli.stdout.includes("antigravity"), "praetor hosts lists antigravity");
    assert(hostsCli.stdout.includes("mcp"), "praetor hosts lists mcp");
    assert(hostsCli.stdout.includes("opencode"), "praetor hosts lists opencode");
    assert(hostsCli.stdout.includes("claude"), "praetor hosts lists claude");
    assert(hostsCli.stdout.includes("codex"), "praetor hosts lists codex");

    console.log("\n[Test 2] Testing zero-default behavior (setup on empty dir without --host)...");
    const noHostCli = spawnSync("bun", ["bin/praetor.js", "setup", tempDir], {
      cwd: projectRoot,
      encoding: "utf8"
    });
    assert(noHostCli.status !== 0, "praetor setup without --host fails on empty dir");
    assert(
      noHostCli.stderr.includes("No host environment detected") || noHostCli.stdout.includes("No host environment detected"),
      "CLI prompts user to specify --host instead of assuming Antigravity"
    );

    console.log("\n[Test 3] Running 'praetor setup --host antigravity'...");
    const setupAgCli = spawnSync("bun", ["bin/praetor.js", "setup", tempDir, "--host", "antigravity"], {
      cwd: projectRoot,
      encoding: "utf8"
    });
    assert(setupAgCli.status === 0, "praetor setup --host antigravity succeeded");

    const hookPath = path.join(tempDir, ".agents", "praetor-hook.js");
    const hooksJsonPath = path.join(tempDir, ".agents", "hooks.json");
    assert(fs.existsSync(hookPath), "Generated Antigravity hook at .agents/praetor-hook.js");
    assert(fs.existsSync(hooksJsonPath), "Generated .agents/hooks.json");

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

    console.log("\n[Test 4] Probing Antigravity hook invocations...");
    const resAllow = sendHook({
      toolCall: { name: "view_file", args: { AbsolutePath: "runtime.config.json" } },
      stepIdx: 1
    });
    assert(resAllow.decision === "allow", "view_file is allowed in initial REQUEST phase");

    const resDeny = sendHook({
      toolCall: { name: "run_command", args: { CommandLine: "git push --force origin main" } },
      stepIdx: 2
    });
    assert(resDeny.decision === "deny", "git push --force is denied");

    const resEmpty = sendHook("   \n");
    assert(resEmpty.decision === "deny" && resEmpty.code === "HOOK_FAIL_CLOSED", "Empty stdin fails closed");

    console.log("\n[Test 5] Testing auto-detection when Antigravity artifacts are present...");
    const autoDetectCli = spawnSync("bun", ["bin/praetor.js", "setup", tempDir, "--no-verify"], {
      cwd: projectRoot,
      encoding: "utf8"
    });
    assert(autoDetectCli.status === 0, "Auto-detection setup succeeded");
    assert(
      autoDetectCli.stdout.includes("Auto-detected host:") && autoDetectCli.stdout.includes("antigravity"),
      "Successfully auto-detected Antigravity from .agents directory"
    );

    console.log("\n[Test 6] Testing 'praetor setup --host mcp'...");
    const mcpDir = path.join(os.tmpdir(), `praetor-mcp-test-${Date.now()}`);
    fs.mkdirSync(mcpDir, { recursive: true });
    try {
      const mcpCli = spawnSync("bun", ["bin/praetor.js", "setup", mcpDir, "--host", "mcp"], {
        cwd: projectRoot,
        encoding: "utf8"
      });
      assert(mcpCli.status === 0, "praetor setup --host mcp succeeded");
      assert(fs.existsSync(path.join(mcpDir, "mcp.json")), "Generated mcp.json");
    } finally {
      try { fs.rmSync(mcpDir, { recursive: true, force: true }); } catch {}
    }

    console.log("\n[Test 7] Testing 'praetor setup --host opencode'...");
    const opencodeDir = path.join(os.tmpdir(), `praetor-oc-test-${Date.now()}`);
    fs.mkdirSync(opencodeDir, { recursive: true });
    try {
      const ocCli = spawnSync("bun", ["bin/praetor.js", "setup", opencodeDir, "--host", "opencode"], {
        cwd: projectRoot,
        encoding: "utf8"
      });
      assert(ocCli.status === 0, "praetor setup --host opencode succeeded");
      assert(fs.existsSync(path.join(opencodeDir, "opencode.json")), "Generated opencode.json");
      assert(fs.existsSync(path.join(opencodeDir, ".opencode", "commands", "praetor.md")), "Generated .opencode/commands/praetor.md");
      assert(fs.existsSync(path.join(opencodeDir, ".opencode", "instructions.md")), "Generated .opencode/instructions.md");
      const ocJson = JSON.parse(fs.readFileSync(path.join(opencodeDir, "opencode.json"), "utf8"));
      assert(Array.isArray(ocJson.instructions), "opencode.json instructions is an array conforming to schema");
      assert(ocJson.instructions.includes(".opencode/instructions.md"), "opencode.json references .opencode/instructions.md");
      const instrContent = fs.readFileSync(path.join(opencodeDir, ".opencode", "instructions.md"), "utf8");
      assert(instrContent.includes("praetor_execute_task"), "instructions.md directs agent to praetor_execute_task");
      const cmdContent = fs.readFileSync(path.join(opencodeDir, ".opencode", "commands", "praetor.md"), "utf8");
      assert(cmdContent.includes("$ARGUMENTS"), "praetor.md passes user arguments directly");
      assert(!cmdContent.includes("Execute this task strictly"), "praetor.md does not pollute chat with internal instructions");

      const taskCli = spawnSync("bun", ["bin/praetor.js", "task", "create", "--goal", "Sample task"], {
        cwd: projectRoot,
        encoding: "utf8"
      });
      assert(taskCli.status === 0, "praetor task create exited with code 0");
      assert(taskCli.stdout.includes("governed"), "praetor task create returns governed status");
    } finally {
      try { fs.rmSync(opencodeDir, { recursive: true, force: true }); } catch {}
    }

    console.log("\n[Test 8] Testing 'praetor setup --host claude'...");
    const claudeDir = path.join(os.tmpdir(), `praetor-claude-test-${Date.now()}`);
    fs.mkdirSync(claudeDir, { recursive: true });
    try {
      const claudeCli = spawnSync("bun", ["bin/praetor.js", "setup", claudeDir, "--host", "claude"], {
        cwd: projectRoot,
        encoding: "utf8"
      });
      assert(claudeCli.status === 0, "praetor setup --host claude succeeded");
      assert(fs.existsSync(path.join(claudeDir, ".claude", "settings.json")), "Generated .claude/settings.json");
    } finally {
      try { fs.rmSync(claudeDir, { recursive: true, force: true }); } catch {}
    }

    console.log("\n[Test 9] Testing 'praetor setup --host codex'...");
    const codexDir = path.join(os.tmpdir(), `praetor-codex-test-${Date.now()}`);
    fs.mkdirSync(codexDir, { recursive: true });
    try {
      const codexCli = spawnSync("bun", ["bin/praetor.js", "setup", codexDir, "--host", "codex"], {
        cwd: projectRoot,
        encoding: "utf8"
      });
      assert(codexCli.status === 0, "praetor setup --host codex succeeded");
      assert(fs.existsSync(path.join(codexDir, ".codex", "config.json")), "Generated .codex/config.json");
    } finally {
      try { fs.rmSync(codexDir, { recursive: true, force: true }); } catch {}
    }

    console.log("\n[Test 10] Testing host adapter identity & contracts...");
    const adapters = defaultHostRegistry.list();
    for (const adapter of adapters) {
      assert(typeof adapter.name === "string" && adapter.name.length > 0, `${adapter.name} has valid identity`);
      assert(typeof adapter.detect === "function", `${adapter.name} implements detect method`);
      assert(typeof adapter.setup === "function", `${adapter.name} implements setup method`);
      assert(typeof adapter.verify === "function", `${adapter.name} implements verify method`);
      assert(typeof adapter.translateEvent === "function", `${adapter.name} provides translateEvent method`);
    }

    console.log("\n[Test 11] Testing Agent Task Protocol & MCP Transport operations...");
    const { createTask, executeTask, getTask, cancelTask } = await import("../../protocol/index.js");
    const protoTask = createTask({ goal: "Protocol verification" });
    assert(protoTask.status === "created", "createTask initializes task in created status");
    assert(protoTask.phase === "REQUEST", "createTask initializes task in REQUEST phase");

    const fetchedTask = getTask(protoTask.taskId);
    assert(fetchedTask.taskId === protoTask.taskId, "getTask retrieves active task by taskId");

    const execResult = await executeTask(protoTask.taskId);
    assert(execResult.status === "completed", "executeTask progresses through complete lifecycle");
    assert(execResult.phase === "COMPLETE", "executeTask reaches COMPLETE phase");

    const protoTask2 = createTask({ goal: "Cancellation verification" });
    const cancelResult = cancelTask(protoTask2.taskId, "Test cancellation");
    assert(cancelResult.status === "cancelled", "cancelTask marks task as cancelled");

    const { McpTransport } = await import("../../runtime/transports/mcp.js");
    const mcpTransport = new McpTransport();
    const listRes = await mcpTransport.handleRpcRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    assert(listRes.result?.tools?.length === 6, "MCP Transport exposes 6 Agent Task Protocol operations");
    assert(listRes.result?.tools?.some(t => t.name === "execute_task"), "MCP Transport exposes canonical execute_task");
    assert(listRes.result?.tools?.some(t => t.name === "create_task"), "MCP Transport exposes canonical create_task");

    const createRpcRes = await mcpTransport.handleRpcRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "create_task", arguments: { goal: "MCP Canonical RPC Test" } }
    });
    assert(createRpcRes.result?.structuredContent?.status === "created", "create_task executes via canonical MCP call");
    assert(createRpcRes.result?.content?.[0]?.text?.includes("created"), "create_task text includes serialized status");

    const execRpcRes = await mcpTransport.handleRpcRequest({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "praetor_execute_task", arguments: { goal: "MCP Legacy RPC Execute" } }
    });
    assert(execRpcRes.result?.structuredContent?.status === "completed", "praetor_execute_task completes via MCP legacy alias");

    const errRpcRes = await mcpTransport.handleRpcRequest({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "execute_task", arguments: {} }
    });
    assert(errRpcRes.result?.isError === true, "execute_task without args returns isError");
    assert(errRpcRes.result?.structuredContent?.code === "INVALID_TASK_REQUEST", "error contains typed code");

    const { PersistentTaskStore } = await import("../../protocol/store.js");
    const isolatedStore = new PersistentTaskStore(tempDir);
    isolatedStore.save({
      taskId: "task-persisted-999",
      sessionId: "session-999",
      goal: "Persisted disk goal",
      status: "completed",
      phase: "COMPLETE"
    });
    const loadedFromDisk = isolatedStore.load("task-persisted-999");
    assert(loadedFromDisk?.taskId === "task-persisted-999", "PersistentTaskStore recovers task directly from disk");
    assert(loadedFromDisk?.goal === "Persisted disk goal", "PersistentTaskStore preserves task goal on disk");

  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }

  console.log(`\n============================================================`);
  console.log(`Host Registry & Agnostic CLI Results: ${checksPassed} passed, ${checksFailed} failed`);
  console.log(`============================================================\n`);

  if (checksFailed > 0) {
    process.exit(1);
  }
}

runCliTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
