import { AntigravityHostAdapter } from './antigravity.js';
import { McpHostAdapter } from './mcp.js';
import { OpenCodeHostAdapter } from './opencode.js';
import { ClaudeHostAdapter } from './claude.js';
import { CodexHostAdapter } from './codex.js';

export class HostRegistry {
  constructor() {
    this.adapters = new Map();
    this.register(new AntigravityHostAdapter());
    this.register(new McpHostAdapter());
    this.register(new OpenCodeHostAdapter());
    this.register(new ClaudeHostAdapter());
    this.register(new CodexHostAdapter());
  }

  register(adapter) {
    if (!adapter || !adapter.name) {
      throw new Error("Invalid HostAdapter registration: missing adapter name");
    }
    this.adapters.set(adapter.name.toLowerCase(), adapter);
    return adapter;
  }

  get(hostName) {
    if (!hostName) return null;
    return this.adapters.get(String(hostName).toLowerCase()) || null;
  }

  has(hostName) {
    if (!hostName) return false;
    return this.adapters.has(String(hostName).toLowerCase());
  }

  list() {
    return Array.from(this.adapters.values());
  }

  detect(targetDir) {
    const matched = [];
    for (const adapter of this.adapters.values()) {
      try {
        if (adapter.detect(targetDir)) {
          matched.push(adapter);
        }
      } catch {}
    }
    return matched;
  }
}

export const defaultHostRegistry = new HostRegistry();
