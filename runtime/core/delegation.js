export const DELEGATION_STATUS = Object.freeze({
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  DENIED: 'DENIED',
  REVOKED: 'REVOKED'
});

export const DELEGATION_ERRORS = Object.freeze({
  UNKNOWN_AGENT_DENIED: 'UNKNOWN_AGENT_DENIED',
  DELEGATION_DEPTH_EXCEEDED: 'DELEGATION_DEPTH_EXCEEDED',
  ITERATION_LIMIT_EXCEEDED: 'ITERATION_LIMIT_EXCEEDED',
  CONCURRENCY_LIMIT_EXCEEDED: 'CONCURRENCY_LIMIT_EXCEEDED',
  DELEGATION_LOOP_DENIED: 'DELEGATION_LOOP_DENIED',
  OWNERSHIP_VIOLATION: 'OWNERSHIP_VIOLATION',
  UNAUTHORIZED_DELEGATION_DENIED: 'UNAUTHORIZED_DELEGATION_DENIED'
});

export function createDelegationRequest({
  delegationId,
  parentRunId,
  childRunId,
  parentAgentId,
  childAgentId,
  task,
  depth = 0,
  createdAt = null
}) {
  if (!parentRunId) throw new Error("DelegationRequest requires 'parentRunId'");
  if (!childAgentId) throw new Error("DelegationRequest requires 'childAgentId'");
  if (!task) throw new Error("DelegationRequest requires 'task'");

  const id = delegationId || `dlg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const cRunId = childRunId || `run-${childAgentId}-${Date.now()}`;

  return Object.freeze({
    delegation_id: id,
    parent_run_id: parentRunId,
    child_run_id: cRunId,
    parent_agent_id: parentAgentId || 'orchestrator',
    child_agent_id: childAgentId,
    task: typeof task === 'string' ? { description: task } : { ...task },
    depth: Number(depth),
    created_at: createdAt || new Date().toISOString()
  });
}

export function validateDelegationRequest(req) {
  if (!req || typeof req !== 'object') {
    return { valid: false, error: 'DelegationRequest must be an object' };
  }
  const required = ['delegation_id', 'parent_run_id', 'child_run_id', 'parent_agent_id', 'child_agent_id', 'task', 'depth', 'created_at'];
  for (const field of required) {
    if (req[field] === undefined || req[field] === null) {
      return { valid: false, error: `Missing required field '${field}' in DelegationRequest` };
    }
  }
  return { valid: true, error: null };
}

export function createDelegationResult({
  delegationId,
  childRunId,
  status,
  output = null,
  error = null,
  durationMs = 0,
  completedAt = null,
  revokedFrom = null,
  revokedTo = null
}) {
  if (!delegationId) throw new Error("DelegationResult requires 'delegationId'");
  if (!DELEGATION_STATUS[status]) {
    throw new Error(`Invalid status '${status}'. Valid: ${Object.keys(DELEGATION_STATUS).join(', ')}`);
  }

  return Object.freeze({
    delegation_id: delegationId,
    child_run_id: childRunId || null,
    status,
    output,
    error: error ? Object.freeze(typeof error === 'string' ? { code: 'DELEGATION_FAILED', message: error } : { ...error }) : null,
    duration_ms: Math.max(0, durationMs),
    completed_at: completedAt || new Date().toISOString(),
    revoked_from: revokedFrom || null,
    revoked_to: revokedTo || null
  });
}

export function createTaskOwnership({
  taskId,
  ownerAgentId,
  parentTaskId = null,
  description = '',
  status = 'ACTIVE'
}) {
  if (!taskId) throw new Error("TaskOwnership requires 'taskId'");
  if (!ownerAgentId) throw new Error("TaskOwnership requires 'ownerAgentId'");

  return {
    task_id: taskId,
    owner_agent_id: ownerAgentId,
    parent_task_id: parentTaskId,
    description,
    status,
    created_at: new Date().toISOString()
  };
}
