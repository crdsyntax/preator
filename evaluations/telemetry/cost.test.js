import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSession } from '../../runtime/session.js';
import { BaseProviderAdapter, TURN_TYPES, createModelTurnResponse } from '../../runtime/providers/contracts.js';
import { ProviderDriver } from '../../runtime/providers/driver.js';
import { resolvePricing, estimateCost } from '../../runtime/telemetry/pricing.js';
import { recordOpencodeLlmUsage } from '../../runtime/hosts/opencode-plugin-core.js';
import { EventLog } from '../../runtime/core/events.js';
import { verifyChainSegment } from '../../runtime/core/sealing.js';
import { verifySession } from '../../scripts/audit-session.js';
import { runDoctor } from '../../scripts/doctor.js';

let passed = 0;
let total = 0;

async function test(name, fn) {
  total++;
  try {
    await fn();
    passed++;
    console.log(`  \u2714 [${name}] PASS`);
  } catch (err) {
    console.error(`  \u2718 [${name}] FAIL: ${err.message}`);
    throw err;
  }
}

function makeDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'praetor-tele-'));
}

class CostAdapter extends BaseProviderAdapter {
  constructor({ model, usage }) {
    super('cost-adapter');
    this.model = model;
    this.usage = usage;
  }
  async generateTurn() {
    return createModelTurnResponse({
      turnType: TURN_TYPES.MESSAGE,
      content: 'ok',
      model: this.model,
      usage: this.usage
    });
  }
}

console.log('=== Praetor Token & Cost Telemetry Suite (TELE-01 .. TELE-05) ===\n');

await test('TELE-01: pricing resolves per model with a safe default (AC1)', () => {
  const mini = resolvePricing('openai/gpt-4o-mini');
  assert.strictEqual(mini.input, 0.15);
  assert.strictEqual(mini.output, 0.60);

  const geminiPro = resolvePricing('gemini-1.5-pro-latest');
  assert.strictEqual(geminiPro.input, 1.25);
  assert.strictEqual(geminiPro.output, 5.00);

  const unknown = resolvePricing('some/unlisted-model');
  assert.strictEqual(unknown.input, 1.25);
  assert.strictEqual(unknown.output, 5.00);
  assert.strictEqual(unknown.label, 'default');
});

await test('TELE-02: estimateCost math is exact (AC2)', () => {
  const cost = estimateCost({ model: 'gpt-4o', inputTokens: 1000, outputTokens: 500 });
  assert.strictEqual(cost, 0.0075);
  assert.strictEqual(estimateCost({ model: 'gpt-4o' }), 0);
  assert.strictEqual(Number.isFinite(estimateCost({ model: null, inputTokens: 10 })), true);
});

await test('TELE-03: provider driver accumulates cost and emits llm.completed (AC3)', async () => {
  const dir = makeDir();
  try {
    const session = createSession({
      sessionId: 'tele3',
      initialPhase: 'EXECUTE',
      sessionsRoot: path.join(dir, '.agent', 'sessions')
    });
    const driver = new ProviderDriver({
      adapter: new CostAdapter({ model: 'gpt-4o', usage: { prompt_tokens: 1000, completion_tokens: 500 } }),
      session
    });

    await driver.step();

    assert.strictEqual(driver.totalUsage.cost_usd, 0.0075);
    assert.strictEqual(driver.totalUsage.by_model['gpt-4o'].cost_usd, 0.0075);

    const llmEvents = session.events.list().filter(e => e.event_type === 'llm.completed');
    assert.strictEqual(llmEvents.length, 1, 'exactly one llm.completed event');
    assert.strictEqual(llmEvents[0].cost_usd, 0.0075);
    assert.strictEqual(llmEvents[0].model, 'gpt-4o');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await test('TELE-04: turn response carries an optional model (AC4)', () => {
  assert.strictEqual(createModelTurnResponse({ model: 'gpt-4o' }).model, 'gpt-4o');
  assert.strictEqual(createModelTurnResponse({}).model, null);
});

await test('TELE-05: host helper appends a valid llm.completed event (AC5)', () => {
  const dir = makeDir();
  try {
    const record = recordOpencodeLlmUsage(
      'tele5',
      { model: 'claude-sonnet-4', inputTokens: 1000, outputTokens: 500 },
      { cwd: dir }
    );
    assert.strictEqual(record.cost_usd, 0.0105);

    const eventsFile = path.join(dir, '.agent', 'sessions', 'tele5', 'events.jsonl');
    const events = EventLog.readLogFile(eventsFile);
    const llm = events.filter(e => e.event_type === 'llm.completed');
    assert.strictEqual(llm.length, 1);
    assert.strictEqual(llm[0].cost_usd, 0.0105);

    const chain = verifyChainSegment(events);
    assert.strictEqual(chain.valid, true, `chain must stay valid (${chain.reason})`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await test('TELE-06: audit verify reports accumulated cost (AC6)', async () => {
  const dir = makeDir();
  try {
    fs.writeFileSync(path.join(dir, 'runtime.config.json'), JSON.stringify({ version: '1.0' }));
    const session = createSession({
      sessionId: 'tele6',
      initialPhase: 'EXECUTE',
      sessionsRoot: path.join(dir, '.agent', 'sessions')
    });
    const driver = new ProviderDriver({
      adapter: new CostAdapter({ model: 'gpt-4o', usage: { prompt_tokens: 1000, completion_tokens: 500 } }),
      session
    });
    await driver.step();
    session.state.save();

    const report = verifySession('tele6', { targetDir: dir });
    assert.strictEqual(report.valid, true, JSON.stringify(report));
    assert.strictEqual(report.usage.cost_usd, 0.0075);
    assert.strictEqual(report.usage.by_model['gpt-4o'].cost_usd, 0.0075);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await test('TELE-07: doctor aggregates cost across sessions (AC6)', async () => {
  const dir = makeDir();
  try {
    fs.writeFileSync(path.join(dir, 'runtime.config.json'), JSON.stringify({ version: '1.0' }));
    const session = createSession({
      sessionId: 'tele7',
      initialPhase: 'EXECUTE',
      sessionsRoot: path.join(dir, '.agent', 'sessions')
    });
    const driver = new ProviderDriver({
      adapter: new CostAdapter({ model: 'claude-sonnet-4', usage: { prompt_tokens: 1000, completion_tokens: 500 } }),
      session
    });
    await driver.step();
    session.state.save();

    const report = runDoctor(dir);
    assert.strictEqual(report.cost.total_usd, 0.0105);
    assert.ok(report.cost.by_model.includes('claude-sonnet-4'));
    assert.strictEqual(report.cost.sessions, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`\n============================================================`);
console.log(`Telemetry Results: ${passed} passed, 0 failed (out of ${total})`);
console.log(`============================================================\n`);
