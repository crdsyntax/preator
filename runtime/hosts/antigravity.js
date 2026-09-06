import fs from "node:fs";
import path from "node:path";
import { BaseHostAdapter, createHostToolInvocation, HOST_DECISIONS } from './contracts.js';
import { HostDriver } from './driver.js';
import { createSession } from '../index.js';
import { SessionState } from '../core/state.js';
import { loadAgentFromMarkdown, AgentCatalog } from '../core/agents.js';

export class AntigravityHostAdapter extends BaseHostAdapter {
  constructor({ driver = null } = {}) {
    super('antigravity');
    this.driver = driver || new HostDriver();
  }

  interceptToolCall(hostInvocation, session) {
    return this.driver.evaluateInvocation(hostInvocation, session);
  }

  static parseHookInput(rawStdin) {
    try {
      const parsed = JSON.parse(rawStdin);
      const toolName = parsed.tool_name || parsed.tool || parsed.name || parsed.toolCall?.name;
      const args = parsed.tool_input || parsed.args || parsed.arguments || parsed.toolCall?.args || {};
      const agentId = parsed.agent_id || 'orchestrator';
      const stepIdx = parsed.step_index || parsed.stepIdx || 0;
      const conversationId = parsed.conversation_id || parsed.conversationId || '';

      return createHostToolInvocation({
        host: 'antigravity',
        toolName,
        args,
        agentId,
        stepIdx,
        conversationId,
        metadata: parsed
      });
    } catch (err) {
      throw new Error(`Failed to parse Antigravity hook stdin JSON: ${err.message}`);
    }
  }

  static formatHookOutput(hostDecision) {
    return JSON.stringify({
      decision: hostDecision.decision,
      reason: hostDecision.reason,
      ...(hostDecision.code ? { code: hostDecision.code } : {}),
      ...(hostDecision.canonical_hash ? { canonical_hash: hostDecision.canonical_hash } : {})
    });
  }

  static evaluatePayload(payload, { cwd = process.cwd(), sessionFactory = null } = {}) {
    const convId = payload.conversationId || payload.conversation_id;
    let session = null;

    const sessionsRoot = path.join(cwd, '.agent', 'sessions');
    const statePath = convId ? path.join(sessionsRoot, convId, 'state.json') : null;
    if (statePath && fs.existsSync(statePath)) {
      const loadedState = SessionState.load(convId, sessionsRoot);

      let agentDef = null;
      const agentsDir = path.join(cwd, 'agents');
      if (fs.existsSync(agentsDir)) {
        try {
          const catalog = new AgentCatalog();
          catalog.loadFromDir(agentsDir);
          agentDef = catalog.get(loadedState.agentId) || (loadedState.agentId === 'backend-engineer' ? catalog.get('backend-engineer') : null);
        } catch {}
      }
      if (!agentDef) {
        const fallbackPath = path.join(cwd, 'agents', 'backend', 'engineer.md');
        if (fs.existsSync(fallbackPath)) {
          try { agentDef = loadAgentFromMarkdown(fallbackPath); } catch {}
        }
      }

      session = createSession({
        sessionId: convId,
        agentId: loadedState.agentId || 'backend-engineer',
        initialPhase: loadedState.currentPhase || 'REQUEST',
        agentDefinition: agentDef,
        sessionsRoot
      });
      session.state.pendingApproval = loadedState.pendingApproval;
      session.state.tampered = loadedState.tampered;
    } else if (typeof sessionFactory === 'function') {
      session = sessionFactory(payload);
    } else {
      session = createSession({
        sessionId: convId || `hook-${Date.now()}`,
        agentId: payload.agent_id || 'orchestrator',
        sessionsRoot
      });
    }

    const adapter = new AntigravityHostAdapter();
    const decision = adapter.interceptToolCall(payload, session);
    return adapter.formatResponse(decision);
  }

  static async runCli(sessionFactory = null) {
    let inputData = '';
    try {
      for await (const chunk of process.stdin) {
        inputData += chunk;
      }
    } catch (err) {
      process.stdout.write(JSON.stringify({
        decision: 'deny',
        code: 'HOOK_FAIL_CLOSED',
        reason: `Host Governance Hook Stdin Error: ${err.message}`
      }) + '\n');
      return;
    }

    try {
      if (!inputData.trim()) {
        process.stdout.write(JSON.stringify({
          decision: 'deny',
          code: 'HOOK_FAIL_CLOSED',
          reason: 'Host Governance Hook Error: Empty stdin received'
        }) + '\n');
        return;
      }

      const payload = JSON.parse(inputData);
      const formatted = AntigravityHostAdapter.evaluatePayload(payload, { sessionFactory });
      process.stdout.write(JSON.stringify(formatted) + '\n');
    } catch (err) {
      process.stdout.write(JSON.stringify({
        decision: 'deny',
        code: 'HOOK_FAIL_CLOSED',
        reason: `Host Governance Interceptor Error: ${err.message}`
      }) + '\n');
    }
  }
}

if (import.meta.main || (process.argv[1] && process.argv[1].endsWith('antigravity.js'))) {
  AntigravityHostAdapter.runCli().catch(err => {
    process.stdout.write(JSON.stringify({
      decision: 'deny',
      code: 'HOOK_FAIL_CLOSED',
      reason: `Fatal Antigravity hook error: ${err.message}`
    }) + '\n');
    process.exit(0);
  });
}
