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
    maxCorrections = 1,
    authorizedAgents = null,
    events = null
  } = {}) {
    this.maxDepth = maxDepth;
    this.maxIterations = maxIterations;
    this.maxConcurrency = maxConcurrency;
    this.maxCorrections = maxCorrections;
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

    const parentRecord = this.authorizedAgents.get(parentAgent);
    const parentCaps = parentRecord?.def?.capabilities;
    if (parentCaps) {
      if (parentCaps.can_delegate === false) {
        return {
          allowed: false,
          error: {
            code: DELEGATION_ERRORS.UNAUTHORIZED_DELEGATION_DENIED,
            message: `Agent '${parentAgent}' declares can_delegate=false and may not delegate.`
          }
        };
      }
      const targets = parentCaps.delegation_targets;
      if (Array.isArray(targets) && targets.length > 0 && !targets.includes(childAgent)) {
        return {
          allowed: false,
          error: {
            code: DELEGATION_ERRORS.UNAUTHORIZED_DELEGATION_DENIED,
            message: `Agent '${parentAgent}' is not authorized to delegate to '${childAgent}'. Allowed targets: [${targets.join(', ')}].`
          }
        };
      }
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

  async delegate(delegationRequest, childExecutorFn, sessionFactoryFn = null, options = {}) {
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
    let taskOwnership = createTaskOwnership({
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

    const verify = typeof options.verify === 'function' ? options.verify : null;
    const maxCorrections = Number.isInteger(options.maxCorrections) ? Math.max(0, options.maxCorrections) : this.maxCorrections;
    const escalationExecutorFn = typeof options.escalationExecutorFn === 'function' ? options.escalationExecutorFn : null;
    const totalAttempts = maxCorrections + 1;
    const alerts = [];

    const runVerification = (output) => {
      if (!verify) return { valid: true };
      try {
        return verify(output, delegationRequest) || { valid: true };
      } catch (err) {
        return { valid: false, reason: err.message };
      }
    };

    const emitAlert = (alert) => {
      alerts.push(alert);
      if (this.events) {
        this.events.append('delegation.alert', {
          delegation_id,
          parent_run_id,
          child_run_id,
          child_agent_id,
          parent_agent_id,
          task_id: taskId,
          ...alert
        });
      }
      if (typeof options.onAlert === 'function') {
        try { options.onAlert(alert); } catch {}
      }
    };

    let childSession = null;
    if (typeof sessionFactoryFn === 'function') {
      childSession = sessionFactoryFn({
        sessionId: child_run_id,
        agentId: child_agent_id,
        context: { parent_run_id, delegation_id, depth, task_id: taskId }
      });
    }

    let lastOutput = null;
    let lastReason = null;
    let attempt = 0;

    while (attempt < totalAttempts) {
      attempt++;
      try {
        const output = await childExecutorFn(childSession, delegationRequest, { attempt });
        const check = runVerification(output);
        if (check.valid) {
          this.activeDelegations.delete(delegation_id);
          taskOwnership.status = 'COMPLETED';
          if (this.events) {
            this.events.append('delegation.completed', {
              delegation_id,
              parent_run_id,
              child_run_id,
              child_agent_id,
              duration_ms: Date.now() - startMs,
              status: 'ok',
              attempts: attempt
            });
          }
          return createDelegationResult({
            delegationId: delegation_id,
            childRunId: child_run_id,
            status: DELEGATION_STATUS.COMPLETED,
            output,
            durationMs: Date.now() - startMs,
            attempts: attempt,
            alerts
          });
        }
        lastOutput = output;
        lastReason = check.reason || 'Output failed verification';
      } catch (err) {
        lastReason = err.message;
      }

      if (attempt < totalAttempts) {
        emitAlert({
          code: 'DELEGATION_INCOMPLETE',
          child_agent_id,
          attempt,
          reason: lastReason,
          task_id: taskId,
          final: false,
          message: `Agent '${child_agent_id}' did not complete the task and must correct it.`
        });
      }
    }

    emitAlert({
      code: 'DELEGATION_INCOMPLETE',
      child_agent_id,
      attempt,
      reason: lastReason,
      task_id: taskId,
      final: true,
      message: `Agent '${child_agent_id}' did not complete the task; escalating to the superior '${parent_agent_id}'.`
    });

    this.activeDelegations.delete(delegation_id);
    const superior = parent_agent_id;
    taskOwnership.status = 'REVOKED';
    taskOwnership.revoked_to = superior;
    taskOwnership.revoked_at = new Date().toISOString();
    this.taskOwnerships.set(taskId, createTaskOwnership({
      taskId,
      ownerAgentId: superior,
      parentTaskId: task.parentTaskId || null,
      description: task.description || '',
      status: 'ASSIGNED'
    }));

    if (this.events) {
      this.events.append('delegation.revoked', {
        delegation_id,
        parent_run_id,
        child_run_id,
        child_agent_id,
        parent_agent_id,
        task_id: taskId,
        reason: lastReason,
        duration_ms: Date.now() - startMs,
        attempts: attempt
      });
    }

    if (escalationExecutorFn) {
      try {
        const escalatedOutput = await escalationExecutorFn(superior, delegationRequest, {
          failedOutput: lastOutput,
          error: lastReason,
          attempts: attempt
        });
        const check = runVerification(escalatedOutput);
        if (check.valid) {
          if (this.events) {
            this.events.append('delegation.escalated', {
              delegation_id,
              escalated_to: superior,
              child_agent_id,
              resolved: true,
              attempts: attempt
            });
          }
          const ownership = this.taskOwnerships.get(taskId);
          if (ownership) ownership.status = 'COMPLETED';
          return createDelegationResult({
            delegationId: delegation_id,
            childRunId: child_run_id,
            status: DELEGATION_STATUS.COMPLETED,
            output: escalatedOutput,
            durationMs: Date.now() - startMs,
            revokedFrom: child_agent_id,
            revokedTo: superior,
            escalatedTo: superior,
            resolvedBy: superior,
            attempts: attempt,
            alerts
          });
        }
        lastReason = check.reason || lastReason;
      } catch (err) {
        lastReason = err.message;
      }
    }

    if (this.events) {
      this.events.append('delegation.escalated', {
        delegation_id,
        escalated_to: superior,
        child_agent_id,
        resolved: false,
        attempts: attempt
      });
    }

    return createDelegationResult({
      delegationId: delegation_id,
      childRunId: child_run_id,
      status: DELEGATION_STATUS.REVOKED,
      error: { code: 'INCOMPLETE', message: lastReason || 'Output failed verification' },
      revokedFrom: child_agent_id,
      revokedTo: superior,
      escalatedTo: superior,
      needsCorrection: true,
      attempts: attempt,
      durationMs: Date.now() - startMs,
      alerts
    });
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
