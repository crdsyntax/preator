import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { validateTraceSequence } from "./lifecycle.js";

export const DEFAULT_SESSIONS_ROOT = path.join(process.cwd(), '.agent', 'sessions');

export function computeStateHash({ sessionId, currentPhase, iteration, status, agentId }) {
  const payload = `${sessionId}:${currentPhase}:${iteration}:${status}:${agentId}`;
  return crypto.createHash('sha256').update(payload).digest('hex');
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
    stateHash = null,
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
    this.stateHash = stateHash || computeStateHash({
      sessionId: this.sessionId,
      currentPhase: this.currentPhase,
      iteration: this.iteration,
      status: this.status,
      agentId: this.agentId
    });
    this.tampered = tampered;
    this.sessionsRoot = sessionsRoot;
    this.sessionDir = path.join(this.sessionsRoot, this.sessionId);
    this.filePath = path.join(this.sessionDir, 'state.json');

    this.ensureDirectory();
  }

  ensureDirectory() {
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }
  }

  toJSON() {
    this.stateHash = computeStateHash({
      sessionId: this.sessionId,
      currentPhase: this.currentPhase,
      iteration: this.iteration,
      status: this.status,
      agentId: this.agentId
    });

    return {
      version: this.version,
      session_id: this.sessionId,
      agent_id: this.agentId,
      status: this.status,
      iteration: this.iteration,
      current_phase: this.currentPhase,
      goal: this.goal,
      context: this.context,
      pending_approval: this.pendingApproval,
      state_hash: this.stateHash,
      tampered: this.tampered,
      updated_at: new Date().toISOString()
    };
  }

  save() {
    this.ensureDirectory();
    fs.writeFileSync(this.filePath, JSON.stringify(this.toJSON(), null, 2), 'utf8');
    return this.filePath;
  }

  static load(sessionId, sessionsRoot = DEFAULT_SESSIONS_ROOT) {
    const sessionDir = path.join(sessionsRoot, sessionId);
    const filePath = path.join(sessionDir, 'state.json');
    if (!fs.existsSync(filePath)) {
      throw new Error(`Session state file not found: ${filePath}`);
    }

    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

      const expectedHash = computeStateHash({
        sessionId: data.session_id,
        currentPhase: data.current_phase,
        iteration: data.iteration,
        status: data.status,
        agentId: data.agent_id
      });

      let isTampered = false;
      if (data.state_hash && data.state_hash !== expectedHash) {
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
        stateHash: data.state_hash,
        tampered: isTampered,
        sessionsRoot
      });
    } catch (err) {
      console.warn(`[SessionState] State corrupted for ${sessionId}, fallback initialized: ${err.message}`);
      return new SessionState({ sessionId, sessionsRoot, tampered: true });
    }
  }
}
