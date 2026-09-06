#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { EvaluationRunner } from '../runtime/evaluation/runner.js';
import { Scorecard } from '../runtime/evaluation/scorecard.js';
import { RegressionTracker } from '../runtime/evaluation/regression.js';
import { VERSION } from '../runtime/index.js';

import { scenarios as secScenarios } from '../evaluations/security/adversarial.js';
import { scenarios as behScenarios } from '../evaluations/behavioral/database-optimization.js';
import { scenarios as retScenarios } from '../evaluations/retrieval/context-governance.js';
import { scenarios as lifScenarios } from '../evaluations/lifecycle/fsm-circuit.js';
import { scenarios as delScenarios } from '../evaluations/delegation/depth-concurrency.js';
import { scenarios as modScenarios } from '../evaluations/providers/model-governance.js';
import { scenarios as hstScenarios } from '../evaluations/hosts/host-boundary.js';
import { scenarios as cfgScenarios } from '../evaluations/config/config-governance.js';
import { scenarios as stkScenarios } from '../evaluations/stacks/multi-stack.js';

const ALL_SCENARIOS = [
  ...secScenarios,
  ...behScenarios,
  ...retScenarios,
  ...lifScenarios,
  ...delScenarios,
  ...modScenarios,
  ...hstScenarios,
  ...cfgScenarios,
  ...stkScenarios
];

async function runEvaluation() {
  console.log('\x1b[1m\x1b[35m=== Praetor Benchmark Harness (v0.1.1) ===\x1b[0m\n');
  console.log(`Loaded ${ALL_SCENARIOS.length} scenarios across 9 evaluation suites.\n`);

  const runner = new EvaluationRunner();
  const tracker = new RegressionTracker();

  const results = [];
  for (const s of ALL_SCENARIOS) {
    const res = await runner.runScenario(s);
    results.push(res);
  }

  let baselineSuite = 'baseline-v2';
  let baseline = tracker.getBaseline(baselineSuite);
  if (!baseline) {
    baseline = tracker.getBaseline('baseline-v1');
    if (baseline) baselineSuite = 'baseline-v1';
  }

  const comparison = tracker.compare(results, baseline);

  const scorecard = new Scorecard({
    runId: `run-${Date.now()}`,
    version: VERSION,
    results,
    baselineComparison: comparison
  });

  console.log(scorecard.formatAscii());

  const scorecardJson = scorecard.toJSON();
  const savedRunPath = tracker.saveRun(scorecardJson);
  console.log(`Saved evaluation run artifact to: ${savedRunPath}`);

  if (!tracker.getBaseline('baseline-v2')) {
    const savedBaselinePath = tracker.saveBaseline('baseline-v2', scorecardJson);
    console.log(`Initialized baseline-v2 artifact (35 scenarios) at: ${savedBaselinePath}`);
  }

  const metrics = scorecard.calculateMetrics();
  const hasRegressions = comparison.regressions?.length > 0;

  if (metrics.failed > 0 || hasRegressions) {
    console.error('\n\x1b[1m\x1b[31mEVALUATION FAILED:\x1b[0m Regressions or failed scenarios detected.');
    process.exit(1);
  } else {
    console.log('\n\x1b[1m\x1b[32mEVALUATION PASSED: All scenarios passed with zero regressions.\x1b[0m');
    process.exit(0);
  }
}

runEvaluation().catch(err => {
  console.error("Evaluation run crashed:", err);
  process.exit(1);
});
