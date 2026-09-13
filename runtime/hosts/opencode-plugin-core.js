import fs from 'node:fs';
import path from 'node:path';
import { createSession } from '../session.js';
import { SessionState } from '../core/state.js';
import { AgentCatalog } from '../core/agents.js';
import { EventLog } from '../core/events.js';
import { resolveStateKey } from '../core/sealing.js';
import { createUsageRecord } from '../telemetry/pricing.js';
import { HostDriver } from './driver.js';
import { createHostToolInvocation } from './contracts.js';

export function evaluateOpencodeTool(toolName, args = {}, { cwd = process.cwd(), sessionId = '', agentId = 'orchestrator' } = {}) {
  if (!toolName || typeof toolName !== 'string') {
    return { decision: 'deny', code: 'INVALID_HOST_INVOCATION', reason: 'Missing tool name', canonical_tool: null, canonical_hash: null };
  }

  const sessionsRoot = path.join(cwd, '.agent', 'sessions');
  let session;

  const statePath = sessionId ? path.join(sessionsRoot, sessionId, 'state.json') : null;
  if (statePath && fs.existsSync(statePath)) {
    const loaded = SessionState.load(sessionId, sessionsRoot);
    let agentDef = null;
    const agentsDir = path.join(cwd, 'agents');
    if (fs.existsSync(agentsDir)) {
      try {
        const catalog = new AgentCatalog();
        catalog.loadFromDir(agentsDir);
        agentDef = catalog.get(loaded.agentId);
      } catch {}
    }
    session = createSession({
      sessionId,
      agentId: loaded.agentId || agentId,
      initialPhase: loaded.currentPhase || 'REQUEST',
      agentDefinition: agentDef,
      sessionsRoot,
      workspaceRoot: cwd,
      hydrate: true,
      emitStartEvent: false
    });
  } else {
    session = createSession({
      sessionId: sessionId || `opencode-${Date.now()}`,
      agentId,
      sessionsRoot,
      workspaceRoot: cwd
    });
  }

  const invocation = createHostToolInvocation({
    host: 'opencode',
    toolName,
    args: args && typeof args === 'object' ? args : {},
    agentId: session.agentId,
    conversationId: sessionId
  });

  const decision = new HostDriver().evaluateInvocation(invocation, session);
  return {
    decision: decision.decision,
    reason: decision.reason,
    code: decision.code,
    canonical_tool: decision.canonical_tool,
    canonical_hash: decision.canonical_hash
  };
}

export function recordOpencodeLlmUsage(sessionId, usage = {}, { cwd = process.cwd(), costUsd = null } = {}) {
  const record = createUsageRecord({
    model: usage.model || null,
    inputTokens: usage.inputTokens || 0,
    outputTokens: usage.outputTokens || 0,
    reasoningTokens: usage.reasoningTokens || 0,
    cacheReadTokens: usage.cacheReadTokens || 0,
    cacheWriteTokens: usage.cacheWriteTokens || 0,
    costUsd
  });

  const safeSessionId = sessionId || 'unsorted';
  const logDir = path.join(cwd, '.agent', 'sessions', safeSessionId);

  try {
    const events = new EventLog({
      sessionId: safeSessionId,
      logDir,
      key: resolveStateKey({ allowLegacy: true }),
      loadExisting: true
    });
    events.append('llm.completed', {
      model: record.model,
      input_tokens: record.input_tokens,
      output_tokens: record.output_tokens,
      reasoning_tokens: record.reasoning_tokens,
      cache_read_tokens: record.cache_read_tokens,
      cache_write_tokens: record.cache_write_tokens,
      total_tokens: record.total_tokens,
      cost_usd: record.cost_usd,
      pricing_label: record.pricing_label
    });
  } catch {
    // Telemetry must never break the host runtime.
  }

  return record;
}
