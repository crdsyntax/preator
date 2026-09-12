import { deepFreeze } from '../core/contracts.js';

export const TURN_TYPES = Object.freeze({
  MESSAGE: 'MESSAGE',
  TOOL_CALLS: 'TOOL_CALLS',
  TRANSITION: 'TRANSITION',
  COMPLETE: 'COMPLETE'
});

export const RECOVERY_OUTCOMES = Object.freeze({
  RECOVERED: 'RECOVERED',
  RETRIED: 'RETRIED',
  ABORTED: 'ABORTED'
});

export function validateModelTurnRequest(req) {
  if (!req || typeof req !== 'object') {
    return { valid: false, error: 'ModelTurnRequest must be an object' };
  }
  if (!req.run_id || typeof req.run_id !== 'string') {
    return { valid: false, error: "Missing string 'run_id' in ModelTurnRequest" };
  }
  if (!req.agent_id || typeof req.agent_id !== 'string') {
    return { valid: false, error: "Missing string 'agent_id' in ModelTurnRequest" };
  }
  if (!req.current_phase || typeof req.current_phase !== 'string') {
    return { valid: false, error: "Missing string 'current_phase' in ModelTurnRequest" };
  }
  if (!Array.isArray(req.available_tools)) {
    return { valid: false, error: "'available_tools' must be an array" };
  }
  return { valid: true, error: null };
}

export function createModelTurnRequest({
  runId,
  agentId,
  currentPhase,
  agentDefinition = null,
  contextBundle = null,
  history = [],
  availableTools = [],
  skills = [],
  metadata = {}
}) {
  const req = {
    run_id: runId,
    agent_id: agentId,
    current_phase: currentPhase,
    agent_definition: agentDefinition ? { ...agentDefinition } : null,
    context_bundle: contextBundle ? { ...contextBundle } : null,
    history: Array.isArray(history) ? [...history] : [],
    available_tools: Array.isArray(availableTools) ? [...availableTools] : [],
    skills: Array.isArray(skills) ? skills.map(s => ({
      id: s.id,
      name: s.name,
      description: s.description || '',
      instructions: s.instructions || ''
    })) : [],
    metadata: { ...metadata },
    timestamp: new Date().toISOString()
  };

  const validation = validateModelTurnRequest(req);
  if (!validation.valid) {
    const err = new Error(`MODEL_TURN_REQUEST_INVALID: ${validation.error}`);
    err.code = 'MODEL_TURN_REQUEST_INVALID';
    throw err;
  }

  return deepFreeze(req);
}

export function validateModelTurnResponse(res) {
  if (!res || typeof res !== 'object') {
    return { valid: false, error: 'ModelTurnResponse must be an object' };
  }
  if (!res.turn_type || !Object.values(TURN_TYPES).includes(res.turn_type)) {
    return { valid: false, error: `Invalid 'turn_type': ${res.turn_type}. Must be one of: ${Object.values(TURN_TYPES).join(', ')}` };
  }
  if (res.turn_type === TURN_TYPES.TOOL_CALLS && (!Array.isArray(res.tool_calls) || res.tool_calls.length === 0)) {
    return { valid: false, error: "turn_type 'TOOL_CALLS' requires a non-empty 'tool_calls' array" };
  }
  if (res.turn_type === TURN_TYPES.TRANSITION && (!res.target_phase || typeof res.target_phase !== 'string')) {
    return { valid: false, error: "turn_type 'TRANSITION' requires a string 'target_phase'" };
  }
  return { valid: true, error: null };
}

export function createModelTurnResponse({
  turnType = TURN_TYPES.MESSAGE,
  content = '',
  toolCalls = [],
  targetPhase = null,
  usage = {},
  raw = null
}) {
  const res = {
    turn_type: turnType,
    content: typeof content === 'string' ? content : '',
    tool_calls: Array.isArray(toolCalls) ? toolCalls.map(tc => ({
      call_id: tc.call_id || `call-${Math.random().toString(36).slice(2, 8)}`,
      name: tc.name,
      args: tc.args && typeof tc.args === 'object' ? { ...tc.args } : {}
    })) : [],
    target_phase: targetPhase || null,
    usage: {
      prompt_tokens: usage.prompt_tokens || 0,
      completion_tokens: usage.completion_tokens || 0,
      total_tokens: (usage.prompt_tokens || 0) + (usage.completion_tokens || 0),
      ...usage
    },
    raw: raw ? { ...raw } : null,
    created_at: new Date().toISOString()
  };

  const validation = validateModelTurnResponse(res);
  if (!validation.valid) {
    const err = new Error(`MODEL_TURN_RESPONSE_INVALID: ${validation.error}`);
    err.code = 'MODEL_TURN_RESPONSE_INVALID';
    throw err;
  }

  return deepFreeze(res);
}

export class BaseProviderAdapter {
  constructor(name = 'base-provider') {
    this.name = name;
  }

  async generateTurn(turnRequest, options = {}) {
    throw new Error(`generateTurn() must be implemented by ProviderAdapter '${this.name}'`);
  }

  formatTools(toolDefinitions = []) {
    return toolDefinitions.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description || '',
        parameters: t.parameters || {}
      }
    }));
  }
}
