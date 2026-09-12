import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const SEAL_VERSION = 2;

export const SEAL_ALGOS = Object.freeze({
  V1: 'sha256',
  V2: 'hmac-sha256'
});

export const GENESIS_HASH = '0'.repeat(64);

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  const entries = keys.map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`);
  return `{${entries.join(',')}}`;
}

export function resolveStateKey({ key = null, keyPath = null, required = false, allowLegacy = false } = {}) {
  if (key) return key;

  const envKey = process.env.PRAETOR_STATE_SECRET;
  if (envKey && envKey.trim()) return envKey.trim();

  const resolvedKeyPath = keyPath || path.join(process.cwd(), '.agent', 'state.key');
  if (fs.existsSync(resolvedKeyPath)) {
    const fileKey = fs.readFileSync(resolvedKeyPath, 'utf8').trim();
    if (fileKey) return fileKey;
  }

  if (allowLegacy || !required) return null;

  const err = new Error(
    `STATE_KEY_REQUIRED: No seal key found. Set PRAETOR_STATE_SECRET or provide ${resolvedKeyPath}.`
  );
  err.code = 'STATE_KEY_REQUIRED';
  throw err;
}

export function ensureStateKeyFile(keyPath = path.join(process.cwd(), '.agent', 'state.key')) {
  if (fs.existsSync(keyPath)) {
    const existing = fs.readFileSync(keyPath, 'utf8').trim();
    if (existing) return existing;
  }
  const generated = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  fs.writeFileSync(keyPath, generated, { encoding: 'utf8', mode: 0o600 });
  try {
    fs.chmodSync(keyPath, 0o600);
  } catch {}
  return generated;
}

export function hashPayload(payload, { key = null, algo = null } = {}) {
  const effectiveAlgo = algo || (key ? SEAL_ALGOS.V2 : SEAL_ALGOS.V1);
  if (effectiveAlgo === SEAL_ALGOS.V2) {
    if (!key) {
      const err = new Error('SEAL_KEY_REQUIRED: hmac-sha256 sealing requires a key');
      err.code = 'SEAL_KEY_REQUIRED';
      throw err;
    }
    return crypto.createHmac('sha256', key).update(payload).digest('hex');
  }
  return crypto.createHash('sha256').update(payload).digest('hex');
}

export function legacyStateHash({ sessionId, currentPhase, iteration, status, agentId, pendingApproval = null }) {
  const base = `${sessionId}:${currentPhase}:${iteration}:${status}:${agentId}`;
  const payload = pendingApproval ? `${base}:${pendingApproval}` : base;
  return crypto.createHash('sha256').update(payload).digest('hex');
}

export function createSeal({ fields, key = null, version = SEAL_VERSION } = {}) {
  if (version === 1 || !key) {
    return {
      seal_version: 1,
      seal_algo: SEAL_ALGOS.V1,
      state_hash: legacyStateHash(fields)
    };
  }
  return {
    seal_version: SEAL_VERSION,
    seal_algo: SEAL_ALGOS.V2,
    state_hash: hashPayload(stableStringify(fields), { key, algo: SEAL_ALGOS.V2 })
  };
}

export function verifySeal({ fields, seal = {}, key = null, version = null } = {}) {
  const declaredVersion = version ?? seal.seal_version ?? 1;
  const declaredHash = seal.state_hash;
  if (typeof declaredHash !== 'string' || !/^[0-9a-f]{64}$/i.test(declaredHash)) {
    return false;
  }

  if (declaredVersion === 1) {
    const expected = legacyStateHash(fields);
    return expected === declaredHash;
  }

  if (!key) return false;
  const expected = hashPayload(stableStringify(fields), { key, algo: SEAL_ALGOS.V2 });
  return expected === declaredHash;
}

export function eventHash(event, prevHash = GENESIS_HASH, { key = null } = {}) {
  const { event_hash, ...rest } = event || {};
  const payload = `${prevHash}:${stableStringify(rest)}`;
  return hashPayload(payload, { key });
}

export function verifyEventChain(events = [], { key = null, chainSeed = GENESIS_HASH } = {}) {
  let prevHash = chainSeed;
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (!event || typeof event !== 'object') {
      return { valid: false, brokenAt: i, reason: 'EVENT_NOT_OBJECT' };
    }
    if (event.seq !== i) {
      return { valid: false, brokenAt: i, reason: 'EVENT_SEQ_MISMATCH' };
    }
    if (event.prev_hash !== prevHash) {
      return { valid: false, brokenAt: i, reason: 'EVENT_PREV_HASH_MISMATCH' };
    }
    const expected = eventHash(event, prevHash, { key });
    if (event.event_hash !== expected) {
      return { valid: false, brokenAt: i, reason: 'EVENT_HASH_MISMATCH' };
    }
    prevHash = event.event_hash;
  }
  return { valid: true, brokenAt: -1, terminalHash: prevHash };
}

export function verifyChainSegment(events = [], { key = null } = {}) {
  const firstIndex = events.findIndex(
    e => e && typeof e === 'object' && typeof e.event_hash === 'string' && Number.isInteger(e.seq)
  );
  if (firstIndex === -1) {
    return { valid: true, chained: 0, brokenAt: -1, reason: null };
  }

  let prevHash = events[firstIndex].prev_hash;
  const baseSeq = events[firstIndex].seq;

  for (let i = firstIndex; i < events.length; i++) {
    const event = events[i];
    if (!event || typeof event !== 'object' || typeof event.event_hash !== 'string') {
      return { valid: false, chained: i - firstIndex, brokenAt: i, reason: 'EVENT_CHAIN_MISSING_HASH' };
    }
    if (event.seq !== baseSeq + (i - firstIndex)) {
      return { valid: false, chained: i - firstIndex, brokenAt: i, reason: 'EVENT_SEQ_MISMATCH' };
    }
    if (event.prev_hash !== prevHash) {
      return { valid: false, chained: i - firstIndex, brokenAt: i, reason: 'EVENT_PREV_HASH_MISMATCH' };
    }
    if (eventHash(event, prevHash, { key }) !== event.event_hash) {
      return { valid: false, chained: i - firstIndex, brokenAt: i, reason: 'EVENT_HASH_MISMATCH' };
    }
    prevHash = event.event_hash;
  }

  return { valid: true, chained: events.length - firstIndex, brokenAt: -1, reason: null, terminalHash: prevHash };
}
