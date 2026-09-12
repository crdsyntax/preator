import fs from "node:fs";
import path from "node:path";
import { validateTraceSequence } from "./lifecycle.js";
import { withLock } from "./locks.js";
import {
  SEAL_VERSION,
  SEAL_ALGOS,
  createSeal,
  verifySeal,
  verifyChainSegment,
  legacyStateHash,
  resolveStateKey
} from "./sealing.js";

export const DEFAULT_SESSIONS_ROOT = path.join(process.cwd(), '.agent', 'sessions');

export function defaultStateKeyPath() {
  return path.join(process.cwd(), '.agent', 'state.key');
}

export function computeStateHash(fields) {
  return legacyStateHash(fields);
}

export class SessionState {
  constructor({
    sessionId,
    agentId = 'orchestrator',
    goal = '',
    context = {},
    status = 'running',
    iteration = 0,
    currentPhase = 'REQUEST',
    pendingApproval = null,
    approvals = [],
    stateHash = null,
    sealVersion = null,
    sealKey = undefined,
    keyPath = null,
    strictSeal = false,
    tampered = false,
    sessionsRoot = DEFAULT_SESSIONS_ROOT
  }) {
    this.version = '1.0';
    this.sessionId = sessionId || `run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this.agentId = agentId;
    this.goal = goal;
    this.context = context;
    this.status = status;
    this.iteration = iteration;
    this.currentPhase = currentPhase;
    this.pendingApproval = pendingApproval;
    this.approvals = Array.isArray(approvals) ? approvals : [];
    this.tampered = tampered;
    this.sessionsRoot = sessionsRoot;
    this.sessionDir = path.join(this.sessionsRoot, this.sessionId);
    this.filePath = path.join(this.sessionDir, 'state.json');

    this.sealKey = sealKey !== undefined
      ? sealKey
      : resolveStateKey({ keyPath: keyPath || defaultStateKeyPath(), required: strictSeal, allowLegacy: !strictSeal });
    this.sealVersion = sealVersion || (this.sealKey ? SEAL_VERSION : 1);
    this.sealAlgo = this.sealVersion === SEAL_VERSION ? SEAL_ALGOS.V2 : SEAL_ALGOS.V1;
    this.stateHash = stateHash;

    if (!this.stateHash) {
      this._applySeal();
    }

    this.ensureDirectory();
  }

  get state_hash() {
    return this.stateHash;
  }

  _sealFields() {
    return {
      sessionId: this.sessionId,
      currentPhase: this.currentPhase,
      iteration: this.iteration,
      status: this.status,
      agentId: this.agentId,
      pendingApproval: this.pendingApproval,
      approvals: this.approvals,
      goal: this.goal,
      context: this.context
    };
  }

  _applySeal() {
    const seal = createSeal({ fields: this._sealFields(), key: this.sealKey, version: this.sealVersion });
    this.stateHash = seal.state_hash;
    this.sealVersion = seal.seal_version;
    this.sealAlgo = seal.seal_algo;
  }

  ensureDirectory() {
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }
  }

  toJSON() {
    this._applySeal();

    return {
      version: this.version,
      seal_version: this.sealVersion,
      seal_algo: this.sealAlgo,
      session_id: this.sessionId,
      agent_id: this.agentId,
      status: this.status,
      iteration: this.iteration,
      current_phase: this.currentPhase,
      goal: this.goal,
      context: this.context,
      pending_approval: this.pendingApproval,
      approvals: this.approvals,
      state_hash: this.stateHash,
      tampered: this.tampered,
      updated_at: new Date().toISOString()
    };
  }

  save() {
    this.ensureDirectory();
    const lockPath = path.join(this.sessionDir, '.state.lock');
    return withLock(lockPath, () => {
      const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(this.toJSON(), null, 2), 'utf8');
      fs.renameSync(tempPath, this.filePath);
      return this.filePath;
    });
  }

  static load(sessionId, sessionsRoot = DEFAULT_SESSIONS_ROOT, { key = undefined, keyPath = null, strictSeal = false } = {}) {
    const sessionDir = path.join(sessionsRoot, sessionId);
    const filePath = path.join(sessionDir, 'state.json');
    if (!fs.existsSync(filePath)) {
      throw new Error(`Session state file not found: ${filePath}`);
    }

    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

      const resolvedKey = key !== undefined
        ? key
        : resolveStateKey({ keyPath: keyPath || defaultStateKeyPath(), required: strictSeal, allowLegacy: !strictSeal });
      const declaredVersion = data.seal_version === SEAL_VERSION ? SEAL_VERSION : 1;

      const fields = {
        sessionId: data.session_id,
        currentPhase: data.current_phase,
        iteration: data.iteration,
        status: data.status,
        agentId: data.agent_id,
        pendingApproval: data.pending_approval,
        approvals: data.approvals,
        goal: data.goal,
        context: data.context
      };

      let isTampered = false;
      const hasValidSeal = typeof data.state_hash === 'string' && /^[0-9a-f]{64}$/i.test(data.state_hash);
      if (!hasValidSeal) {
        console.warn(`[SessionState] Tampering detected in ${sessionId}: state_hash is missing or malformed.`);
        isTampered = true;
      } else if (declaredVersion === SEAL_VERSION && !resolvedKey) {
        console.warn(`[SessionState] Tampering detected in ${sessionId}: v2 seal present but no seal key available.`);
        isTampered = true;
      } else if (!verifySeal({ fields, seal: data, key: resolvedKey, version: declaredVersion })) {
        console.warn(`[SessionState] Tampering detected in ${sessionId}: state_hash mismatch.`);
        isTampered = true;
      }

      const eventsPath = path.join(sessionDir, 'events.jsonl');
      if (fs.existsSync(eventsPath)) {
        const lines = fs.readFileSync(eventsPath, 'utf8').trim().split('\n').filter(Boolean);
        const events = lines.map(l => {
          try { return JSON.parse(l); } catch { return null; }
        }).filter(Boolean);

        const traceResult = validateTraceSequence(events);
        if (!traceResult.valid) {
          console.warn(`[SessionState] Tampering detected in ${sessionId}: invalid event transition sequence.`);
          isTampered = true;
        } else if (events.length > 0 && traceResult.terminalPhase !== data.current_phase) {
          console.warn(`[SessionState] Tampering detected in ${sessionId}: state.current_phase '${data.current_phase}' does not match event trace terminal '${traceResult.terminalPhase}'.`);
          isTampered = true;
        }

        const chainResult = verifyChainSegment(events, { key: resolvedKey });
        if (!chainResult.valid) {
          console.warn(`[SessionState] Tampering detected in ${sessionId}: event hash chain broken (${chainResult.reason} at index ${chainResult.brokenAt}).`);
          isTampered = true;
        }
      }

      const effectivePhase = isTampered ? 'REQUEST' : data.current_phase;

      return new SessionState({
        sessionId: data.session_id,
        agentId: data.agent_id,
        goal: data.goal,
        context: data.context,
        status: isTampered ? 'tampered' : data.status,
        iteration: data.iteration,
        currentPhase: effectivePhase,
        pendingApproval: data.pending_approval,
        approvals: data.approvals,
        stateHash: isTampered ? null : data.state_hash,
        sealVersion: declaredVersion,
        sealKey: resolvedKey,
        tampered: isTampered,
        sessionsRoot
      });
    } catch (err) {
      console.warn(`[SessionState] State corrupted for ${sessionId}, fallback initialized: ${err.message}`);
      return new SessionState({ sessionId, sessionsRoot, tampered: true });
    }
  }
}
