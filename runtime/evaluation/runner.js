import path from "node:path";
import os from "node:os";
import fs from "node:fs";

import { createSession, VERSION } from '../index.js';
import { loadAgentFromMarkdown } from '../core/agents.js';
import { createEvaluationResult, EVALUATION_STATUS } from './contracts.js';
import * as assertions from './assertions.js';
import { Scorecard } from './scorecard.js';
import { RegressionTracker } from './regression.js';

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
    if (this.loadedAgents.has(agentId)) {
      return this.loadedAgents.get(agentId);
    }

    let filePath;
    if (agentId === 'orchestrator') {
      filePath = path.join(this.agentsDir, 'orchestrator.md');
    } else if (agentId === 'backend-engineer') {
      filePath = path.join(this.agentsDir, 'backend', 'engineer.md');
    } else if (agentId === 'frontend-engineer') {
      filePath = path.join(this.agentsDir, 'frontend', 'engineer.md');
    } else if (agentId === 'database-engineer') {
      filePath = path.join(this.agentsDir, 'database', 'engineer.md');
    } else if (agentId === 'qa-engineer' || agentId === 'qa-tester') {
      filePath = path.join(this.agentsDir, 'qa', 'tester.md');
    } else if (agentId === 'code-reviewer') {
      filePath = path.join(this.agentsDir, 'reviews', 'review.md');
    } else if (agentId === 'security-devops') {
      filePath = path.join(this.agentsDir, 'security', 'devops.md');
    } else if (agentId === 'core-engineering') {
      filePath = path.join(this.agentsDir, 'core', 'engineering.md');
    } else if (agentId === 'core-security') {
      filePath = path.join(this.agentsDir, 'core', 'security.md');
    } else {
      filePath = path.join(this.agentsDir, `${agentId}.md`);
    }

    if (fs.existsSync(filePath)) {
      const def = loadAgentFromMarkdown(filePath);
      this.loadedAgents.set(agentId, def);
      return def;
    }
    return null;
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
