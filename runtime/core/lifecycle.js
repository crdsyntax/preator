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
    if (targetPhase === 'REQUEST') return true;
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
  let simulatedPhase = 'REQUEST';
  for (const evt of events) {
    if (evt.event_type === 'lifecycle.phase_changed' || evt.type === 'lifecycle.phase_changed') {
      const target = evt.data?.to || evt.data?.targetPhase || evt.data?.phase || evt.to;
      if (!target) continue;
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
  }
  return { valid: true, terminalPhase: simulatedPhase };
}
