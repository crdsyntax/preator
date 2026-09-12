import fs from "node:fs";
import path from "node:path";
import { BaseHostAdapter } from './contracts.js';
import { HostDriver } from './driver.js';

export class CodexHostAdapter extends BaseHostAdapter {
  constructor({ driver = null } = {}) {
    super('codex', 'Codex CLI (Governed Execution Runtime)');
    this.driver = driver || new HostDriver();
  }

  detect(targetDir) {
    const dotCodex = path.join(targetDir, ".codex");
    const codexJson = path.join(targetDir, "codex.json");
    return fs.existsSync(dotCodex) || fs.existsSync(codexJson);
  }

  setup(targetDir, options = {}) {
    const dotCodex = path.join(targetDir, ".codex");
    if (!fs.existsSync(dotCodex)) {
      fs.mkdirSync(dotCodex, { recursive: true });
    }

    const codexConfigPath = path.join(dotCodex, "config.json");
    let config = { governance: { enabled: true, engine: "praetor" } };
    fs.writeFileSync(codexConfigPath, JSON.stringify(config, null, 2), "utf8");

    return {
      success: true,
      host: "codex",
      configPath: codexConfigPath
    };
  }

  verify(targetDir) {
    const dotCodex = path.join(targetDir, ".codex");
    const codexConfigPath = path.join(dotCodex, "config.json");
    if (!fs.existsSync(codexConfigPath)) {
      throw new Error(`Codex config not found at: ${codexConfigPath}`);
    }
    return { success: true, host: "codex" };
  }

  interceptToolCall(hostInvocation, session) {
    return this.driver.evaluateInvocation(hostInvocation, session);
  }

  async executeTask(taskRequest, session) {
    return super.executeTask(taskRequest, session);
  }
}
