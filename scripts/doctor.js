import fs from 'node:fs';
import path from 'node:path';
import { PolicyEngine } from '../runtime/core/policy.js';
import { SEAL_VERSION, verifySeal, resolveStateKey } from '../runtime/core/sealing.js';
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
    }
  }

  add('sessions', invalid === 0, invalid === 0
    ? `${v1} legacy (v1), ${v2} sealed (v2), 0 invalid${missing ? `, ${missing} without state` : ''}`
    : `${invalid} session(s) with invalid seal (run 'praetor migrate')`);

  const keyOk = Boolean(resolvedKey) || v2 === 0;
  add('seal-key', keyOk, resolvedKey
    ? 'Seal key available'
    : (v2 === 0
      ? 'No seal key; only legacy (v1) sessions present (set PRAETOR_STATE_SECRET to seal at v2)'
      : 'No seal key but v2 sealed sessions exist (cannot verify)'));

  const hooksPath = path.join(targetDir, '.agents', 'hooks.json');
  add('host-hook', true, fs.existsSync(hooksPath)
    ? 'Antigravity host hook declared'
    : 'No host hook declared (optional)');

  const healthy = checks.every(c => c.ok);
  return { target: targetDir, healthy, checks, sessions: { v1, v2, invalid, missing } };
}
