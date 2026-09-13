import fs from 'node:fs';
import path from 'node:path';
import { PolicyEngine } from '../runtime/core/policy.js';
import { SEAL_VERSION, verifySeal, resolveStateKey } from '../runtime/core/sealing.js';
import { EventLog } from '../runtime/core/events.js';
import { stateFieldsFrom } from './migrate-runtime.js';

export function runDoctor(targetDir = process.cwd(), { key = undefined, keyPath = null } = {}) {
  const checks = [];
  const add = (id, ok, message) => checks.push({ id, ok, message });

  const configPath = path.join(targetDir, 'runtime.config.json');
  try {
    const policy = new PolicyEngine({ rootDir: targetDir, configPath });
    add('config', policy.configValidation.valid, policy.configValidation.valid
      ? 'runtime.config.json is valid'
      : String(policy.configValidation.error));
  } catch (err) {
    add('config', false, err.message);
  }

  const resolvedKey = key !== undefined
    ? key
    : resolveStateKey({ keyPath: keyPath || path.join(targetDir, '.agent', 'state.key'), allowLegacy: true });

  const sessionsDir = path.join(targetDir, '.agent', 'sessions');
  let v1 = 0;
  let v2 = 0;
  let invalid = 0;
  let missing = 0;
  let totalCostUsd = 0;
  let totalTokens = 0;
  let costSessions = 0;
  const costModels = new Set();

  if (fs.existsSync(sessionsDir)) {
    for (const entry of fs.readdirSync(sessionsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const stateFile = path.join(sessionsDir, entry.name, 'state.json');
      if (!fs.existsSync(stateFile)) {
        missing++;
        continue;
      }
      try {
        const data = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        const version = data.seal_version === SEAL_VERSION ? SEAL_VERSION : 1;
        const fields = stateFieldsFrom(data);
        const valid = typeof data.state_hash === 'string'
          && verifySeal({ fields, seal: data, key: resolvedKey, version });
        if (!valid) {
          invalid++;
        } else if (version === SEAL_VERSION) {
          v2++;
        } else {
          v1++;
        }
      } catch {
        invalid++;
      }

      const eventsFile = path.join(sessionsDir, entry.name, 'events.jsonl');
      if (fs.existsSync(eventsFile)) {
        let sessionCost = 0;
        for (const event of EventLog.readLogFile(eventsFile)) {
          if (event && event.event_type === 'llm.completed') {
            sessionCost += Number(event.cost_usd) || 0;
            totalTokens += Number(event.total_tokens) || 0;
            costModels.add(event.model || 'unknown');
          }
        }
        if (sessionCost > 0) {
          costSessions++;
          totalCostUsd += sessionCost;
        }
      }
    }
  }

  add('sessions', invalid === 0, invalid === 0
    ? `${v1} legacy (v1), ${v2} sealed (v2), 0 invalid${missing ? `, ${missing} without state` : ''}`
    : `${invalid} session(s) with invalid seal (run 'praetor migrate')`);

  totalCostUsd = Number(totalCostUsd.toFixed(6));
  add('cost', true, totalCostUsd > 0
    ? `$${totalCostUsd} across ${costSessions} session(s); models: ${[...costModels].join(', ')}`
    : 'No llm.completed usage recorded yet');

  const keyOk = Boolean(resolvedKey) || v2 === 0;
  add('seal-key', keyOk, resolvedKey
    ? 'Seal key available'
    : (v2 === 0
      ? 'No seal key; only legacy (v1) sessions present (set PRAETOR_STATE_SECRET to seal at v2)'
      : 'No seal key but v2 sealed sessions exist (cannot verify)'));

  const hostIssues = [];
  const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));

  const agHooks = path.join(targetDir, '.agents', 'hooks.json');
  const agMcp = path.join(targetDir, '.agents', 'mcp_config.json');
  const agHookScript = path.join(targetDir, '.agents', 'praetor-hook.js');
  const agPresent = fs.existsSync(agHooks) || fs.existsSync(agMcp) || fs.existsSync(agHookScript);
  if (agPresent) {
    try {
      if (!fs.existsSync(agHooks)) {
        hostIssues.push('antigravity: missing .agents/hooks.json');
      } else {
        const hooks = readJson(agHooks);
        const hasHandler = Object.values(hooks).some(entry =>
          entry && typeof entry === 'object' && Array.isArray(entry.PreToolUse) &&
          entry.PreToolUse.some(e => e && Array.isArray(e.hooks) &&
            e.hooks.some(h => typeof h.command === 'string' && h.command.includes('praetor')))
        );
        if (!hasHandler) hostIssues.push('antigravity: hooks.json has no Praetor PreToolUse handler');
      }
      if (!fs.existsSync(agHookScript)) hostIssues.push('antigravity: missing .agents/praetor-hook.js');
      if (!fs.existsSync(agMcp)) hostIssues.push('antigravity: missing .agents/mcp_config.json');
      else if (!readJson(agMcp).mcpServers?.praetor) hostIssues.push('antigravity: mcp_config.json missing praetor server');
    } catch (err) {
      hostIssues.push(`antigravity: ${err.message}`);
    }
  }

  const ocRoot = path.join(targetDir, 'opencode.json');
  const ocDot = path.join(targetDir, '.opencode', 'opencode.json');
  const ocActive = fs.existsSync(ocRoot) ? ocRoot : (fs.existsSync(ocDot) ? ocDot : null);
  const ocPlugin = path.join(targetDir, '.opencode', 'plugin', 'praetor.js');
  const ocPresent = Boolean(ocActive) || fs.existsSync(ocPlugin);
  if (ocPresent) {
    try {
      if (!ocActive) hostIssues.push('opencode: missing opencode.json');
      else if (!readJson(ocActive).mcp?.praetor) hostIssues.push('opencode: opencode.json missing mcp.praetor');
      if (!fs.existsSync(ocPlugin)) hostIssues.push('opencode: missing .opencode/plugin/praetor.js');
    } catch (err) {
      hostIssues.push(`opencode: ${err.message}`);
    }
  }

  const hostsDetected = [agPresent ? 'antigravity' : null, ocPresent ? 'opencode' : null].filter(Boolean);
  add('hosts', hostIssues.length === 0, hostIssues.length === 0
    ? (hostsDetected.length ? `Host integration valid: ${hostsDetected.join(', ')}` : 'No host integration detected (optional)')
    : hostIssues.join('; '));

  const healthy = checks.every(c => c.ok);
  return {
    target: targetDir,
    healthy,
    checks,
    sessions: { v1, v2, invalid, missing },
    cost: { total_usd: totalCostUsd, total_tokens: totalTokens, by_model: [...costModels], sessions: costSessions },
    hosts: hostsDetected,
    hostIssues
  };
}
