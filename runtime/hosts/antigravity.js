import fs from "node:fs";
import path from "node:path";
import { BaseHostAdapter, createHostToolInvocation, HOST_DECISIONS } from './contracts.js';
import { HostDriver } from './driver.js';
import { createSession } from '../session.js';
import { SessionState } from '../core/state.js';
import { AgentCatalog } from '../core/agents.js';

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PRAETOR_ROOT = path.resolve(__dirname, "../..");
const ANTIGRAVITY_TEMPLATE_PATH = path.join(PRAETOR_ROOT, "runtime", "hosts", "templates", "antigravity-hook.js");

export class AntigravityHostAdapter extends BaseHostAdapter {
  constructor({ driver = null } = {}) {
    super('antigravity', 'Antigravity IDE (Governed Execution Runtime)');
    this.driver = driver || new HostDriver();
  }

  detect(targetDir) {
    const agentsDir = path.join(targetDir, ".agents");
    const agentsMd = path.join(targetDir, "AGENTS.md");
    const hooksJson = path.join(agentsDir, "hooks.json");
    return fs.existsSync(hooksJson) || fs.existsSync(agentsDir) || fs.existsSync(agentsMd);
  }

  setup(targetDir, options = {}) {
    const rootDir = path.resolve(targetDir);
    const agentsDir = path.join(rootDir, ".agents");
    if (!fs.existsSync(agentsDir)) {
      fs.mkdirSync(agentsDir, { recursive: true });
    }

    const hookDest = path.join(agentsDir, "praetor-hook.js");
    if (!fs.existsSync(ANTIGRAVITY_TEMPLATE_PATH)) {
      throw new Error(`Antigravity hook template not found: ${ANTIGRAVITY_TEMPLATE_PATH}`);
    }

    let hookCode = fs.readFileSync(ANTIGRAVITY_TEMPLATE_PATH, "utf8");
    hookCode = hookCode.replace("{{PRAETOR_RUNTIME_ROOT}}", PRAETOR_ROOT.replace(/\\/g, "/"));

    if (!fs.existsSync(hookDest) || options.force) {
      fs.writeFileSync(hookDest, hookCode, "utf8");
    }

    // Official hooks.json schema: { "<hook-name>": { enabled, PreToolUse: [ { matcher, hooks: [ { type, command, timeout } ] } ] } }
    const hooksJsonPath = path.join(agentsDir, "hooks.json");
    let hooksConfig = {};
    if (fs.existsSync(hooksJsonPath)) {
      try {
        const existing = JSON.parse(fs.readFileSync(hooksJsonPath, "utf8").replace(/^\uFEFF/, ""));
        if (existing && typeof existing === "object" && !Array.isArray(existing)) {
          hooksConfig = existing;
        }
      } catch {}
    }

    hooksConfig["praetor-governance"] = {
      enabled: true,
      PreToolUse: [
        {
          matcher: "*",
          hooks: [
            {
              type: "command",
              command: "bun .agents/praetor-hook.js",
              timeout: 10
            }
          ]
        }
      ]
    };

    fs.writeFileSync(hooksJsonPath, JSON.stringify(hooksConfig, null, 2), "utf8");

    // Official mcp_config.json schema: { "mcpServers": { "<name>": { command, args, cwd, env } } }
    const mcpConfigPath = path.join(agentsDir, "mcp_config.json");
    let mcpConfig = { mcpServers: {} };
    if (fs.existsSync(mcpConfigPath)) {
      try {
        const existing = JSON.parse(fs.readFileSync(mcpConfigPath, "utf8"));
        if (existing && typeof existing === "object") {
          mcpConfig = existing;
        }
      } catch {}
    }
    if (!mcpConfig.mcpServers || typeof mcpConfig.mcpServers !== "object") {
      mcpConfig.mcpServers = {};
    }

    const cliPath = path.join(PRAETOR_ROOT, "bin", "praetor.js").replace(/\\/g, "/");
    mcpConfig.mcpServers.praetor = {
      command: "bun",
      args: [cliPath, "mcp"],
      cwd: rootDir.replace(/\\/g, "/"),
      env: { PRAETOR_HOME: PRAETOR_ROOT.replace(/\\/g, "/") }
    };

    fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2), "utf8");

    return {
      success: true,
      host: "antigravity",
      hookPath: hookDest,
      hooksJsonPath,
      mcpConfigPath
    };
  }

  verify(targetDir) {
    const rootDir = path.resolve(targetDir);
    const hookScript = path.join(rootDir, ".agents", "praetor-hook.js");
    if (!fs.existsSync(hookScript)) {
      throw new Error(`Antigravity hook script not found: ${hookScript}`);
    }

    const hooksJsonPath = path.join(rootDir, ".agents", "hooks.json");
    if (!fs.existsSync(hooksJsonPath)) {
      throw new Error(`Antigravity hooks.json not found: ${hooksJsonPath}`);
    }

    let hooksConfig;
    try {
      hooksConfig = JSON.parse(fs.readFileSync(hooksJsonPath, "utf8").replace(/^\uFEFF/, ""));
    } catch (err) {
      throw new Error(`Invalid hooks.json: ${err.message}`);
    }

    const hasPreToolUse = Object.values(hooksConfig).some(entry =>
      entry && typeof entry === "object" && Array.isArray(entry.PreToolUse) &&
      entry.PreToolUse.some(e =>
        e && Array.isArray(e.hooks) &&
        e.hooks.some(h => typeof h.command === "string" && h.command.includes("praetor"))
      )
    );
    if (!hasPreToolUse) {
      throw new Error("hooks.json has no PreToolUse handler invoking the Praetor hook");
    }

    const mcpConfigPath = path.join(rootDir, ".agents", "mcp_config.json");
    if (!fs.existsSync(mcpConfigPath)) {
      throw new Error(`Antigravity mcp_config.json not found: ${mcpConfigPath}`);
    }
    let mcpConfig;
    try {
      mcpConfig = JSON.parse(fs.readFileSync(mcpConfigPath, "utf8").replace(/^\uFEFF/, ""));
    } catch (err) {
      throw new Error(`Invalid mcp_config.json: ${err.message}`);
    }
    if (!mcpConfig.mcpServers?.praetor) {
      throw new Error("mcp_config.json is missing the 'praetor' MCP server entry");
    }

    function probe(payload) {
      const res = spawnSync("bun", [hookScript], {
        cwd: rootDir,
        input: JSON.stringify(payload) + "\n",
        encoding: "utf8"
      });
      if (res.error) throw res.error;
      return JSON.parse(res.stdout.trim());
    }

    const res1 = probe({
      toolCall: { name: "view_file", args: { AbsolutePath: "package.json" } },
      stepIdx: 1
    });
    if (res1.decision !== "allow") {
      throw new Error(`Probe view_file failed: expected allow, got ${res1.decision}`);
    }

    const res2 = probe({
      toolCall: { name: "run_command", args: { CommandLine: "git push --force origin main" } },
      stepIdx: 2
    });
    if (res2.decision !== "deny") {
      throw new Error(`Probe git push --force failed: expected deny, got ${res2.decision}`);
    }

    const emptyRes = spawnSync("bun", [hookScript], {
      cwd: rootDir,
      input: "\n",
      encoding: "utf8"
    });
    const parsedEmpty = JSON.parse(emptyRes.stdout.trim());
    if (parsedEmpty.decision !== "deny" || parsedEmpty.code !== "HOOK_FAIL_CLOSED") {
      throw new Error(`Probe empty stdin failed to fail-closed`);
    }

    return { success: true, host: "antigravity", hooksJsonPath, mcpConfigPath };
  }

  interceptToolCall(hostInvocation, session) {
    return this.driver.evaluateInvocation(hostInvocation, session);
  }

  static parseHookInput(rawStdin) {
    try {
      const parsed = JSON.parse(rawStdin);
      const toolName = parsed.tool_name || parsed.tool || parsed.name || parsed.toolCall?.name;
      const args = parsed.tool_input || parsed.args || parsed.arguments || parsed.toolCall?.args || {};
      const agentId = parsed.agent_id || 'orchestrator';
      const stepIdx = parsed.step_index || parsed.stepIdx || 0;
      const conversationId = parsed.conversation_id || parsed.conversationId || '';

      return createHostToolInvocation({
        host: 'antigravity',
        toolName,
        args,
        agentId,
        stepIdx,
        conversationId,
        metadata: parsed
      });
    } catch (err) {
      throw new Error(`Failed to parse Antigravity hook stdin JSON: ${err.message}`);
    }
  }

  static formatHookOutput(hostDecision) {
    return JSON.stringify({
      decision: hostDecision.decision,
      reason: hostDecision.reason,
      ...(hostDecision.code ? { code: hostDecision.code } : {}),
      ...(hostDecision.canonical_hash ? { canonical_hash: hostDecision.canonical_hash } : {})
    });
  }

  static evaluatePayload(payload, { cwd = process.cwd(), sessionFactory = null } = {}) {
    const convId = payload.conversationId || payload.conversation_id;
    let session = null;

    const sessionsRoot = path.join(cwd, '.agent', 'sessions');
    const statePath = convId ? path.join(sessionsRoot, convId, 'state.json') : null;
    if (statePath && fs.existsSync(statePath)) {
      const loadedState = SessionState.load(convId, sessionsRoot);
      const resolvedAgentId = loadedState.agentId || 'orchestrator';

      let agentDef = null;
      const agentsDir = path.join(cwd, 'agents');
      if (fs.existsSync(agentsDir) && resolvedAgentId) {
        try {
          const catalog = new AgentCatalog();
          catalog.loadFromDir(agentsDir);
          agentDef = catalog.get(resolvedAgentId);
        } catch {}
      }

      session = createSession({
        sessionId: convId,
        agentId: resolvedAgentId,
        initialPhase: loadedState.currentPhase || 'REQUEST',
        agentDefinition: agentDef,
        sessionsRoot,
        workspaceRoot: cwd,
        hydrate: true,
        emitStartEvent: false
      });
    } else if (typeof sessionFactory === 'function') {
      session = sessionFactory(payload);
    } else {
      session = createSession({
        sessionId: convId || `hook-${Date.now()}`,
        agentId: payload.agent_id || 'orchestrator',
        sessionsRoot
      });
    }

    const adapter = new AntigravityHostAdapter();
    const decision = adapter.interceptToolCall(payload, session);
    return adapter.formatResponse(decision);
  }

  static async runCli(sessionFactory = null) {
    let inputData = '';
    try {
      for await (const chunk of process.stdin) {
        inputData += chunk;
      }
    } catch (err) {
      process.stdout.write(JSON.stringify({
        decision: 'deny',
        code: 'HOOK_FAIL_CLOSED',
        reason: `Host Governance Hook Stdin Error: ${err.message}`
      }) + '\n');
      return;
    }

    try {
      if (!inputData.trim()) {
        process.stdout.write(JSON.stringify({
          decision: 'deny',
          code: 'HOOK_FAIL_CLOSED',
          reason: 'Host Governance Hook Error: Empty stdin received'
        }) + '\n');
        return;
      }

      const payload = JSON.parse(inputData);
      const formatted = AntigravityHostAdapter.evaluatePayload(payload, { sessionFactory });
      process.stdout.write(JSON.stringify(formatted) + '\n');
    } catch (err) {
      process.stdout.write(JSON.stringify({
        decision: 'deny',
        code: 'HOOK_FAIL_CLOSED',
        reason: `Host Governance Interceptor Error: ${err.message}`
      }) + '\n');
    }
  }
}

if (import.meta.main || (process.argv[1] && process.argv[1].endsWith('antigravity.js'))) {
  AntigravityHostAdapter.runCli().catch(err => {
    process.stdout.write(JSON.stringify({
      decision: 'deny',
      code: 'HOOK_FAIL_CLOSED',
      reason: `Fatal Antigravity hook error: ${err.message}`
    }) + '\n');
    process.exit(0);
  });
}
