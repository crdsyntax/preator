import fs from 'node:fs';
import path from 'node:path';

function normalizeEntry(entry) {
  return String(entry).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
}

export function isWithinRoot(rootDir, targetPath) {
  const root = path.resolve(rootDir);
  const resolved = path.resolve(targetPath);
  return resolved === root || resolved.startsWith(root + path.sep);
}

export function resolveWithinRoot(rootDir, candidate, { followSymlinks = false, symlinkAllowlist = [] } = {}) {
  const root = path.resolve(rootDir);
  const resolved = path.resolve(root, String(candidate));

  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return {
      allowed: false,
      resolved,
      reason: 'PATH_TRAVERSAL_DENIED',
      message: 'Target path escapes workspace root boundary'
    };
  }

  if (followSymlinks) {
    return { allowed: true, resolved, reason: 'OK', message: 'Allowed (symlinks followed)' };
  }

  let realResolved;
  try {
    realResolved = fs.realpathSync(resolved);
  } catch {
    return { allowed: true, resolved, reason: 'OK', message: 'Allowed (path does not exist yet)' };
  }

  if (isWithinRoot(root, realResolved)) {
    return { allowed: true, resolved: realResolved, reason: 'OK', message: 'Allowed' };
  }

  const relative = path.relative(root, resolved).replace(/\\/g, '/');
  const allowlist = (symlinkAllowlist || []).map(normalizeEntry);
  const isSanctioned = allowlist.some(entry => relative === entry || relative.startsWith(entry + '/'));
  if (isSanctioned) {
    return { allowed: true, resolved: realResolved, reason: 'OK', message: 'Allowed (sanctioned symlink)' };
  }

  return {
    allowed: false,
    resolved: realResolved,
    reason: 'PATH_TRAVERSAL_DENIED',
    message: 'Target path escapes workspace root boundary via symbolic link'
  };
}
