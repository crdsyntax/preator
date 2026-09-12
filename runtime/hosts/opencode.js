import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BaseHostAdapter } from './contracts.js';
import { HostDriver } from './driver.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PRAETOR_ROOT = path.resolve(__dirname, "../..");
const OPENCODE_PLUGIN_TEMPLATE_PATH = path.join(PRAETOR_ROOT, "runtime", "hosts", "templates", "opencode-plugin.js");

export class OpenCodeHostAdapter extends BaseHostAdapter {
  constructor({ driver = null } = {}) {
    super('opencode', 'OpenCode AI Coding Assistant (Governed Execution Runtime)');
    this.driver = driver || new HostDriver();
  }

  detect(targetDir) {
    const rootJson = path.join(targetDir, "opencode.json");
    const dotOpenCode = path.join(targetDir, ".opencode");
    const dotJson = path.join(dotOpenCode, "opencode.json");
    return fs.existsSync(rootJson) || fs.existsSync(dotJson) || fs.existsSync(dotOpenCode);
  }

  setup(targetDir, options = {}) {
    const dotOpenCode = path.join(targetDir, ".opencode");
    if (!fs.existsSync(dotOpenCode)) {
      fs.mkdirSync(dotOpenCode, { recursive: true });
    }

    const dotConfigPath = path.join(dotOpenCode, "opencode.json");
    const rootConfigPath = path.join(targetDir, "opencode.json");
    const targetConfigPath = fs.existsSync(rootConfigPath) && !fs.existsSync(dotConfigPath)
      ? rootConfigPath
      : dotConfigPath;

    let config = {
      $schema: "https://opencode.ai/config.json",
      mcp: {}
    };

    if (fs.existsSync(targetConfigPath)) {
      try {
        config = JSON.parse(fs.readFileSync(targetConfigPath, "utf8"));
      } catch {}
    }

    const cliPath = path.join(PRAETOR_ROOT, "bin", "praetor.js").replace(/\\/g, "/");
    const praetorEntry = {
      type: "local",
      command: ["bun", cliPath, "mcp"],
      enabled: true
    };

    const instructionsPath = path.join(dotOpenCode, "instructions.md");
    const instructionsContent = `When a task is executed under Praetor governance or via /praetor, invoke praetor_execute_task with the goal, present the governed result, and stop without performing unguided tool calls or secondary reasoning.\n`;
    fs.writeFileSync(instructionsPath, instructionsContent, "utf8");

    config.instructions = Array.isArray(config.instructions) ? config.instructions : [];
    if (!config.instructions.includes(".opencode/instructions.md")) {
      config.instructions.push(".opencode/instructions.md");
    }
    config.mcp = config.mcp || {};
    config.mcp["praetor"] = praetorEntry;

    fs.writeFileSync(dotConfigPath, JSON.stringify(config, null, 2), "utf8");
    fs.writeFileSync(rootConfigPath, JSON.stringify(config, null, 2), "utf8");

    const commandsDir = path.join(dotOpenCode, "commands");
    if (!fs.existsSync(commandsDir)) {
      fs.mkdirSync(commandsDir, { recursive: true });
    }

    const commandMdPath = path.join(commandsDir, "praetor.md");
    const commandContent = `---
description: Execute task under Praetor governance
---

$ARGUMENTS
`;
    fs.writeFileSync(commandMdPath, commandContent, "utf8");

    if (!fs.existsSync(OPENCODE_PLUGIN_TEMPLATE_PATH)) {
      throw new Error(`OpenCode plugin template not found: ${OPENCODE_PLUGIN_TEMPLATE_PATH}`);
    }
    const pluginDir = path.join(dotOpenCode, "plugin");
    if (!fs.existsSync(pluginDir)) {
      fs.mkdirSync(pluginDir, { recursive: true });
    }
    const pluginPath = path.join(pluginDir, "praetor.js");
    let pluginCode = fs.readFileSync(OPENCODE_PLUGIN_TEMPLATE_PATH, "utf8");
    pluginCode = pluginCode.replace("{{PRAETOR_RUNTIME_ROOT}}", PRAETOR_ROOT.replace(/\\/g, "/"));
    fs.writeFileSync(pluginPath, pluginCode, "utf8");

    return {
      success: true,
      host: "opencode",
      configPath: dotConfigPath,
      commandPath: commandMdPath,
      pluginPath
    };
  }

  verify(targetDir) {
    const dotConfigPath = path.join(targetDir, ".opencode", "opencode.json");
    const rootConfigPath = path.join(targetDir, "opencode.json");
    const activePath = fs.existsSync(dotConfigPath) ? dotConfigPath : rootConfigPath;

    if (!fs.existsSync(activePath)) {
      throw new Error(`OpenCode config not found in ${targetDir}`);
    }

    const parsed = JSON.parse(fs.readFileSync(activePath, "utf8"));
    if (!parsed.mcp?.praetor) {
      throw new Error(`Missing 'mcp.praetor' entry in ${activePath}`);
    }

    const commandMdPath = path.join(targetDir, ".opencode", "commands", "praetor.md");
    if (!fs.existsSync(commandMdPath)) {
      throw new Error(`OpenCode command template not found: ${commandMdPath}`);
    }

    const pluginPath = path.join(targetDir, ".opencode", "plugin", "praetor.js");
    if (!fs.existsSync(pluginPath)) {
      throw new Error(`OpenCode governance plugin not found: ${pluginPath}`);
    }

    return { success: true, host: "opencode", configPath: activePath, commandPath: commandMdPath, pluginPath };
  }

  interceptToolCall(hostInvocation, session) {
    return this.driver.evaluateInvocation(hostInvocation, session);
  }

  async executeTask(taskRequest, session) {
    return super.executeTask(taskRequest, session);
  }
}
