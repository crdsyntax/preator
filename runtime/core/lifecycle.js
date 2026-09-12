import { PHASES, ALLOWED_WRITE_PHASES, WRITE_TOOLS, TRANSITION_GRAPH } from './contracts.js';

export { PHASES, ALLOWED_WRITE_PHASES, WRITE_TOOLS, TRANSITION_GRAPH };

export class LifecycleMachine {
  constructor(initialPhase = 'REQUEST') {
    if (!PHASES.includes(initialPhase)) {
      throw new Error(`Invalid initial phase: ${initialPhase}`);
    }
    this.currentPhase = initialPhase;
  }

  getPhase() {
    return this.currentPhase;
  }

  canTransition(targetPhase) {
    const allowed = TRANSITION_GRAPH[this.currentPhase];
    return allowed ? allowed.has(targetPhase) : false;
  }

  transition(targetPhase) {
    if (!this.canTransition(targetPhase)) {
      const error = new Error(
        `Lifecycle violation: Cannot transition from ${this.currentPhase} to ${targetPhase}. Sequential order required.`
      );
      error.code = 'LIFECYCLE_SKIP_DENIED';
      error.currentPhase = this.currentPhase;
      error.targetPhase = targetPhase;
      throw error;
    }
    const previous = this.currentPhase;
    this.currentPhase = targetPhase;
    return { previous, current: this.currentPhase };
  }

  isWriteAllowed() {
    return ALLOWED_WRITE_PHASES.has(this.currentPhase);
  }

  isWriteTool(toolName) {
    return WRITE_TOOLS.has(toolName);
  }
}

export function validateTraceSequence(events = []) {
  let simulatedPhase = null;
  for (const evt of events) {
    const evtType = evt.event_type || evt.type;
    const phaseField = evt.data?.to || evt.data?.targetPhase || evt.data?.phase || evt.to || evt.to_phase || evt.phase;

    if (evtType !== 'lifecycle.phase_changed') {
      if (simulatedPhase === null && phaseField) simulatedPhase = phaseField;
      continue;
    }

    const target = phaseField;
    if (!target) continue;

    if (simulatedPhase === null) {
      simulatedPhase = target;
      continue;
    }
    if (target === 'REQUEST') {
      simulatedPhase = 'REQUEST';
      continue;
    }
    const allowed = TRANSITION_GRAPH[simulatedPhase];
    if (!allowed || !allowed.has(target)) {
      return {
        valid: false,
        reason: `Illegal transition from '${simulatedPhase}' to '${target}'. Trace broke strict lifecycle graph.`,
        phase: simulatedPhase,
        attempted: target
      };
    }
    simulatedPhase = target;
  }
  return { valid: true, terminalPhase: simulatedPhase ?? 'REQUEST' };
}
