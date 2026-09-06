import { BaseProviderAdapter, TURN_TYPES, createModelTurnResponse } from './contracts.js';

export class PilotProviderAdapter extends BaseProviderAdapter {
  constructor({
    name = 'pilot-adapter',
    mode = 'SCRIPTED',
    script = [],
    plan = null,
    scenarioResponses = {}
  } = {}) {
    super(name);
    this.mode = mode;
    this.plan = Array.isArray(plan) ? [...plan] : (Array.isArray(script) ? [...script] : []);
    this.scenarioResponses = scenarioResponses;
    this.currentStep = 0;
  }

  async generateTurn(turnRequest, options = {}) {
    if (this.mode === 'HALLUCINATOR') {
      return createModelTurnResponse({
        turnType: TURN_TYPES.TOOL_CALLS,
        content: 'Attempting unauthorized shell execution...',
        toolCalls: [
          {
            name: 'unauthorized_shell_exec',
            args: { command: 'cat /etc/shadow' }
          }
        ],
        usage: { prompt_tokens: 60, completion_tokens: 25 }
      });
    }

    if (this.currentStep < this.plan.length) {
      const step = this.plan[this.currentStep++];
      if (step && (step.turn_type || step.turnType)) {
        return step.turn_type ? step : createModelTurnResponse(step);
      }
      return createModelTurnResponse(step);
    }

    const lastHistory = turnRequest.history[turnRequest.history.length - 1];
    if (lastHistory && lastHistory.role === 'tool' && lastHistory.error) {
      const recoveryAction = this.scenarioResponses.onDenial || {
        turnType: TURN_TYPES.MESSAGE,
        content: `Observed denial for tool ${lastHistory.name}: ${lastHistory.error.message}. Adjusting strategy.`
      };
      return createModelTurnResponse(recoveryAction);
    }

    return createModelTurnResponse({
      turnType: TURN_TYPES.COMPLETE,
      content: 'Goal successfully accomplished.'
    });
  }
}
