import { EventEmitter } from "node:events";

export const APPROVAL_STATUS = Object.freeze({
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
  USED: 'USED'
});

export const APPROVAL_ERRORS = Object.freeze({
  NOT_FOUND: 'APPROVAL_NOT_FOUND',
  ALREADY_RESOLVED: 'APPROVAL_ALREADY_RESOLVED',
  ACTOR_REQUIRED: 'APPROVAL_ACTOR_REQUIRED',
  EXPIRED: 'APPROVAL_EXPIRED'
});

export const DEFAULT_APPROVAL_TTL_MS = 15 * 60 * 1000;

function randomToken() {
  return Math.random().toString(36).slice(2, 10);
}

export class ApprovalManager extends EventEmitter {
  constructor({ onChange = null, ttlMs = DEFAULT_APPROVAL_TTL_MS } = {}) {
    super();
    this.requests = new Map();
    this.onChange = onChange;
    this.ttlMs = ttlMs;
  }

  _change() {
    if (typeof this.onChange === 'function') {
      this.onChange(this.toJSON());
    }
  }

  _isExpired(request) {
    if (!request.expires_at) return false;
    return Date.parse(request.expires_at) < Date.now();
  }

  requestApproval({
    action,
    description,
    metadata = {},
    requestId = null,
    canonicalHash = null,
    riskLevel = null,
    requestedBy = null,
    ttlMs = null
  } = {}) {
    const approvalId = `appr-${Date.now()}-${randomToken()}`;
    const now = Date.now();
    const request = {
      id: approvalId,
      approval_id: approvalId,
      action,
      description,
      metadata,
      request_id: requestId,
      canonical_hash: canonicalHash,
      risk_level: riskLevel,
      nonce: `nonce-${randomToken()}`,
      requested_by: requestedBy,
      status: APPROVAL_STATUS.PENDING,
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + (ttlMs || this.ttlMs)).toISOString(),
      resolved_at: null,
      resolved_by: null,
      reason: '',
      used_at: null,
      used_by: null
    };

    this.requests.set(approvalId, request);
    this.emit('approval.requested', request);
    this._change();
    return request;
  }

  resolveApproval(approvalId, resolution = {}, reason = '') {
    const req = this.requests.get(approvalId);
    if (!req) {
      const err = new Error(`Approval request '${approvalId}' not found`);
      err.code = APPROVAL_ERRORS.NOT_FOUND;
      throw err;
    }
    if (req.status !== APPROVAL_STATUS.PENDING) {
      const err = new Error(`Approval request '${approvalId}' already resolved as ${req.status}`);
      err.code = APPROVAL_ERRORS.ALREADY_RESOLVED;
      throw err;
    }
    if (this._isExpired(req)) {
      req.status = APPROVAL_STATUS.EXPIRED;
      this._change();
      const err = new Error(`Approval request '${approvalId}' has expired`);
      err.code = APPROVAL_ERRORS.EXPIRED;
      throw err;
    }

    let isApproved = false;
    let resolvedBy = null;
    let resolutionReason = reason;

    if (typeof resolution === 'object' && resolution !== null) {
      isApproved = Boolean(resolution.approved);
      resolvedBy = resolution.resolvedBy || resolution.resolved_by || null;
      resolutionReason = resolution.reason || reason;
    } else if (typeof resolution === 'string') {
      isApproved = ['granted', 'approved', 'approve'].includes(resolution.toLowerCase());
    } else if (typeof resolution === 'boolean') {
      isApproved = resolution;
    }

    if (!resolvedBy || typeof resolvedBy !== 'string' || !resolvedBy.trim()) {
      const err = new Error(
        `Approval resolution for '${approvalId}' requires an explicit 'resolved_by' actor.`
      );
      err.code = APPROVAL_ERRORS.ACTOR_REQUIRED;
      throw err;
    }

    req.status = isApproved ? APPROVAL_STATUS.APPROVED : APPROVAL_STATUS.REJECTED;
    req.resolved_at = new Date().toISOString();
    req.resolved_by = resolvedBy.trim();
    req.reason = resolutionReason;

    const eventName = isApproved ? 'approval.granted' : 'approval.rejected';
    this.emit(eventName, req);
    this._change();
    return req;
  }

  decide(approvalId, decision, comment = '') {
    return this.resolveApproval(approvalId, decision, comment);
  }

  verifyGrant({ requestId = null, canonicalHash = null, action = null } = {}) {
    for (const req of this.requests.values()) {
      if (req.status !== APPROVAL_STATUS.APPROVED) continue;
      if (req.used_at) continue;
      if (this._isExpired(req)) continue;
      if (requestId !== null && req.request_id !== requestId) continue;
      if (canonicalHash !== null && req.canonical_hash !== canonicalHash) continue;
      if (action !== null && req.action !== action) continue;
      return { valid: true, request: req, reason: null };
    }
    return { valid: false, request: null, reason: 'NO_MATCHING_GRANT' };
  }

  consumeGrant(approvalId, usedBy = 'gateway') {
    const req = this.requests.get(approvalId);
    if (!req) return null;
    req.used_at = new Date().toISOString();
    req.used_by = usedBy;
    req.status = APPROVAL_STATUS.USED;
    this.emit('approval.consumed', req);
    this._change();
    return req;
  }

  getPending() {
    return Array.from(this.requests.values()).filter(r => r.status === APPROVAL_STATUS.PENDING);
  }

  get(approvalId) {
    return this.requests.get(approvalId) || null;
  }

  toJSON() {
    return Array.from(this.requests.values()).map(r => ({ ...r }));
  }

  load(records = []) {
    if (!Array.isArray(records)) return;
    for (const record of records) {
      if (record && record.id) {
        this.requests.set(record.id, { ...record });
      }
    }
  }
}
