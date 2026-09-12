import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deepFreeze } from './contracts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FRAMEWORK_AGENTS_DIR = path.resolve(__dirname, '../../agents');

export function validateAgentDefinition(def) {
  if (!def || typeof def !== 'object') {
    return { valid: false, error: 'AgentDefinition must be an object' };
  }

  const { identity, capabilities } = def;
  if (!identity || typeof identity !== 'object') {
    return { valid: false, error: "Missing 'identity' block in AgentDefinition" };
  }
  if (!identity.id || typeof identity.id !== 'string') {
    return { valid: false, error: "Missing string 'identity.id' in AgentDefinition" };
  }
  if (!identity.role || !['root', 'specialist'].includes(identity.role)) {
    return { valid: false, error: "Invalid 'identity.role'. Must be 'root' or 'specialist'" };
  }
  if (!identity.type || !['primary', 'subagent'].includes(identity.type)) {
    return { valid: false, error: "Invalid 'identity.type'. Must be 'primary' or 'subagent'" };
  }

  if (!capabilities || typeof capabilities !== 'object') {
    return { valid: false, error: "Missing 'capabilities' block in AgentDefinition" };
  }
  if (!Array.isArray(capabilities.tools)) {
    return { valid: false, error: "'capabilities.tools' must be an array" };
  }
  if (typeof capabilities.can_delegate !== 'boolean') {
    return { valid: false, error: "'capabilities.can_delegate' must be a boolean" };
  }
  if (!Array.isArray(capabilities.delegation_targets)) {
    return { valid: false, error: "'capabilities.delegation_targets' must be an array" };
  }

  return { valid: true, error: null };
}

export function createAgentDefinition({
  identity,
  capabilities,
  constraints = [],
  instructions = ''
}) {
  const safeIdentity = {
    id: identity?.id,
    name: identity?.name || identity?.id,
    role: identity?.role || 'specialist',
    type: identity?.type || 'subagent',
    version: identity?.version || '1.0'
  };

  const safeCapabilities = {
    tools: Array.isArray(capabilities?.tools) ? [...capabilities.tools] : [],
    can_delegate: Boolean(capabilities?.can_delegate),
    delegation_targets: Array.isArray(capabilities?.delegation_targets) ? [...capabilities.delegation_targets] : []
  };

  const def = {
    identity: safeIdentity,
    capabilities: safeCapabilities,
    constraints: Array.isArray(constraints) && constraints.length > 0
      ? [...constraints]
      : ['Adhere strictly to governed runtime lifecycle', 'Operate only within declared capabilities'],
    instructions: typeof instructions === 'string' ? instructions : ''
  };

  const validation = validateAgentDefinition(def);
  if (!validation.valid) {
    const err = new Error(`AGENT_DEFINITION_INVALID: ${validation.error}`);
    err.code = 'AGENT_DEFINITION_INVALID';
    throw err;
  }

  return deepFreeze(def);
}

export function parseFrontmatter(rawYaml) {
  const result = {};
  const lines = rawYaml.split(/\r?\n/);
  let currentKey = null;
  let currentList = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    if (line.startsWith('- ') && currentKey && currentList) {
      const item = line.slice(2).trim().replace(/^['"]|['"]$/g, '');
      currentList.push(item);
      continue;
    }

    const colon = line.indexOf(':');
    if (colon !== -1) {
      if (currentList && currentKey) {
        result[currentKey] = currentList;
        currentList = null;
      }
      const key = line.slice(0, colon).trim();
      const val = line.slice(colon + 1).trim();

      if (val === '' || val === '[]') {
        if (val === '[]') {
          result[key] = [];
        } else {
          currentKey = key;
          currentList = [];
        }
      } else if (val.startsWith('[') && val.endsWith(']')) {
        const items = val
          .slice(1, -1)
          .split(',')
          .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
          .filter(Boolean);
        result[key] = items;
      } else if (val === 'true' || val === 'false') {
        result[key] = val === 'true';
      } else {
        result[key] = val.replace(/^['"]|['"]$/g, '');
      }
    }
  }

  if (currentList && currentKey) {
    result[currentKey] = currentList;
  }

  return result;
}

export function parseMarkdownAgent(content, filename = 'agent.md') {
  let frontmatter = {};
  let body = content;

  if (content.startsWith('---')) {
    const end = content.indexOf('---', 3);
    if (end !== -1) {
      const rawYaml = content.slice(3, end).trim();
      body = content.slice(end + 3).trim();
      frontmatter = parseFrontmatter(rawYaml);
    }
  }

  const baseName = path.basename(filename, '.md');
  const parentDir = path.basename(path.dirname(filename));
  const derivedId = (parentDir && parentDir !== 'agents' && parentDir !== '.')
    ? `${parentDir}-${baseName}`
    : baseName;
  const agentId = frontmatter.name || frontmatter.id || derivedId;
  const isPrimary = frontmatter.mode === 'primary' || frontmatter.role === 'root';

  const role = frontmatter.role || (isPrimary ? 'root' : 'specialist');
  const type = frontmatter.mode || (isPrimary ? 'primary' : 'subagent');

  const declaredTools = frontmatter.tools || frontmatter.allowed_tools;
  const tools = Array.isArray(declaredTools) ? declaredTools : [];

  const canDelegate = typeof frontmatter.can_delegate === 'boolean'
    ? frontmatter.can_delegate
    : (isPrimary ? true : false);

  const declaredTargets = frontmatter.delegation_targets || frontmatter.allowed_delegations;
  const delegationTargets = Array.isArray(declaredTargets) ? declaredTargets : [];

  return createAgentDefinition({
    identity: {
      id: agentId,
      name: frontmatter.name || agentId,
      role,
      type,
      version: frontmatter.version || '1.0'
    },
    capabilities: {
      tools,
      can_delegate: canDelegate,
      delegation_targets: delegationTargets
    },
    constraints: Array.isArray(frontmatter.constraints) ? frontmatter.constraints : [],
    instructions: body
  });
}

export function loadAgentFromMarkdown(filePath) {
  if (!fs.existsSync(filePath)) {
    const err = new Error(`Agent file not found: ${filePath}`);
    err.code = 'AGENT_FILE_NOT_FOUND';
    throw err;
  }
  let content = fs.readFileSync(filePath, 'utf8');
  if (content.charCodeAt(0) === 0xFEFF) {
    content = content.slice(1);
  }
  return parseMarkdownAgent(content, filePath);
}

export class AgentCatalog {
  constructor() {
    this.agents = new Map();
  }

  register(agentDefinition) {
    const val = validateAgentDefinition(agentDefinition);
    if (!val.valid) {
      throw new Error(`Cannot register invalid AgentDefinition: ${val.error}`);
    }
    this.agents.set(agentDefinition.identity.id, deepFreeze(agentDefinition));
    return agentDefinition;
  }

  get(agentId) {
    return this.agents.get(agentId) || null;
  }

  has(agentId) {
    return this.agents.has(agentId);
  }

  list() {
    return Array.from(this.agents.values());
  }

  loadFromDir(dirPath) {
    if (!fs.existsSync(dirPath)) return [];
    const loaded = [];
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dirPath, e.name);
      if (e.isDirectory()) {
        loaded.push(...this.loadFromDir(full));
      } else if (e.name.endsWith('.md') && !e.name.startsWith('agent_runtime') && e.name !== 'README.md') {
        try {
          const agent = loadAgentFromMarkdown(full);
          this.register(agent);
          loaded.push(agent);
        } catch (err) {

        }
      }
    }
    return loaded;
  }
}

let defaultCatalogInstance = null;

export function getDefaultAgentCatalog(agentsDir = null) {
  if (defaultCatalogInstance && !agentsDir) {
    return defaultCatalogInstance;
  }
  const catalog = new AgentCatalog();
  if (fs.existsSync(FRAMEWORK_AGENTS_DIR)) {
    catalog.loadFromDir(FRAMEWORK_AGENTS_DIR);
  }
  if (agentsDir && fs.existsSync(agentsDir) && agentsDir !== FRAMEWORK_AGENTS_DIR) {
    catalog.loadFromDir(agentsDir);
  }
  if (!agentsDir) {
    defaultCatalogInstance = catalog;
  }
  return catalog;
}
