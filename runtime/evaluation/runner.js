import path from "node:path";
import os from "node:os";
import fs from "node:fs";

import { createSession, VERSION } from '../index.js';
import { AgentCatalog } from '../core/agents.js';
import { createEvaluationResult, EVALUATION_STATUS } from './contracts.js';
import * as assertions from './assertions.js';
import { Scorecard } from './scorecard.js';
import { RegressionTracker } from './regression.js';

const AGENT_ID_ALIASES = Object.freeze({
  'qa-engineer': 'qa-tester',
  'code-review': 'code-reviewer',
  'reviewer': 'code-reviewer'
});

export class EvaluationRunner {
  constructor({
    agentsDir = null,
    sessionsRoot = null,
    benchmarksDir = null,
    version = VERSION
  } = {}) {
    const root = process.cwd();
    this.agentsDir = agentsDir || path.join(root, 'agents');
    this.sessionsRoot = sessionsRoot || path.join(os.tmpdir(), `agents-eval-sessions-${Date.now()}`);
    this.version = version;
    this.tracker = new RegressionTracker({ benchmarksDir });

    if (!fs.existsSync(this.sessionsRoot)) {
      fs.mkdirSync(this.sessionsRoot, { recursive: true });
    }

    this.loadedAgents = new Map();
  }

  getAgentDefinition(agentId) {
    const canonicalId = AGENT_ID_ALIASES[agentId] || agentId;
    if (this.loadedAgents.has(canonicalId)) {
      return this.loadedAgents.get(canonicalId);
    }

    if (!this.agentCatalog) {
      this.agentCatalog = new AgentCatalog();
      if (fs.existsSync(this.agentsDir)) {
        this.agentCatalog.loadFromDir(this.agentsDir);
      }
    }

    const def = this.agentCatalog.get(canonicalId);
    if (def) {
      this.loadedAgents.set(canonicalId, def);
    }
    return def;
  }

  async runScenario(scenario) {
    const startMs = Date.now();
    const agentDef = this.getAgentDefinition(scenario.agent);

    const sessionId = `eval-${scenario.id}-${Date.now()}`;
    const session = createSession({
      sessionId,
      agentId: scenario.agent || 'orchestrator',
      agentDefinition: agentDef,
      sessionsRoot: this.sessionsRoot
    });

    let executorCalls = 0;
    const defaultExecutor = async () => {
      executorCalls++;
      return 'executed';
    };

    session.registerTool({ name: 'write', executor: defaultExecutor });
    session.registerTool({ name: 'read', executor: async () => { executorCalls++; return 'content'; } });
    session.registerTool({ name: 'bash', executor: defaultExecutor });
    session.registerTool({ name: 'run_command', executor: defaultExecutor });

    if (scenario.initial_phase && scenario.initial_phase !== 'REQUEST') {
      const phases = ['ANALYZE', 'PLAN', 'REVIEW', 'EXECUTE', 'VERIFY', 'DOCUMENT', 'COMPLETE'];
      for (const p of phases) {
        session.transition(p);
        if (p === scenario.initial_phase) break;
      }
    }

    let executionOutput = null;
    let executionError = null;
    const trace = [];

    try {
      if (typeof scenario.executeFn === 'function') {
        executionOutput = await scenario.executeFn(session, {
          executorCalls: () => executorCalls,
          registerTool: (name, fn) => session.registerTool({ name, executor: fn }),
          scenario,
          trace: (step) => trace.push({ time: Date.now(), ...step })
        });
      } else if (scenario.steps && scenario.steps.length > 0) {
        for (const step of scenario.steps) {
          if (step.type === 'tool_request') {
            const req = await session.executeTool(step.tool, step.args || {});
            trace.push({ step: 'tool_request', tool: step.tool, result: req });
          } else if (step.type === 'transition') {
            session.transition(step.target);
            trace.push({ step: 'transition', target: step.target });
          }
        }
      }
    } catch (err) {
      executionError = err;
    }

    const durationMs = Date.now() - startMs;
    const assertionsPassed = [];
    const assertionsFailed = [];

    const evaluationContext = {
      session,
      agentDefinition: agentDef,
      output: executionOutput,
      error: executionError,
      executorCalls,
      durationMs,
      trace
    };

    for (const assertion of scenario.assertions) {
      try {
        if (typeof assertion === 'function') {
          const pass = assertion(evaluationContext, assertions);
          if (pass) assertionsPassed.push(assertion.name || 'customAssertion');
        } else if (typeof assertion === 'string' && assertions[assertion]) {
          assertions[assertion](evaluationContext);
          assertionsPassed.push(assertion);
        }
      } catch (err) {
        assertionsFailed.push({
          assertion: typeof assertion === 'string' ? assertion : (assertion.name || 'customAssertion'),
          message: err.message,
          expected: err.expected,
          actual: err.actual
        });
      }
    }

    const status = assertionsFailed.length === 0 ? EVALUATION_STATUS.PASSED : EVALUATION_STATUS.FAILED;

    return createEvaluationResult({
      scenarioId: scenario.id,
      category: scenario.category,
      status,
      durationMs,
      assertionsPassed,
      assertionsFailed,
      trace,
      metrics: {
        executor_calls: executorCalls,
        duration_ms: durationMs,
        events_emitted: session.events?.events?.length || 0
      },
      error: executionError
    });
  }

  async runSuite(scenarios = [], { baselineSuite = 'baseline-v2', saveRun = true } = {}) {
    const results = [];
    for (const s of scenarios) {
      const res = await this.runScenario(s);
      results.push(res);
    }

    const baseline = this.tracker.getBaseline(baselineSuite);
    const comparison = this.tracker.compare(results, baseline);

    const scorecard = new Scorecard({
      version: this.version,
      results,
      baselineComparison: comparison
    });

    if (saveRun) {
      this.tracker.saveRun(scorecard.toJSON());
    }

    return scorecard;
  }
}
