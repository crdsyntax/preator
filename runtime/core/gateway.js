import {
  TOOL_STATUS,
  ERROR_CATEGORIES,
  RISK_LEVELS,
  WRITE_TOOLS,
  ALLOWED_WRITE_PHASES,
  createToolResult,
  createToolError,
  computeCanonicalHash,
  validateToolRequest
} from './contracts.js';
import { LifecycleMachine } from './lifecycle.js';
import { ToolRegistry } from './registry.js';
import { PolicyEngine } from './policy.js';

const SENSITIVE_ARG_KEY = /(pass(?:word)?|secret|token|api[_-]?key|credential|authorization|bearer|private[_-]?key)/i;

function redactArgs(args = {}) {
  const out = {};
  for (const [key, value] of Object.entries(args || {})) {
    out[key] = SENSITIVE_ARG_KEY.test(key) ? '[REDACTED]' : value;
  }
  return out;
}

export class ExecutionGateway {
  constructor({
    registry = null,
    lifecycle = null,
    policy = null,
    approvals = null,
    events = null
  } = {}) {
    this.registry = registry || new ToolRegistry();
    this.lifecycle = lifecycle || new LifecycleMachine('REQUEST');
    this.policy = policy || new PolicyEngine();
    this.approvals = approvals;
    this.events = events;
  }

  async execute(toolRequest, state = {}, context = {}) {
    const startMs = Date.now();
    const phase = state.current_phase || this.lifecycle.getPhase();

    const valReq = validateToolRequest(toolRequest);
    if (!valReq.valid) {
      const toolError = createToolError({
        code: 'INVALID_TOOL_REQUEST',
        message: valReq.error,
        category: ERROR_CATEGORIES.INVALID_ARGUMENTS
      });
      this._emitDenied(toolRequest?.request_id || 'unknown', toolRequest?.tool_name || 'unknown', phase, toolError.message, toolRequest?.arguments);
      return createToolResult({
        requestId: toolRequest?.request_id || 'unknown',
        status: TOOL_STATUS.DENIED,
        durationMs: Date.now() - startMs,
        error: toolError
      });
    }

    const requestId = toolRequest.request_id;
    const toolName = toolRequest.tool_name;
    const args = toolRequest.arguments;

    const toolDef = this.registry.get(toolName);
    if (!toolDef) {
      const toolError = createToolError({
        code: 'TOOL_NOT_FOUND',
        message: `Tool '${toolName}' is not registered in the catalog`,
        category: ERROR_CATEGORIES.TOOL_NOT_FOUND
      });
      this._emitDenied(requestId, toolName, phase, toolError.message, args);
      return createToolResult({
        requestId,
        status: TOOL_STATUS.ERROR,
        durationMs: Date.now() - startMs,
        error: toolError
      });
    }

    const valArgs = this.registry.validateArguments(toolName, args);
    if (!valArgs.valid) {
      const toolError = createToolError({
        code: 'INVALID_ARGUMENTS',
        message: valArgs.error,
        category: ERROR_CATEGORIES.INVALID_ARGUMENTS
      });
      this._emitDenied(requestId, toolName, phase, toolError.message, args);
      return createToolResult({
        requestId,
        status: TOOL_STATUS.DENIED,
        durationMs: Date.now() - startMs,
        error: toolError
      });
    }

    if (context.hostDecision && context.hostDecision.canonical_hash) {
      const currentHash = computeCanonicalHash(toolName, args);
      if (context.hostDecision.canonical_hash !== currentHash) {
        const toolError = createToolError({
          code: 'TOCTOU_MISMATCH_DENIED',
          message: `Execution arguments do not match authorized canonical argument hash (Anti-TOCTOU violation). Expected hash '${context.hostDecision.canonical_hash}', calculated '${currentHash}'.`,
          category: ERROR_CATEGORIES.POLICY_DENIED,
          details: { expectedHash: context.hostDecision.canonical_hash, currentHash }
        });
        this._emitDenied(requestId, toolName, phase, toolError.message, args);
        return createToolResult({
          requestId,
          status: TOOL_STATUS.DENIED,
          durationMs: Date.now() - startMs,
          error: toolError
        });
      }
    }

    const agentDef = context.agentDefinition || state.agentDefinition;
    if (agentDef && agentDef.capabilities && Array.isArray(agentDef.capabilities.tools)) {
      if (!agentDef.capabilities.tools.includes(toolName)) {
        const toolError = createToolError({
          code: 'AGENT_TOOL_DENIED',
          message: `Tool '${toolName}' is not permitted by capabilities for agent '${agentDef.identity?.id || 'unknown'}'`,
          category: ERROR_CATEGORIES.POLICY_DENIED
        });
        this._emitDenied(requestId, toolName, phase, toolError.message, args);
        return createToolResult({
          requestId,
          status: TOOL_STATUS.DENIED,
          durationMs: Date.now() - startMs,
          error: toolError
        });
      }
    }

    if (WRITE_TOOLS.has(toolName) && !ALLOWED_WRITE_PHASES.has(phase)) {
      const toolError = createToolError({
        code: 'LIFECYCLE_DENIED',
        message: `Write tool '${toolName}' is forbidden in phase '${phase}'. Allowed only in EXECUTE and DOCUMENT.`,
        category: ERROR_CATEGORIES.LIFECYCLE_DENIED,
        details: { reason: 'LIFECYCLE_WRITE_VIOLATION', phase, tool: toolName }
      });
      this._emitDenied(requestId, toolName, phase, toolError.message, args);
      return createToolResult({
        requestId,
        status: TOOL_STATUS.DENIED,
        durationMs: Date.now() - startMs,
        error: toolError
      });
    }

    const canonicalHash = computeCanonicalHash(toolName, args);
    let grant = { valid: false, request: null };
    if (this.approvals && typeof this.approvals.verifyGrant === 'function') {
      grant = this.approvals.verifyGrant({ requestId, canonicalHash, action: toolName });
    }
    if (context.hasApproval) {
      console.warn('[ExecutionGateway] context.hasApproval is deprecated and ignored; use ApprovalManager grants (session.requestApproval / approveTask).');
    }

    const policyDecision = this.policy.canExecute({ tool: toolName, args, hasApproval: grant.valid }, { ...state, current_phase: phase });
    if (!policyDecision.allowed) {
      if (policyDecision.policy === 'P1_PUSH_APPROVAL_REQUIRED' && this.approvals) {
        this.approvals.requestApproval({
          action: toolName,
          description: 'Command requires prior human approval before execution',
          requestId,
          canonicalHash,
          riskLevel: toolRequest.risk_level
        });
      }
      const toolError = createToolError({
        code: policyDecision.policy,
        message: policyDecision.reason,
        category: ERROR_CATEGORIES.POLICY_DENIED
      });
      this._emitDenied(requestId, toolName, phase, toolError.message, args);
      return createToolResult({
        requestId,
        status: TOOL_STATUS.DENIED,
        durationMs: Date.now() - startMs,
        error: toolError
      });
    }

    const isExplicitApprovalRequired = toolDef.requiresApproval === true;
    const isCriticalRisk = toolRequest.risk_level === RISK_LEVELS.CRITICAL;
    const requiresApproval = isExplicitApprovalRequired || isCriticalRisk;
    if (requiresApproval && !grant.valid) {
      if (this.approvals) {
        this.approvals.requestApproval({
          action: toolName,
          description: `Execution of high-risk tool '${toolName}'`,
          requestId,
          canonicalHash,
          riskLevel: toolRequest.risk_level
        });
      }
      const toolError = createToolError({
        code: 'APPROVAL_REQUIRED',
        message: `Tool '${toolName}' requires human approval before execution`,
        category: ERROR_CATEGORIES.APPROVAL_REQUIRED
      });
      this._emitDenied(requestId, toolName, phase, toolError.message, args);
      return createToolResult({
        requestId,
        status: TOOL_STATUS.DENIED,
        durationMs: Date.now() - startMs,
        error: toolError
      });
    }
    if (grant.valid && this.approvals && typeof this.approvals.consumeGrant === 'function') {
      this.approvals.consumeGrant(grant.request.id);
    }

    if (this.events) {
      this.events.append('tool.requested', {
        phase,
        tool_name: toolName,
        risk_level: toolRequest.risk_level,
        tool_args: { ...redactArgs(args), request_id: requestId }
      });
    }

    try {
      const output = await this._executeWithTimeout(toolDef.executor, args, context, toolDef.timeoutMs, context.signal);
      const durationMs = Date.now() - startMs;

      if (this.events) {
        this.events.append('tool.completed', {
          phase,
          tool_name: toolName,
          duration_ms: durationMs,
          status: 'ok',
          tool_args: { request_id: requestId }
        });
      }

      return createToolResult({
        requestId,
        status: TOOL_STATUS.OK,
        output,
        durationMs
      });
    } catch (err) {
      const durationMs = Date.now() - startMs;
      const isTimeout = err.code === 'TIMEOUT' || err.message?.includes('timed out');
      const isCancelled = err.code === 'CANCELLED';
      const errorCode = isTimeout ? 'TIMEOUT' : (isCancelled ? 'CANCELLED' : 'EXECUTION_FAILED');
      const category = isTimeout ? ERROR_CATEGORIES.TIMEOUT : ERROR_CATEGORIES.EXECUTION_FAILED;

      const toolError = createToolError({
        code: errorCode,
        message: err.message,
        category,
        details: { durationMs, originalError: String(err) }
      });

      if (this.events) {
        this.events.append('tool.failed', {
          phase,
          tool_name: toolName,
          duration_ms: durationMs,
          status: 'error',
          error: toolError.message,
          tool_args: { request_id: requestId }
        });
      }

      return createToolResult({
        requestId,
        status: TOOL_STATUS.ERROR,
        durationMs,
        error: toolError
      });
    }
  }

  _emitDenied(requestId, toolName, phase, errorReason, args) {
    if (this.events) {
      this.events.append('tool.denied', {
        phase,
        tool_name: toolName,
        status: 'denied',
        error: errorReason,
        tool_args: { ...redactArgs(args), request_id: requestId }
      });
    }
  }

  async _executeWithTimeout(executorFn, args, context = {}, timeoutMs, signal = null) {
    const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30000;
    const controller = new AbortController();
    const externalAbort = () => controller.abort(signal?.reason);
    if (signal) {
      if (signal.aborted) controller.abort(signal.reason);
      else signal.addEventListener('abort', externalAbort, { once: true });
    }

    try {
      return await new Promise((resolve, reject) => {
        let settled = false;

        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          controller.abort(new Error('timeout'));
          const err = new Error(`Tool execution timed out after ${timeout}ms`);
          err.code = 'TIMEOUT';
          reject(err);
        }, timeout);

        const onAbort = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const reason = controller.signal.reason;
          const err = new Error(`Tool execution cancelled${reason ? `: ${reason}` : ''}`);
          err.code = 'CANCELLED';
          reject(err);
        };
        controller.signal.addEventListener('abort', onAbort, { once: true });

        if (controller.signal.aborted) {
          onAbort();
          return;
        }

        Promise.resolve()
          .then(() => executorFn(args, { ...context, signal: controller.signal }))
          .then(res => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            controller.signal.removeEventListener('abort', onAbort);
            resolve(res);
          })
          .catch(err => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            controller.signal.removeEventListener('abort', onAbort);
            reject(err);
          });
      });
    } finally {
      if (signal) signal.removeEventListener('abort', externalAbort);
    }
  }
}
