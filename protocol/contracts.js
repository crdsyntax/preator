export const TASK_STATUS = Object.freeze({
  CREATED: 'created',
  RUNNING: 'running',
  PENDING_APPROVAL: 'pending_approval',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
});

export const PROTOCOL_OPERATIONS = Object.freeze({
  CREATE_TASK: 'create_task',
  EXECUTE_TASK: 'execute_task',
  GET_TASK: 'get_task',
  APPROVE_TASK: 'approve_task',
  CANCEL_TASK: 'cancel_task',
  RESUME_TASK: 'resume_task'
});

export function validateTaskRequest(req) {
  if (!req || typeof req !== 'object') {
    return { valid: false, error: 'TaskRequest must be an object' };
  }
  if (!req.goal && !req.task && !req.prompt) {
    return { valid: false, error: "TaskRequest must contain a 'goal', 'task', or 'prompt'" };
  }
  return { valid: true, error: null };
}

export function validateTaskOperation(op) {
  if (!Object.values(PROTOCOL_OPERATIONS).includes(op)) {
    return { valid: false, error: `Invalid operation: ${op}. Must be one of: ${Object.values(PROTOCOL_OPERATIONS).join(', ')}` };
  }
  return { valid: true, error: null };
}
