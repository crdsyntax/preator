export const VERSION = '0.1.1';
export const NAME = 'Praetor';

import {
  PHASES,
  ALLOWED_WRITE_PHASES,
  WRITE_TOOLS,
  TRANSITION_GRAPH,
  RISK_LEVELS,
  TOOL_STATUS,
  ERROR_CATEGORIES,
  createToolRequest,
  createToolResult,
  createToolError,
  inferRiskLevel,
  deepFreeze
} from './core/contracts.js';
import { LifecycleMachine } from './core/lifecycle.js';
import { SessionState, DEFAULT_SESSIONS_ROOT } from './core/state.js';
import { EventLog } from './core/events.js';
import { ApprovalManager, APPROVAL_STATUS } from './core/approvals.js';
import { ToolRegistry, ToolDefinition } from './core/registry.js';
import { PolicyEngine, HARD_SECURITY_POLICIES } from './core/policy.js';
import { ExecutionGateway } from './core/gateway.js';
import {
  createDelegationRequest,
  validateDelegationRequest,
  createDelegationResult,
  createTaskOwnership,
  DELEGATION_STATUS,
  DELEGATION_ERRORS
} from './core/delegation.js';
import { OrchestratorEngine } from './core/orchestration.js';
import {
  createAgentDefinition,
  validateAgentDefinition,
  loadAgentFromMarkdown,
  parseMarkdownAgent,
  AgentCatalog
} from './core/agents.js';
import {
  createSkillDefinition,
  validateSkillDefinition,
  loadSkillFromMarkdown,
  parseMarkdownSkill,
  SkillCatalog
} from './core/skills.js';
import {
  ContextGovernance,
  createRetrievalRequest,
  RetrievalEngine,
  estimateTokens,
  sha256
} from './core/context.js';

import * as core from './core/index.js';
import * as providers from './providers/index.js';
import * as hosts from './hosts/index.js';
import * as evaluation from './evaluation/index.js';

export {
  core,
  providers,
  hosts,
  evaluation
};

export class AgentSession {
  constructor({
    sessionId = null,
    agentId = 'orchestrator',
    goal = '',
    agentDefinition = null,
    initialPhase = 'REQUEST',
    sessionsRoot = DEFAULT_SESSIONS_ROOT,
    policy = null,
    projectConfig = null
  } = {}) {
    this.state = new SessionState({
      sessionId,
      agentId,
      goal,
      currentPhase: initialPhase,
      sessionsRoot
    });

    this._agentDefinition = agentDefinition ? deepFreeze(agentDefinition) : null;
    this.attachedSkills = new Map();
    this.contextBundles = new Map();

    this.lifecycle = new LifecycleMachine(initialPhase);
    this.events = new EventLog({ sessionId: this.state.sessionId });
    this.approvals = new ApprovalManager();
    this.policy = policy || new PolicyEngine({ projectConfig });
    this.registry = new ToolRegistry();
    this.gateway = new ExecutionGateway({
      registry: this.registry,
      lifecycle: this.lifecycle,
      policy: this.policy,
      approvals: this.approvals,
      events: this.events
    });
    this.orchestration = new OrchestratorEngine({ events: this.events });
    this.orchestrator = this.orchestration;
    this.retrieval = new RetrievalEngine();

    this.state.save();
    this.events.append('agent.started', {
      phase: this.lifecycle.getPhase(),
      agent_id: this.state.agentId
    });
  }

  get sessionId() {
    return this.state.sessionId;
  }

  get agentId() {
    return this.state.agentId;
  }

  get agentDefinition() {
    return this._agentDefinition;
  }

  set agentDefinition(newDef) {
    if (this._agentDefinition && newDef && this._agentDefinition.identity?.id !== newDef.identity?.id) {
      const err = new Error(
        `Agent identity integrity violation: Cannot mutate agent identity from '${this._agentDefinition.identity?.id}' to '${newDef.identity?.id}'`
      );
      err.code = 'AGENT_IDENTITY_IMMUTABLE';
      throw err;
    }
    this._agentDefinition = newDef ? deepFreeze(newDef) : null;
  }

  attachSkill(skillDef) {
    if (!skillDef || typeof skillDef !== 'object') {
      const err = new Error('Invalid skill definition: must be an object');
      err.code = 'INVALID_SKILL_DEFINITION';
      throw err;
    }

    const targetAgents = skillDef.target_agents || [];
    if (targetAgents.length > 0 && !targetAgents.includes(this.state.agentId)) {
      const err = new Error(
        `Skill '${skillDef.id}' cannot be attached to agent '${this.state.agentId}'. Authorized targets: [${targetAgents.join(', ')}]`
      );
      err.code = 'SKILL_AGENT_MISMATCH';
      throw err;
    }

    const agentTools = this.agentDefinition?.capabilities?.tools || [];
    const requiredTools = skillDef.required_tools || [];
    for (const tool of requiredTools) {
      if (!agentTools.includes(tool)) {
        const err = new Error(
          `Agent '${this.state.agentId}' lacks required tool '${tool}' for skill '${skillDef.id}'. Skills cannot expand agent capabilities (ARCH-05).`
        );
        err.code = 'SKILL_TOOL_UNAUTHORIZED';
        throw err;
      }
    }

    const frozenSkill = createSkillDefinition(skillDef);
    this.attachedSkills.set(frozenSkill.id, frozenSkill);

    this.events.append('skill.attached', {
      skill_id: frozenSkill.id,
      agent_id: this.state.agentId
    });

    return frozenSkill;
  }

  getAttachedSkills() {
    return Array.from(this.attachedSkills.values());
  }

  async retrieveContext(options = {}) {
    const retrievalReq = createRetrievalRequest({
      runId: this.state.sessionId,
      agentId: this.state.agentId,
      ...options
    });

    const bundle = await this.retrieval.resolve(retrievalReq);
    this.contextBundles.set(bundle.bundle_id, bundle);

    this.state.context.lastContextBundle = bundle.bundle_hash;
    this.state.save();

    this.events.append('context.retrieved', {
      bundle_id: bundle.bundle_id,
      bundle_hash: bundle.bundle_hash,
      total_items: bundle.total_items,
      total_tokens: bundle.total_tokens,
      agent_id: this.state.agentId
    });

    return bundle;
  }

  registerTool(definition) {
    return this.registry.register(definition);
  }

  getPhase() {
    return this.lifecycle.getPhase();
  }

  transition(targetPhase) {
    try {
      const result = this.lifecycle.transition(targetPhase);
      this.state.currentPhase = result.current;
      this.state.save();

      this.events.append('lifecycle.phase_changed', {
        phase: result.current,
        tool_name: 'lifecycle',
        status: 'ok'
      });

      return result;
    } catch (err) {
      this.events.append('lifecycle.violation', {
        phase: this.lifecycle.getPhase(),
        tool_name: 'lifecycle',
        status: 'error',
        error: err.message
      });
      throw err;
    }
  }

  canExecute(toolName, args = {}) {
    return this.policy.canExecute(
      { tool: toolName, args },
      this.state.toJSON()
    );
  }

  async executeTool(toolName, args = {}, executorFn = null, context = {}) {
    if (executorFn && !this.registry.has(toolName)) {
      this.registry.register({
        name: toolName,
        executor: executorFn
      });
    }

    const toolRequest = createToolRequest({
      runId: this.state.sessionId,
      agentId: this.state.agentId,
      toolName,
      args,
      phase: this.lifecycle.getPhase()
    });

    const enrichedContext = { ...context, agentDefinition: this.agentDefinition };
    const result = await this.gateway.execute(toolRequest, this.state.toJSON(), enrichedContext);
    if (result.status !== TOOL_STATUS.OK) {
      const err = new Error(result.error?.message || `Tool execution ${result.status}`);
      err.code = result.error?.code || result.status;
      err.category = result.error?.category;
      throw err;
    }
    return result.output;
  }

  requestApproval(action, description, metadata = {}) {
    const record = this.approvals.requestApproval({ action, description, metadata });
    this.state.pendingApproval = record.id;
    this.state.save();
    return record;
  }

  decideApproval(approvalId, approved, reason = '') {
    const record = this.approvals.resolveApproval(approvalId, { approved, reason });
    if (this.state.pendingApproval === approvalId) {
      this.state.pendingApproval = null;
      this.state.save();
    }
    return record;
  }

  complete(status = 'completed') {
    const currentPhase = this.lifecycle.getPhase();

    if (status === 'completed' && currentPhase !== 'COMPLETE') {
      const err = new Error(
        `Lifecycle completion denied: Cannot complete session from phase '${currentPhase}'. Session must reach 'COMPLETE' phase.`
      );
      err.code = 'LIFECYCLE_COMPLETION_DENIED';
      err.currentPhase = currentPhase;

      this.events.append('lifecycle.violation', {
        phase: currentPhase,
        tool_name: 'lifecycle',
        status: 'error',
        error: err.message
      });

      throw err;
    }

    this.state.status = status;
    this.state.save();
    this.events.append(`agent.${status}`, {
      phase: currentPhase
    });
    return this.state.toJSON();
  }

  async delegate({ childAgentId, task, childExecutorFn, depth = 0 }) {
    const delegationReq = createDelegationRequest({
      parentRunId: this.state.sessionId,
      parentAgentId: this.state.agentId,
      childAgentId,
      task,
      depth: depth > 0 ? depth : (this.state.context?.depth || 0) + 1
    });

    const childDef = this.orchestration.authorizedAgents?.get(childAgentId)?.def || null;

    return this.orchestration.delegate(
      delegationReq,
      childExecutorFn,
      (childOptions) => createSession({
        ...childOptions,
        agentDefinition: childDef,
        sessionsRoot: this.state.sessionsRoot
      })
    );
  }
}

export function createSession(options = {}) {
  return new AgentSession(options);
}
