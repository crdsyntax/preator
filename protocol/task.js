import { createSession } from '../runtime/session.js';
import { defaultTaskExecutor } from '../runtime/core/executor.js';
import { TASK_STATUS, validateTaskRequest } from './contracts.js';
import { defaultTaskStore, PersistentTaskStore } from './store.js';

export { defaultTaskStore, defaultTaskStore as defaultTaskRegistry, PersistentTaskStore };

function hydrateSession(record, store) {
  return createSession({
    sessionId: record.sessionId || record.taskId,
    goal: record.goal || '',
    initialPhase: record.phase || 'REQUEST',
    hydrate: true,
    sessionsRoot: store?.sessionsDir || undefined
  });
}

export function createTask(request = {}, store = defaultTaskStore) {
  const reqObj = typeof request === 'string' ? { goal: request } : { ...request };
  const validation = validateTaskRequest(reqObj);
  if (!validation.valid) {
    const err = new Error(`INVALID_TASK_REQUEST: ${validation.error}`);
    err.code = 'INVALID_TASK_REQUEST';
    throw err;
  }

  const goal = reqObj.goal || reqObj.task || reqObj.prompt || '';
  const taskId = reqObj.taskId || reqObj.sessionId || `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const session = createSession({
    sessionId: taskId,
    goal,
    initialPhase: 'REQUEST',
    workspaceRoot: reqObj.workspaceRoot || process.cwd(),
    sessionsRoot: store?.sessionsDir || undefined
  });

  const taskRecord = {
    taskId,
    sessionId: taskId,
    goal,
    session,
    status: TASK_STATUS.CREATED,
    phase: session.getPhase(),
    audit_seal: session.state?.state_hash || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  store.set(taskId, taskRecord);

  return {
    taskId,
    sessionId: taskId,
    goal,
    status: TASK_STATUS.CREATED,
    phase: session.getPhase(),
    createdAt: taskRecord.createdAt,
    audit_seal: session.state?.state_hash || null
  };
}

export async function executeTask(taskId, options = {}, store = defaultTaskStore) {
  if (typeof taskId !== 'string' || !taskId.trim()) {
    const err = new Error("INVALID_ARGUMENT: executeTask requires a string 'taskId'");
    err.code = 'INVALID_ARGUMENT';
    throw err;
  }

  const cleanTaskId = taskId.trim();
  const record = store.get(cleanTaskId);

  if (!record) {
    const err = new Error(`TASK_NOT_FOUND: Task '${cleanTaskId}' does not exist in store`);
    err.code = 'TASK_NOT_FOUND';
    throw err;
  }

  if (!record.session) {
    record.session = hydrateSession(record, store);
  }

  const session = record.session;
  record.status = TASK_STATUS.RUNNING;
  record.updatedAt = new Date().toISOString();

  const execResult = await defaultTaskExecutor.execute(session, { goal: record.goal, ...options });
  record.status = execResult.status;
  record.phase = execResult.phase || session.getPhase();
  record.audit_seal = execResult.audit_seal || session.state?.state_hash || null;
  record.summary = execResult.summary || null;
  record.report = execResult.report || null;
  record.specialists = execResult.specialists || null;
  record.updatedAt = new Date().toISOString();

  store.set(record.taskId, record);

  return {
    taskId: record.taskId,
    sessionId: session.sessionId,
    goal: record.goal,
    ...execResult
  };
}

export function getTask(taskId, store = defaultTaskStore) {
  if (typeof taskId !== 'string' || !taskId.trim()) {
    const err = new Error("INVALID_ARGUMENT: getTask requires a string 'taskId'");
    err.code = 'INVALID_ARGUMENT';
    throw err;
  }

  const cleanTaskId = taskId.trim();
  const record = store.get(cleanTaskId);
  if (!record) {
    const err = new Error(`TASK_NOT_FOUND: Task '${cleanTaskId}' does not exist in store`);
    err.code = 'TASK_NOT_FOUND';
    throw err;
  }

  const phase = record.session ? record.session.getPhase() : (record.phase || 'REQUEST');
  const audit_seal = record.session ? (record.session.state?.state_hash || null) : (record.audit_seal || null);
  const pendingApproval = record.session ? (record.session.state?.pendingApproval || null) : (record.pendingApproval || null);
  const events_count = record.session ? (record.session.events?.events?.length || 0) : (record.events_count || 0);

  return {
    taskId: record.taskId,
    sessionId: record.sessionId || record.taskId,
    goal: record.goal,
    status: record.status,
    phase,
    pendingApproval,
    audit_seal,
    summary: record.summary || null,
    report: record.report || null,
    specialists: record.specialists || null,
    events_count,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

export function approveTask(taskId, approvalId, decision = {}, store = defaultTaskStore) {
  if (typeof taskId !== 'string' || !taskId.trim()) {
    const err = new Error("INVALID_ARGUMENT: approveTask requires a string 'taskId'");
    err.code = 'INVALID_ARGUMENT';
    throw err;
  }

  const cleanTaskId = taskId.trim();
  const record = store.get(cleanTaskId);
  if (!record) {
    const err = new Error(`TASK_NOT_FOUND: Task '${cleanTaskId}' does not exist in store`);
    err.code = 'TASK_NOT_FOUND';
    throw err;
  }

  if (!record.session) {
    record.session = hydrateSession(record, store);
  }

  const session = record.session;
  const targetApprovalId = approvalId || session.state?.pendingApproval || record.pendingApproval;
  if (!targetApprovalId) {
    const err = new Error(`NO_PENDING_APPROVAL: Task '${cleanTaskId}' has no pending approval`);
    err.code = 'NO_PENDING_APPROVAL';
    throw err;
  }

  const approved = decision.approved !== false;
  const resolvedBy = decision.resolvedBy || decision.resolved_by || null;
  const reason = decision.reason || decision.comment || '';
  session.decideApproval(targetApprovalId, approved, reason, resolvedBy);
  record.status = TASK_STATUS.RUNNING;
  record.phase = session.getPhase();
  record.pendingApproval = null;
  record.updatedAt = new Date().toISOString();
  store.set(record.taskId, record);

  return {
    taskId: record.taskId,
    sessionId: session.sessionId,
    status: TASK_STATUS.RUNNING,
    phase: session.getPhase(),
    approvedId: targetApprovalId,
    audit_seal: session.state?.state_hash || null
  };
}

export function cancelTask(taskId, reason = 'User cancelled', store = defaultTaskStore) {
  if (typeof taskId !== 'string' || !taskId.trim()) {
    const err = new Error("INVALID_ARGUMENT: cancelTask requires a string 'taskId'");
    err.code = 'INVALID_ARGUMENT';
    throw err;
  }

  const cleanTaskId = taskId.trim();
  const record = store.get(cleanTaskId);
  if (!record) {
    const err = new Error(`TASK_NOT_FOUND: Task '${cleanTaskId}' does not exist in store`);
    err.code = 'TASK_NOT_FOUND';
    throw err;
  }

  if (!record.session) {
    record.session = hydrateSession(record, store);
  }

  const session = record.session;
  record.status = TASK_STATUS.CANCELLED;
  record.phase = session.getPhase();
  record.updatedAt = new Date().toISOString();

  session.state.status = 'cancelled';
  session.state.save();

  session.events.append('task.cancelled', {
    phase: session.getPhase(),
    reason
  });

  store.set(record.taskId, record);

  return {
    taskId: record.taskId,
    sessionId: session.sessionId,
    status: TASK_STATUS.CANCELLED,
    phase: session.getPhase(),
    reason,
    audit_seal: session.state?.state_hash || null
  };
}

export async function resumeTask(taskId, store = defaultTaskStore) {
  if (typeof taskId !== 'string' || !taskId.trim()) {
    const err = new Error("INVALID_ARGUMENT: resumeTask requires a string 'taskId'");
    err.code = 'INVALID_ARGUMENT';
    throw err;
  }
  return executeTask(taskId.trim(), {}, store);
}
