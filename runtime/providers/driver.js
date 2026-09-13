import { TURN_TYPES, createModelTurnRequest } from './contracts.js';
import { createUsageRecord } from '../telemetry/pricing.js';

export class ProviderDriver {
  constructor({
    adapter,
    session,
    maxTurns = 15,
    maxRecoveryAttempts = 3
  }) {
    if (!adapter) throw new Error("ProviderDriver requires 'adapter'");
    if (!session) throw new Error("ProviderDriver requires 'session'");

    this.adapter = adapter;
    this.session = session;
    this.maxTurns = maxTurns;
    this.maxRecoveryAttempts = maxRecoveryAttempts;

    this.history = [];
    this.trace = [];
    this.metrics = {
      turns_used: 0,
      tool_calls: 0,
      successful_tool_calls: 0,
      denial_count: 0,
      repeated_denials: 0,
      recovered_count: 0,
      retried_count: 0,
      aborted_count: 0,
      recovery_attempts: 0
    };

    this.totalUsage = {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      cost_usd: 0,
      by_model: {}
    };

    this.lastDenial = null;
  }

  async step() {
    this.metrics.turns_used++;
    const currentPhase = this.session.getPhase();
    const availableTools = this.session.getAvailableTools ? this.session.getAvailableTools() : [];

    const turnRequest = createModelTurnRequest({
      runId: this.session.sessionId,
      agentId: this.session.agentId,
      currentPhase,
      agentDefinition: this.session.agentDefinition,
      contextBundle: this.session.contextBundle || null,
      history: this.history,
      availableTools,
      skills: this.session.getAttachedSkills ? this.session.getAttachedSkills() : []
    });

    const turnResponse = await this.adapter.generateTurn(turnRequest);

    if (turnResponse.usage) {
      this.totalUsage.prompt_tokens += turnResponse.usage.prompt_tokens || 0;
      this.totalUsage.completion_tokens += turnResponse.usage.completion_tokens || 0;
      this.totalUsage.total_tokens += turnResponse.usage.total_tokens || 0;

      const usageRecord = createUsageRecord({
        model: turnResponse.model || null,
        inputTokens: turnResponse.usage.prompt_tokens || 0,
        outputTokens: turnResponse.usage.completion_tokens || 0,
        reasoningTokens: turnResponse.usage.reasoning_tokens || 0,
        cacheReadTokens: turnResponse.usage.cache_read_tokens || 0,
        cacheWriteTokens: turnResponse.usage.cache_write_tokens || 0
      });

      this.totalUsage.cost_usd = Number((this.totalUsage.cost_usd + usageRecord.cost_usd).toFixed(6));
      const agg = this.totalUsage.by_model[usageRecord.model] || { total_tokens: 0, cost_usd: 0 };
      agg.total_tokens += usageRecord.total_tokens;
      agg.cost_usd = Number((agg.cost_usd + usageRecord.cost_usd).toFixed(6));
      this.totalUsage.by_model[usageRecord.model] = agg;

      if (this.session?.events && typeof this.session.events.append === 'function') {
        this.session.events.append('llm.completed', {
          phase: currentPhase,
          model: usageRecord.model,
          input_tokens: usageRecord.input_tokens,
          output_tokens: usageRecord.output_tokens,
          reasoning_tokens: usageRecord.reasoning_tokens,
          cache_read_tokens: usageRecord.cache_read_tokens,
          cache_write_tokens: usageRecord.cache_write_tokens,
          total_tokens: usageRecord.total_tokens,
          cost_usd: usageRecord.cost_usd
        });
      }
    }

    this.trace.push({
      step: 'model_response',
      phase: currentPhase,
      turn_type: turnResponse.turn_type,
      response: turnResponse
    });

    const executionResults = [];

    switch (turnResponse.turn_type) {
      case TURN_TYPES.MESSAGE: {
        this.history.push({
          role: 'assistant',
          content: turnResponse.content
        });
        break;
      }

      case TURN_TYPES.TOOL_CALLS: {
        this.history.push({
          role: 'assistant',
          content: turnResponse.content || '',
          tool_calls: turnResponse.tool_calls
        });

        for (const tc of turnResponse.tool_calls) {
          this.metrics.tool_calls++;
          let toolResult = null;
          let toolError = null;

          if (this.lastDenial) {
            this.metrics.recovery_attempts++;
            if (this.lastDenial.type === 'tool' && this.lastDenial.target === tc.name) {
              this.metrics.repeated_denials++;
              this.metrics.retried_count++;
            }
          }

          try {
            toolResult = await this.session.executeTool(tc.name, tc.args || {});
            this.metrics.successful_tool_calls++;
            executionResults.push({ call_id: tc.call_id, tool: tc.name, status: 'OK', output: toolResult });
            this.trace.push({ step: 'tool_execution', call_id: tc.call_id, tool: tc.name, status: 'OK' });

            if (this.lastDenial && (!this.lastDenial.type || this.lastDenial.target !== tc.name)) {
              this.metrics.recovered_count++;
              this.lastDenial = null;
            }
          } catch (err) {
            this.metrics.denial_count++;
            toolError = {
              code: err.code || 'EXECUTION_FAILED',
              category: err.category || 'ERROR',
              message: err.message
            };
            executionResults.push({ call_id: tc.call_id, tool: tc.name, status: 'DENIED', error: toolError });
            this.trace.push({ step: 'tool_execution', call_id: tc.call_id, tool: tc.name, status: 'DENIED', error: toolError });

            this.lastDenial = {
              type: 'tool',
              target: tc.name,
              code: err.code || err.category,
              turn: this.metrics.turns_used
            };
          }

          this.history.push({
            role: 'tool',
            call_id: tc.call_id,
            name: tc.name,
            content: toolResult ? JSON.stringify(toolResult) : null,
            error: toolError
          });
        }
        break;
      }

      case TURN_TYPES.TRANSITION: {
        let transitionOk = false;
        let transitionError = null;

        if (this.lastDenial) {
          this.metrics.recovery_attempts++;
          if (this.lastDenial.type === 'transition' && this.lastDenial.target === turnResponse.target_phase) {
            this.metrics.repeated_denials++;
            this.metrics.retried_count++;
          }
        }

        try {
          this.session.transition(turnResponse.target_phase);
          transitionOk = true;
          this.trace.push({ step: 'transition', target: turnResponse.target_phase, status: 'OK' });

          if (this.lastDenial) {
            this.metrics.recovered_count++;
            this.lastDenial = null;
          }
        } catch (err) {
          this.metrics.denial_count++;
          transitionError = {
            code: err.code || 'LIFECYCLE_DENIED',
            message: err.message
          };
          this.trace.push({ step: 'transition', target: turnResponse.target_phase, status: 'DENIED', error: transitionError });

          this.lastDenial = {
            type: 'transition',
            target: turnResponse.target_phase,
            code: err.code || 'LIFECYCLE_DENIED',
            turn: this.metrics.turns_used
          };
        }

        this.history.push({
          role: 'system',
          action: 'transition',
          target: turnResponse.target_phase,
          status: transitionOk ? 'OK' : 'DENIED',
          error: transitionError
        });
        break;
      }

      case TURN_TYPES.COMPLETE: {
        let completionOk = false;
        let completionError = null;

        try {
          this.session.complete('completed');
          completionOk = true;
          this.trace.push({ step: 'complete', status: 'OK' });
          if (this.lastDenial) {
            this.metrics.recovered_count++;
            this.lastDenial = null;
          }
        } catch (err) {
          this.metrics.denial_count++;
          completionError = {
            code: err.code || 'LIFECYCLE_COMPLETION_DENIED',
            message: err.message
          };
          this.trace.push({ step: 'complete', status: 'DENIED', error: completionError });
          this.lastDenial = {
            type: 'complete',
            code: err.code || 'LIFECYCLE_COMPLETION_DENIED',
            turn: this.metrics.turns_used
          };
        }

        this.history.push({
          role: 'system',
          action: 'complete',
          status: completionOk ? 'OK' : 'DENIED',
          error: completionError
        });
        break;
      }
    }

    const isComplete = this.session.state?.status === 'completed';

    return {
      turnResponse,
      executionResults,
      currentPhase: this.session.getPhase(),
      isComplete,
      metrics: { ...this.metrics }
    };
  }

  getDerivedMetrics() {
    const { tool_calls, successful_tool_calls, denial_count, recovered_count } = this.metrics;
    const tool_efficiency_ratio = tool_calls > 0 ? (successful_tool_calls / tool_calls) : 1.0;
    const recovery_rate = denial_count > 0 ? (recovered_count / denial_count) : 1.0;
    const denial_rate = tool_calls > 0 ? (denial_count / tool_calls) : 0.0;

    return {
      ...this.metrics,
      tool_efficiency_ratio: Number(tool_efficiency_ratio.toFixed(3)),
      recovery_rate: Number(recovery_rate.toFixed(3)),
      denial_rate: Number(denial_rate.toFixed(3)),
      max_turns_reached: this.metrics.turns_used >= this.maxTurns && this.session.state?.status !== 'completed'
    };
  }

  async run() {
    while (this.metrics.turns_used < this.maxTurns && this.session.state?.status !== 'completed') {
      const result = await this.step();
      if (result.isComplete) break;
    }

    if (this.lastDenial && this.session.state?.status !== 'completed') {
      this.metrics.aborted_count++;
    }

    return {
      turns: this.metrics.turns_used,
      status: this.session.state?.status || 'running',
      finalPhase: this.session.getPhase(),
      totalUsage: this.totalUsage,
      metrics: this.getDerivedMetrics(),
      trace: this.trace,
      history: this.history
    };
  }
}
