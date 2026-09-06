import { RISK_LEVELS, inferRiskLevel } from './contracts.js';

export class ToolDefinition {
  constructor({
    name,
    description = '',
    parameters = {},
    required = [],
    riskLevel = null,
    requiresApproval = false,
    timeoutMs = 30000,
    executor = async () => ({})
  }) {
    if (!name || typeof name !== 'string') {
      throw new Error("ToolDefinition requires string 'name'");
    }
    this.name = name;
    this.description = description;
    this.parameters = parameters;
    this.required = Array.isArray(required) ? required : [];
    this.riskLevel = riskLevel && RISK_LEVELS[riskLevel] ? riskLevel : inferRiskLevel(name);
    this.requiresApproval = Boolean(requiresApproval);
    this.timeoutMs = Number(timeoutMs) > 0 ? Number(timeoutMs) : 30000;
    this.executor = executor;
  }
}

export class ToolRegistry {
  constructor() {
    this.tools = new Map();
  }

  register(toolDef) {
    if (!(toolDef instanceof ToolDefinition)) {
      toolDef = new ToolDefinition(toolDef);
    }
    this.tools.set(toolDef.name, toolDef);
    return toolDef;
  }

  get(name) {
    return this.tools.get(name) || null;
  }

  has(name) {
    return this.tools.has(name);
  }

  list() {
    return Array.from(this.tools.values());
  }

  validateArguments(toolName, args = {}) {
    const tool = this.get(toolName);
    if (!tool) {
      return { valid: false, error: `Tool '${toolName}' not found in registry` };
    }

    for (const field of tool.required) {
      if (args[field] === undefined || args[field] === null || args[field] === '') {
        return { valid: false, error: `Missing required argument '${field}' for tool '${toolName}'` };
      }
    }

    return { valid: true, error: null };
  }
}
