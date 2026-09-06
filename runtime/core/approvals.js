import { EventEmitter } from "node:events";

export const APPROVAL_STATUS = Object.freeze({
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED'
});

export class ApprovalManager extends EventEmitter {
  constructor() {
    super();
    this.requests = new Map();
  }

  requestApproval({ action, description, metadata = {} }) {
    const approvalId = `appr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const request = {
      id: approvalId,
      approval_id: approvalId,
      action,
      description,
      metadata,
      status: APPROVAL_STATUS.PENDING,
      created_at: new Date().toISOString(),
      resolved_at: null,
      resolved_by: null
    };

    this.requests.set(approvalId, request);
    this.emit('approval.requested', request);
    return request;
  }

  resolveApproval(approvalId, resolution, reason = '') {
    const req = this.requests.get(approvalId);
    if (!req) {
      throw new Error(`Approval request '${approvalId}' not found`);
    }
    if (req.status !== APPROVAL_STATUS.PENDING) {
      throw new Error(`Approval request '${approvalId}' already resolved as ${req.status}`);
    }

    let isApproved = false;
    let resolvedBy = 'human';
    let resolutionReason = reason;

    if (typeof resolution === 'object' && resolution !== null) {
      isApproved = Boolean(resolution.approved);
      resolvedBy = resolution.resolvedBy || 'human';
      resolutionReason = resolution.reason || reason;
    } else if (typeof resolution === 'string') {
      isApproved = resolution.toLowerCase() === 'granted' || resolution.toLowerCase() === 'approved';
    } else if (typeof resolution === 'boolean') {
      isApproved = resolution;
    }

    req.status = isApproved ? APPROVAL_STATUS.APPROVED : APPROVAL_STATUS.REJECTED;
    req.resolved_at = new Date().toISOString();
    req.resolved_by = resolvedBy;
    req.reason = resolutionReason;

    const eventName = isApproved ? 'approval.granted' : 'approval.rejected';
    this.emit(eventName, req);
    return req;
  }

  decide(approvalId, decision, comment = '') {
    return this.resolveApproval(approvalId, decision, comment);
  }

  getPending() {
    return Array.from(this.requests.values()).filter(r => r.status === APPROVAL_STATUS.PENDING);
  }

  get(approvalId) {
    return this.requests.get(approvalId) || null;
  }
}
