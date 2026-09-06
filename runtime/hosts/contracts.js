import { deepFreeze, computeCanonicalHash, canonicalizeToolArgs } from '../core/contracts.js';

export { computeCanonicalHash, canonicalizeToolArgs };

export const HOST_DECISIONS = Object.freeze({
  ALLOW: 'allow',
  DENY: 'deny',
  ASK: 'ask',
  FORCE_ASK: 'force_ask'
});

export function validateHostToolInvocation(inv) {
  if (!inv || typeof inv !== 'object') {
    return { valid: false, error: 'HostToolInvocation must be an object' };
  }
  if (!inv.tool_name || typeof inv.tool_name !== 'string') {
    return { valid: false, error: "Missing string 'tool_name' in HostToolInvocation" };
  }
  if (typeof inv.args !== 'object' || inv.args === null) {
    return { valid: false, error: "'args' must be an object in HostToolInvocation" };
  }
  return { valid: true, error: null };
}

export function createHostToolInvocation({
  host = 'generic',
  toolName,
  args = {},
  agentId = 'orchestrator',
  stepIdx = 0,
  conversationId = '',
  metadata = {}
}) {
  const canonicalArgs = canonicalizeToolArgs(toolName, args);
  const canonicalHash = computeCanonicalHash(toolName, args);

  const inv = {
    host,
    tool_name: toolName,
    args: { ...args },
    canonical_args: canonicalArgs,
    canonical_hash: canonicalHash,
    agent_id: agentId,
    step_idx: Number(stepIdx) || 0,
    conversation_id: String(conversationId || ''),
    metadata: { ...metadata },
    timestamp: new Date().toISOString()
  };

  const validation = validateHostToolInvocation(inv);
  if (!validation.valid) {
    const err = new Error(`HOST_TOOL_INVOCATION_INVALID: ${validation.error}`);
    err.code = 'HOST_TOOL_INVOCATION_INVALID';
    throw err;
  }

  return deepFreeze(inv);
}

export function createHostDecision({
  decision = HOST_DECISIONS.ALLOW,
  reason = '',
  code = null,
  category = null,
  canonicalTool = null,
  canonicalArgs = null,
  canonicalHash = null,
  permissionOverrides = [],
  overwrite = null
}) {
  if (!Object.values(HOST_DECISIONS).includes(decision)) {
    throw new Error(`Invalid HostDecision: ${decision}. Must be one of: ${Object.values(HOST_DECISIONS).join(', ')}`);
  }

  return deepFreeze({
    decision,
    reason: typeof reason === 'string' ? reason : '',
    code: code || null,
    category: category || null,
    canonical_tool: canonicalTool || null,
    canonical_args: canonicalArgs ? { ...canonicalArgs } : null,
    canonical_hash: canonicalHash || null,
    permissionOverrides: Array.isArray(permissionOverrides) ? [...permissionOverrides] : [],
    overwrite: overwrite && typeof overwrite === 'object' ? { ...overwrite } : null,
    decided_at: new Date().toISOString()
  });
}

export class BaseHostAdapter {
  constructor(name = 'base-host') {
    this.name = name;
  }

  interceptToolCall(hostInvocation, session) {
    throw new Error(`interceptToolCall() must be implemented by HostAdapter '${this.name}'`);
  }

  formatResponse(hostDecision) {
    return {
      decision: hostDecision.decision,
      reason: hostDecision.reason,
      ...(hostDecision.code ? { code: hostDecision.code } : {}),
      ...(hostDecision.canonical_hash ? { canonical_hash: hostDecision.canonical_hash } : {}),
      ...(hostDecision.permissionOverrides?.length > 0 ? { permissionOverrides: hostDecision.permissionOverrides } : {}),
      ...(hostDecision.overwrite ? { overwrite: hostDecision.overwrite } : {})
    };
  }
}
