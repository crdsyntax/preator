import fs from 'node:fs';
import path from 'node:path';
import {
  SEAL_VERSION,
  createSeal,
  verifySeal,
  resolveStateKey
} from '../runtime/core/sealing.js';

export function stateFieldsFrom(data = {}) {
  return {
    sessionId: data.session_id,
    currentPhase: data.current_phase,
    iteration: data.iteration,
    status: data.status,
    agentId: data.agent_id,
    pendingApproval: data.pending_approval,
    approvals: data.approvals,
    goal: data.goal,
    context: data.context
  };
}

function quarantineSession(sessionDir, quarantineRoot, sessionId, summary, dryRun) {
  summary.quarantined++;
  summary.quarantinedSessions.push(sessionId);
  if (dryRun) return;
  const destination = path.join(quarantineRoot, sessionId);
  fs.mkdirSync(quarantineRoot, { recursive: true });
  if (fs.existsSync(destination)) {
    fs.rmSync(destination, { recursive: true, force: true });
  }
  fs.renameSync(sessionDir, destination);
}

export function runMigrate(targetDir = process.cwd(), { dryRun = false, key = undefined, keyPath = null } = {}) {
  const sessionsDir = path.join(targetDir, '.agent', 'sessions');
  const quarantineRoot = path.join(targetDir, '.agent', 'quarantine');

  const resolvedKey = key !== undefined
    ? key
    : resolveStateKey({ keyPath: keyPath || path.join(targetDir, '.agent', 'state.key') });

  if (!resolvedKey) {
    const err = new Error(
      'STATE_KEY_REQUIRED: Migration needs a seal key. Set PRAETOR_STATE_SECRET or create .agent/state.key.'
    );
    err.code = 'STATE_KEY_REQUIRED';
    throw err;
  }

  const summary = {
    target: targetDir,
    dryRun,
    scanned: 0,
    resealed: 0,
    alreadySealed: 0,
    quarantined: 0,
    skipped: 0,
    quarantinedSessions: [],
    errors: []
  };

  if (!fs.existsSync(sessionsDir)) {
    return summary;
  }

  for (const entry of fs.readdirSync(sessionsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const sessionId = entry.name;
    const sessionDir = path.join(sessionsDir, sessionId);
    const stateFile = path.join(sessionDir, 'state.json');

    if (!fs.existsSync(stateFile)) {
      summary.skipped++;
      continue;
    }

    summary.scanned++;

    let data;
    try {
      data = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    } catch (err) {
      summary.errors.push({ sessionId, error: err.message });
      quarantineSession(sessionDir, quarantineRoot, sessionId, summary, dryRun);
      continue;
    }

    const fields = stateFieldsFrom(data);
    const declaredVersion = data.seal_version === SEAL_VERSION ? SEAL_VERSION : 1;
    const valid = typeof data.state_hash === 'string'
      && verifySeal({ fields, seal: data, key: resolvedKey, version: declaredVersion });

    if (!valid) {
      quarantineSession(sessionDir, quarantineRoot, sessionId, summary, dryRun);
      continue;
    }

    if (declaredVersion === SEAL_VERSION) {
      summary.alreadySealed++;
      continue;
    }

    const seal = createSeal({ fields, key: resolvedKey, version: SEAL_VERSION });
    if (!dryRun) {
      data.seal_version = seal.seal_version;
      data.seal_algo = seal.seal_algo;
      data.state_hash = seal.state_hash;
      fs.writeFileSync(stateFile, JSON.stringify(data, null, 2), 'utf8');
    }
    summary.resealed++;
  }

  return summary;
}
