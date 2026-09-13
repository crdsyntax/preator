import fs from 'node:fs';
import path from 'node:path';
import { SEAL_VERSION, verifySeal, verifyChainSegment, resolveStateKey } from '../runtime/core/sealing.js';
import { validateTraceSequence } from '../runtime/core/lifecycle.js';
import { EventLog } from '../runtime/core/events.js';
import { stateFieldsFrom } from './migrate-runtime.js';

export function aggregateUsage(events = []) {
  let totalTokens = 0;
  let costUsd = 0;
  const byModel = {};

  for (const event of events) {
    if (!event || event.event_type !== 'llm.completed') continue;
    const model = event.model || 'unknown';
    const tokens = Number(event.total_tokens) || 0;
    const cost = Number(event.cost_usd) || 0;

    totalTokens += tokens;
    costUsd += cost;

    const agg = byModel[model] || { total_tokens: 0, cost_usd: 0 };
    agg.total_tokens += tokens;
    agg.cost_usd = Number((agg.cost_usd + cost).toFixed(6));
    byModel[model] = agg;
  }

  return { total_tokens: totalTokens, cost_usd: Number(costUsd.toFixed(6)), by_model: byModel };
}

export function verifySession(sessionId, { targetDir = process.cwd(), key = undefined, keyPath = null } = {}) {
  if (!sessionId || typeof sessionId !== 'string') {
    const err = new Error('verifySession requires a sessionId');
    err.code = 'INVALID_ARGUMENT';
    throw err;
  }

  const sessionsRoot = path.join(targetDir, '.agent', 'sessions');
  const sessionDir = path.join(sessionsRoot, sessionId);
  const stateFile = path.join(sessionDir, 'state.json');
  const eventsFile = path.join(sessionDir, 'events.jsonl');

  const resolvedKey = key !== undefined
    ? key
    : resolveStateKey({ keyPath: keyPath || path.join(targetDir, '.agent', 'state.key'), allowLegacy: true });

  if (!fs.existsSync(stateFile)) {
    return { sessionId, found: false, valid: false, reason: 'SESSION_NOT_FOUND' };
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch (err) {
    return { sessionId, found: true, valid: false, reason: `STATE_CORRUPT: ${err.message}` };
  }

  const declaredVersion = data.seal_version === SEAL_VERSION ? SEAL_VERSION : 1;
  const fields = stateFieldsFrom(data);
  const sealValid = typeof data.state_hash === 'string'
    && !(declaredVersion === SEAL_VERSION && !resolvedKey)
    && verifySeal({ fields, seal: data, key: resolvedKey, version: declaredVersion });

  const events = EventLog.readLogFile(eventsFile);
  const chain = verifyChainSegment(events, { key: resolvedKey });
  const trace = validateTraceSequence(events);
  const traceMatches = events.length === 0 || trace.terminalPhase === data.current_phase;

  const valid = sealValid && chain.valid && trace.valid && traceMatches;

  return {
    sessionId,
    found: true,
    valid,
    seal: { version: declaredVersion, valid: sealValid, key_available: Boolean(resolvedKey) },
    chain: { valid: chain.valid, chained: chain.chained, broken_at: chain.brokenAt, reason: chain.reason || null },
    trace: {
      valid: trace.valid,
      reason: trace.reason || null,
      terminal_phase: trace.terminalPhase,
      state_phase: data.current_phase,
      matches: traceMatches
    },
    phase: data.current_phase,
    status: data.status,
    events: events.length,
    usage: aggregateUsage(events)
  };
}
