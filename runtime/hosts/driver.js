import {
  HOST_DECISIONS,
  createHostDecision
} from './contracts.js';
import {
  canonicalizeToolArgs,
  computeCanonicalHash
} from '../core/contracts.js';

export const TOOL_NORMALIZATION_MAP = Object.freeze({
  replace_file_content: 'write',
  multi_replace_file_content: 'write',
  write_to_file: 'write',
  view_file: 'read',
  read_url_content: 'read',
  list_dir: 'read',
  grep_search: 'read',
  run_command: 'bash',
  edit: 'write',
  patch: 'write'
});

export class HostDriver {
  constructor({ normalizationMap = TOOL_NORMALIZATION_MAP } = {}) {
    this.normalizationMap = { ...normalizationMap };
  }

  normalizeToolName(hostToolName) {
    return this.normalizationMap[hostToolName] || hostToolName;
  }

  normalizeArguments(canonicalTool, rawArgs) {
    return canonicalizeToolArgs(canonicalTool, rawArgs);
  }

  computeArgumentHash(canonicalTool, rawArgs) {
    return computeCanonicalHash(canonicalTool, rawArgs);
  }

  evaluateInvocation(hostInvocation, session) {

    let rawTool = hostInvocation.tool_name;
    let args = hostInvocation.args;

    if (!rawTool && hostInvocation.toolCall) {
      rawTool = hostInvocation.toolCall.name;
      args = hostInvocation.toolCall.args || {};
    }

    if (!rawTool) {
      return createHostDecision({
        decision: HOST_DECISIONS.DENY,
        code: 'INVALID_HOST_INVOCATION',
        reason: 'Missing tool name in host invocation'
      });
    }

    args = args || {};
    const canonicalTool = this.normalizeToolName(rawTool);
    const canonicalArgs = this.normalizeArguments(canonicalTool, args);
    const canonicalHash = this.computeArgumentHash(canonicalTool, args);

    const agentDef = session.agentDefinition;
    const currentPhase = session.getPhase();

    if (agentDef && agentDef.capabilities && Array.isArray(agentDef.capabilities.tools)) {
      const allowedTools = agentDef.capabilities.tools;
      const isAllowed = allowedTools.includes(canonicalTool) || allowedTools.includes(rawTool);
      if (!isAllowed) {
        return createHostDecision({
          decision: HOST_DECISIONS.DENY,
          code: 'AGENT_TOOL_DENIED',
          category: 'CAPABILITY_VIOLATION',
          canonicalTool,
          canonicalArgs,
          canonicalHash,
          reason: `Tool '${rawTool}' (canonical: '${canonicalTool}') is not permitted by capabilities for agent '${agentDef.identity?.id || 'unknown'}'`
        });
      }
    }

    const policyEngine = session.policy || (session.gateway ? session.gateway.policy : null);
    if (!policyEngine) {
      return createHostDecision({
        decision: HOST_DECISIONS.DENY,
        code: 'POLICY_ENGINE_MISSING',
        canonicalTool,
        canonicalArgs,
        canonicalHash,
        reason: 'Fail-closed: No PolicyEngine available on session'
      });
    }

    const effectiveArgs = { ...canonicalArgs };
    if (canonicalTool === 'bash' && !effectiveArgs.cmd) {
      effectiveArgs.cmd = canonicalArgs.command;
    }

    const policyDecision = policyEngine.canExecute(
      { tool: canonicalTool, tool_name: canonicalTool, args: effectiveArgs },
      { ...session.state, current_phase: currentPhase }
    );

    if (!policyDecision.allowed) {
      if (policyDecision.policy === 'P1_PUSH_APPROVAL_REQUIRED') {
        return createHostDecision({
          decision: HOST_DECISIONS.ASK,
          code: 'P3_GIT_PUSH_CONFIRMATION',
          category: 'POLICY_APPROVAL',
          canonicalTool,
          canonicalArgs,
          canonicalHash,
          reason: policyDecision.reason
        });
      }

      const category = policyDecision.policy === 'P6_LIFECYCLE_WRITE_VIOLATION'
        ? 'LIFECYCLE_VIOLATION'
        : 'POLICY_VIOLATION';

      const code = policyDecision.policy === 'P6_LIFECYCLE_WRITE_VIOLATION'
        ? 'LIFECYCLE_DENIED'
        : policyDecision.policy;

      return createHostDecision({
        decision: HOST_DECISIONS.DENY,
        code,
        category,
        canonicalTool,
        canonicalArgs,
        canonicalHash,
        reason: policyDecision.reason
      });
    }

    if (session.state?.pendingApproval) {
      return createHostDecision({
        decision: HOST_DECISIONS.ASK,
        code: 'PENDING_APPROVAL_REQUIRED',
        category: 'APPROVAL_GATE',
        canonicalTool,
        canonicalArgs,
        canonicalHash,
        reason: `Session has a pending approval '${session.state.pendingApproval}' that must be decided first.`
      });
    }

    return createHostDecision({
      decision: HOST_DECISIONS.ALLOW,
      code: 'AUTHORIZED',
      canonicalTool,
      canonicalArgs,
      canonicalHash,
      reason: `Tool '${rawTool}' (canonical: '${canonicalTool}') is authorized in phase '${currentPhase}'.`
    });
  }
}
