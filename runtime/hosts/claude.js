import fs from "node:fs";
import path from "node:path";
import { BaseHostAdapter } from './contracts.js';
import { HostDriver } from './driver.js';

export class ClaudeHostAdapter extends BaseHostAdapter {
  constructor({ driver = null } = {}) {
    super('claude', 'Claude Code (Governed Execution Runtime)');
    this.driver = driver || new HostDriver();
  }

  detect(targetDir) {
    const claudeMd = path.join(targetDir, "CLAUDE.md");
    const dotClaude = path.join(targetDir, ".claude");
    const claudeJson = path.join(targetDir, "claude.json");
    return fs.existsSync(claudeMd) || fs.existsSync(dotClaude) || fs.existsSync(claudeJson);
  }

  setup(targetDir, options = {}) {
    const dotClaude = path.join(targetDir, ".claude");
    if (!fs.existsSync(dotClaude)) {
      fs.mkdirSync(dotClaude, { recursive: true });
    }

    const settingsPath = path.join(dotClaude, "settings.json");
    let settings = {};
    if (fs.existsSync(settingsPath)) {
      try {
        settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      } catch {}
    }

    settings.mcpServers = settings.mcpServers || {};
    settings.mcpServers["praetor"] = {
      command: "praetor",
      args: ["mcp"]
    };

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf8");
    return {
      success: true,
      host: "claude",
      settingsPath
    };
  }

  verify(targetDir) {
    const dotClaude = path.join(targetDir, ".claude");
    const settingsPath = path.join(dotClaude, "settings.json");
    if (!fs.existsSync(settingsPath)) {
      throw new Error(`Claude Code settings not found at: ${settingsPath}`);
    }
    return { success: true, host: "claude" };
  }

  interceptToolCall(hostInvocation, session) {
    return this.driver.evaluateInvocation(hostInvocation, session);
  }

  async executeTask(taskRequest, session) {
    return super.executeTask(taskRequest, session);
  }
}
