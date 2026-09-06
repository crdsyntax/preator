import {
  DELEGATION_STATUS,
  DELEGATION_ERRORS,
  createDelegationResult,
  createTaskOwnership,
  validateDelegationRequest
} from './delegation.js';

export class OrchestratorEngine {
  constructor({
    maxDepth = 3,
    maxIterations = 3,
    maxConcurrency = 4,
    authorizedAgents = null,
    events = null
  } = {}) {
    this.maxDepth = maxDepth;
    this.maxIterations = maxIterations;
    this.maxConcurrency = maxConcurrency;
    this.events = events;

    this.activeDelegations = new Map();
    this.delegationChains = new Map();
    this.iterationCounts = new Map();
    this.taskOwnerships = new Map();

    this.authorizedAgents = new Map();
    if (authorizedAgents) {
      for (const a of authorizedAgents) {
        this.registerAgent(a);
      }
    }
  }

  registerAgent(agentOrId, options = {}) {
    const id = typeof agentOrId === 'string' ? agentOrId : (agentOrId.identity?.id || agentOrId.id);
    const role = typeof agentOrId === 'string'
      ? (options.role || 'specialist')
      : (agentOrId.identity?.role || agentOrId.role || 'specialist');
    this.authorizedAgents.set(id, {
      id,
      role,
      def: typeof agentOrId === 'object' ? agentOrId : { identity: { id, role } }
    });
  }

  hasAgent(agentId) {
    return this.authorizedAgents.has(agentId);
  }

  isRoot(agentId) {
    const agent = this.authorizedAgents.get(agentId);
    return agent ? agent.role === 'root' : false;
  }

  canDelegate(delegationRequest) {
    const val = validateDelegationRequest(delegationRequest);
    if (!val.valid) {
      return {
        allowed: false,
        error: { code: 'INVALID_DELEGATION_REQUEST', message: val.error }
      };
    }

    const {
      parent_agent_id: parentAgent,
      child_agent_id: childAgent,
      parent_run_id: parentRunId,
      depth,
      task
    } = delegationRequest;

    if (this.authorizedAgents.size > 0 && !this.hasAgent(childAgent)) {
      return {
        allowed: false,
        error: {
          code: DELEGATION_ERRORS.UNKNOWN_AGENT_DENIED,
          message: `Child agent '${childAgent}' is not registered or authorized in the runtime.`
        }
      };
    }

    if (this.authorizedAgents.size > 0 && !this.isRoot(parentAgent)) {
      return {
        allowed: false,
        error: {
          code: DELEGATION_ERRORS.UNAUTHORIZED_DELEGATION_DENIED,
          message: `Specialist agent '${parentAgent}' is unauthorized to delegate. Delegation is tree-shaped with single root orchestrator.`
        }
      };
    }

    if (depth > this.maxDepth) {
      return {
        allowed: false,
        error: {
          code: DELEGATION_ERRORS.DELEGATION_DEPTH_EXCEEDED,
          message: `Delegation depth ${depth} exceeds maximum allowed depth of ${this.maxDepth}.`
        }
      };
    }

    const ancestorChain = this.delegationChains.get(parentRunId) || [parentAgent];
    if (ancestorChain.includes(childAgent)) {
      return {
        allowed: false,
        error: {
          code: DELEGATION_ERRORS.DELEGATION_LOOP_DENIED,
          message: `Delegation loop detected: Agent '${childAgent}' already exists in the ancestor chain [${ancestorChain.join(' -> ')}].`
        }
      };
    }

    const iterKey = `${parentRunId}:${childAgent}:${task?.description || ''}`;
    const currentIters = (this.iterationCounts.get(iterKey) || 0) + 1;
    if (currentIters > this.maxIterations) {
      return {
        allowed: false,
        error: {
          code: DELEGATION_ERRORS.ITERATION_LIMIT_EXCEEDED,
          message: `Iteration limit of ${this.maxIterations} exceeded for delegation to '${childAgent}'.`
        }
      };
    }

    const activeChildrenForParent = Array.from(this.activeDelegations.values()).filter(
      d => d.parent_run_id === parentRunId
    );
    if (activeChildrenForParent.length >= this.maxConcurrency) {
      return {
        allowed: false,
        error: {
          code: DELEGATION_ERRORS.CONCURRENCY_LIMIT_EXCEEDED,
          message: `Active delegations (${activeChildrenForParent.length}) reached concurrency limit of ${this.maxConcurrency}.`
        }
      };
    }

    return { allowed: true, error: null };
  }

  async delegate(delegationRequest, childExecutorFn, sessionFactoryFn = null) {
    const startMs = Date.now();
    const { delegation_id, parent_run_id, child_run_id, parent_agent_id, child_agent_id, depth, task } = delegationRequest;

    const gateCheck = this.canDelegate(delegationRequest);
    if (!gateCheck.allowed) {
      if (this.events) {
        this.events.append('delegation.denied', {
          delegation_id,
          parent_run_id,
          child_agent_id,
          error: gateCheck.error.message,
          code: gateCheck.error.code,
          depth
        });
      }

      return createDelegationResult({
        delegationId: delegation_id,
        childRunId: child_run_id,
        status: DELEGATION_STATUS.DENIED,
        error: gateCheck.error,
        durationMs: Date.now() - startMs
      });
    }

    this.activeDelegations.set(delegation_id, delegationRequest);
    const parentChain = this.delegationChains.get(parent_run_id) || [parent_agent_id];
    this.delegationChains.set(child_run_id, [...parentChain, child_agent_id]);

    const iterKey = `${parent_run_id}:${child_agent_id}:${task?.description || ''}`;
    this.iterationCounts.set(iterKey, (this.iterationCounts.get(iterKey) || 0) + 1);

    const taskId = task.id || `task-${Date.now()}`;
    const taskOwnership = createTaskOwnership({
      taskId,
      ownerAgentId: child_agent_id,
      parentTaskId: task.parentTaskId || null,
      description: task.description || ''
    });
    this.taskOwnerships.set(taskId, taskOwnership);

    if (this.events) {
      this.events.append('delegation.started', {
        delegation_id,
        parent_run_id,
        child_run_id,
        parent_agent_id,
        child_agent_id,
        depth,
        task_id: taskId
      });
    }

    try {
      let childSession = null;
      if (typeof sessionFactoryFn === 'function') {
        childSession = sessionFactoryFn({
          sessionId: child_run_id,
          agentId: child_agent_id,
          context: {
            parent_run_id,
            delegation_id,
            depth,
            task_id: taskId
          }
        });
      }

      const output = await childExecutorFn(childSession, delegationRequest);
      const durationMs = Date.now() - startMs;

      this.activeDelegations.delete(delegation_id);
      taskOwnership.status = 'COMPLETED';

      if (this.events) {
        this.events.append('delegation.completed', {
          delegation_id,
          parent_run_id,
          child_run_id,
          child_agent_id,
          duration_ms: durationMs,
          status: 'ok'
        });
      }

      return createDelegationResult({
        delegationId: delegation_id,
        childRunId: child_run_id,
        status: DELEGATION_STATUS.COMPLETED,
        output,
        durationMs
      });
    } catch (err) {
      const durationMs = Date.now() - startMs;
      this.activeDelegations.delete(delegation_id);
      taskOwnership.status = 'FAILED';

      if (this.events) {
        this.events.append('delegation.failed', {
          delegation_id,
          parent_run_id,
          child_run_id,
          child_agent_id,
          duration_ms: durationMs,
          status: 'error',
          error: err.message
        });
      }

      return createDelegationResult({
        delegationId: delegation_id,
        childRunId: child_run_id,
        status: DELEGATION_STATUS.FAILED,
        error: { code: 'EXECUTION_FAILED', message: err.message },
        durationMs
      });
    }
  }

  assertTaskOwnership(taskId, agentId) {
    const task = this.taskOwnerships.get(taskId);
    if (!task) {
      const err = new Error(`Task '${taskId}' not found in registry`);
      err.code = DELEGATION_ERRORS.OWNERSHIP_VIOLATION;
      throw err;
    }
    if (task.owner_agent_id !== agentId) {
      const err = new Error(`Ownership violation: Agent '${agentId}' is not the owner of task '${taskId}'. Owner is '${task.owner_agent_id}'.`);
      err.code = DELEGATION_ERRORS.OWNERSHIP_VIOLATION;
      throw err;
    }
    return true;
  }
}
