import { ProviderDriver } from './providers/driver.js';
import { PilotProviderAdapter } from './providers/pilot-adapter.js';
import { TURN_TYPES } from './providers/contracts.js';

export class AgentRuntime {
  constructor({
    session,
    agentId = 'orchestrator',
    providerAdapter = null,
    agentDefinition = null
  }) {
    if (!session) {
      throw new Error('AgentRuntime requires an active AgentSession');
    }

    this.session = session;
    this.agentId = agentId;
    this.agentDefinition = agentDefinition || (session.agentCatalog ? session.agentCatalog.get(agentId) : null);
    this.providerAdapter = providerAdapter || new PilotProviderAdapter({ name: `${agentId}-adapter` });
    this.driver = new ProviderDriver({
      adapter: this.providerAdapter,
      session: this.session
    });
  }

  async runTurn(prompt = '') {
    if (prompt) {
      this.driver.history.push({
        role: 'user',
        content: prompt
      });
    }

    const stepResult = await this.driver.step();
    return {
      agentId: this.agentId,
      phase: this.session.getPhase(),
      turnResult: stepResult,
      history: this.driver.history,
      metrics: this.driver.metrics
    };
  }

  async executeSpecialistSubtask({ specialistId, subtask, toolInvocations = [] }) {
    return this.session.delegate({
      childAgentId: specialistId,
      task: {
        id: `task-${Date.now()}`,
        description: subtask
      },
      childExecutorFn: async (childSession) => {
        const childRuntime = new AgentRuntime({
          session: childSession,
          agentId: specialistId,
          providerAdapter: this.providerAdapter,
          agentDefinition: childSession.agentDefinition
        });

        const executedTools = [];
        for (const tool of toolInvocations) {
          const out = await childSession.executeTool(tool.name, tool.args || {});
          executedTools.push({ tool: tool.name, output: out });
        }

        const turn = await childRuntime.runTurn(subtask);

        return {
          specialistId,
          status: 'completed',
          executedTools,
          findings: turn.history.filter(h => h.role === 'assistant').map(h => h.content).join('\n') || 'Completed'
        };
      }
    });
  }
}
