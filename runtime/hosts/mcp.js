import { BaseHostAdapter } from './contracts.js';
import { McpTransport } from '../transports/mcp.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PRAETOR_ROOT = path.resolve(__dirname, '../..');

export class McpHostAdapter extends BaseHostAdapter {
  constructor() {
    super('mcp', 'Model Context Protocol (Universal Governed Task Transport)');
  }

  detect(targetDir) {
    const mcpJson = path.join(targetDir, 'mcp.json');
    const mcpConfigJson = path.join(targetDir, 'mcp_config.json');
    const dotMcp = path.join(targetDir, '.mcp');
    return fs.existsSync(mcpJson) || fs.existsSync(mcpConfigJson) || fs.existsSync(dotMcp);
  }

  setup(targetDir, options = {}) {
    const mcpConfigPath = path.join(targetDir, 'mcp.json');
    let mcpConfig = { mcpServers: {} };

    if (fs.existsSync(mcpConfigPath)) {
      try {
        mcpConfig = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
        if (!mcpConfig.mcpServers) mcpConfig.mcpServers = {};
      } catch {}
    }

    const cliPath = path.join(PRAETOR_ROOT, 'bin', 'praetor.js').replace(/\\/g, '/');
    mcpConfig.mcpServers['praetor'] = {
      command: 'bun',
      args: [cliPath, 'mcp']
    };

    fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2), 'utf8');
    return {
      success: true,
      host: 'mcp',
      mcpConfigPath
    };
  }

  verify(targetDir) {
    const mcpConfigPath = path.join(targetDir, 'mcp.json');
    if (!fs.existsSync(mcpConfigPath)) {
      throw new Error(`MCP config not found at: ${mcpConfigPath}`);
    }
    const parsed = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
    if (!parsed.mcpServers?.praetor) {
      throw new Error("Missing 'praetor' entry in mcpServers");
    }
    return { success: true, host: 'mcp' };
  }

  static async runCli() {
    return McpTransport.runStdio();
  }
}
