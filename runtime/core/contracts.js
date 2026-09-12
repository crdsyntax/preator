import crypto from 'node:crypto';

export const PHASES = Object.freeze([
  'REQUEST',
  'ANALYZE',
  'PLAN',
  'REVIEW',
  'EXECUTE',
  'VERIFY',
  'DOCUMENT',
  'COMPLETE'
]);

export const ALLOWED_WRITE_PHASES = Object.freeze(new Set(['EXECUTE', 'DOCUMENT']));

export const WRITE_TOOLS = Object.freeze(new Set([
  'write',
  'edit',
  'patch',
  'replace_file_content',
  'write_to_file',
  'multi_replace_file_content'
]));

export const TRANSITION_GRAPH = Object.freeze({
  REQUEST: Object.freeze(new Set(['ANALYZE'])),
  ANALYZE: Object.freeze(new Set(['PLAN'])),
  PLAN: Object.freeze(new Set(['REVIEW'])),
  REVIEW: Object.freeze(new Set(['EXECUTE', 'PLAN'])),
  EXECUTE: Object.freeze(new Set(['VERIFY'])),
  VERIFY: Object.freeze(new Set(['DOCUMENT', 'ANALYZE'])),
  DOCUMENT: Object.freeze(new Set(['COMPLETE'])),
  COMPLETE: Object.freeze(new Set([]))
});

export const RISK_LEVELS = Object.freeze({
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL'
});

export const TOOL_STATUS = Object.freeze({
  OK: 'OK',
  DENIED: 'DENIED',
  ERROR: 'ERROR'
});

export const ERROR_CATEGORIES = Object.freeze({
  POLICY_DENIED: 'POLICY_DENIED',
  LIFECYCLE_DENIED: 'LIFECYCLE_DENIED',
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
  TOOL_NOT_FOUND: 'TOOL_NOT_FOUND',
  INVALID_ARGUMENTS: 'INVALID_ARGUMENTS',
  EXECUTION_FAILED: 'EXECUTION_FAILED',
  TIMEOUT: 'TIMEOUT',
  TOCTOU_MISMATCH_DENIED: 'TOCTOU_MISMATCH_DENIED'
});

export function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    deepFreeze(obj[key]);
  }
  return obj;
}

export function createToolError({ code, message, category, details = null }) {
  if (!code || typeof code !== 'string') {
    throw new Error("ToolError requires a string 'code'");
  }
  if (!message || typeof message !== 'string') {
    throw new Error("ToolError requires a string 'message'");
  }
  if (!category || !ERROR_CATEGORIES[category]) {
    throw new Error(`ToolError invalid category '${category}'. Valid: ${Object.keys(ERROR_CATEGORIES).join(', ')}`);
  }

  return Object.freeze({
    code,
    message,
    category,
    details: details ? Object.freeze({ ...details }) : null
  });
}

export function inferRiskLevel(toolName, args = {}) {
  const highRiskTools = new Set(['write', 'edit', 'patch', 'replace_file_content', 'write_to_file', 'multi_replace_file_content']);
  if (highRiskTools.has(toolName)) {
    return RISK_LEVELS.HIGH;
  }

  if (toolName === 'bash' || toolName === 'run_command') {
    const cmd = String(args.cmd || args.CommandLine || '');
    if (/git\s+push/i.test(cmd) || /rm\s+-rf/i.test(cmd) || /reset\s+--hard/i.test(cmd)) {
      return RISK_LEVELS.CRITICAL;
    }
    return RISK_LEVELS.MEDIUM;
  }

  const lowRiskTools = new Set(['read', 'view_file', 'list_dir', 'grep_search', 'search_web']);
  if (lowRiskTools.has(toolName)) {
    return RISK_LEVELS.LOW;
  }

  return RISK_LEVELS.MEDIUM;
}

export function createToolRequest({
  requestId,
  runId,
  agentId = 'orchestrator',
  toolName,
  args = {},
  phase,
  riskLevel = null,
  requestedAt = null
}) {
  if (!runId || typeof runId !== 'string') {
    throw new Error("ToolRequest requires 'runId'");
  }
  if (!toolName || typeof toolName !== 'string') {
    throw new Error("ToolRequest requires 'toolName'");
  }
  if (!phase || typeof phase !== 'string') {
    throw new Error("ToolRequest requires 'phase'");
  }

  const resolvedRisk = riskLevel && RISK_LEVELS[riskLevel] ? riskLevel : inferRiskLevel(toolName, args);

  return Object.freeze({
    request_id: requestId || `req-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    run_id: runId,
    agent_id: agentId,
    tool_name: toolName,
    arguments: Object.freeze({ ...args }),
    phase,
    risk_level: resolvedRisk,
    requested_at: requestedAt || new Date().toISOString()
  });
}

export function validateToolRequest(request) {
  if (!request || typeof request !== 'object') {
    return { valid: false, error: 'ToolRequest must be a non-null object' };
  }
  const required = ['request_id', 'run_id', 'agent_id', 'tool_name', 'arguments', 'phase', 'risk_level'];
  for (const field of required) {
    if (request[field] === undefined || request[field] === null) {
      return { valid: false, error: `Missing required field '${field}' in ToolRequest` };
    }
  }
  if (!PHASES.includes(request.phase)) {
    return { valid: false, error: `Invalid phase '${request.phase}' in ToolRequest. Valid: ${PHASES.join(', ')}` };
  }
  if (!RISK_LEVELS[request.risk_level]) {
    return { valid: false, error: `Invalid risk_level '${request.risk_level}'. Valid: ${Object.keys(RISK_LEVELS).join(', ')}` };
  }
  return { valid: true, error: null };
}

export function createToolResult({
  requestId,
  status,
  output = null,
  error = null,
  durationMs = 0,
  executedAt = null
}) {
  if (!requestId || typeof requestId !== 'string') {
    throw new Error("ToolResult requires string 'requestId'");
  }
  if (!status || !TOOL_STATUS[status]) {
    throw new Error(`Invalid status '${status}'. Valid: ${Object.keys(TOOL_STATUS).join(', ')}`);
  }

  if (status === TOOL_STATUS.ERROR || status === TOOL_STATUS.DENIED) {
    if (!error) {
      throw new Error(`ToolResult with status '${status}' requires an 'error' object`);
    }
  }

  return Object.freeze({
    request_id: requestId,
    status,
    output: output !== null && typeof output === 'object' ? Object.freeze({ ...output }) : output,
    error: error || null,
    duration_ms: Math.max(0, durationMs),
    executed_at: executedAt || new Date().toISOString()
  });
}

export function canonicalizeToolArgs(toolName, rawArgs = {}) {
  const args = rawArgs && typeof rawArgs === 'object' ? { ...rawArgs } : {};
  const canonical = {};

  const writeTools = new Set(['write', 'edit', 'patch', 'replace_file_content', 'write_to_file', 'multi_replace_file_content']);
  const shellTools = new Set(['bash', 'run_command', 'shell', 'exec']);
  const readTools = new Set(['read', 'view_file', 'read_url_content', 'list_dir', 'grep_search']);

  if (writeTools.has(toolName)) {
    canonical.path = String(args.path || args.TargetFile || args.target || args.file || '').replace(/\\/g, '/');
    canonical.content = args.content !== undefined
      ? String(args.content)
      : (args.ReplacementContent !== undefined ? String(args.ReplacementContent) : (args.CodeContent !== undefined ? String(args.CodeContent) : ''));
    if (args.Instruction !== undefined) canonical.instruction = String(args.Instruction);
    if (args.Description !== undefined) canonical.description = String(args.Description);
  } else if (shellTools.has(toolName)) {
    canonical.command = String(args.command || args.CommandLine || args.cmd || '');
    if (args.Cwd || args.cwd) canonical.cwd = String(args.cwd || args.Cwd).replace(/\\/g, '/');
  } else if (readTools.has(toolName)) {
    canonical.path = String(args.path || args.AbsolutePath || args.SearchPath || args.DirectoryPath || args.target || args.Url || '').replace(/\\/g, '/');
    if (args.Query !== undefined) canonical.query = String(args.Query);
  } else {
    for (const k of Object.keys(args).sort()) {
      canonical[k] = args[k];
    }
  }
  return canonical;
}

export function computeCanonicalHash(toolName, rawArgs = {}) {
  const canonical = canonicalizeToolArgs(toolName, rawArgs);
  const sortedKeys = Object.keys(canonical).sort();
  const sortedObj = {};
  for (const k of sortedKeys) {
    sortedObj[k] = canonical[k];
  }
  const payload = `${toolName}:${JSON.stringify(sortedObj)}`;
  return crypto.createHash('sha256').update(payload).digest('hex');
}
