import fs from 'node:fs';
import path from 'node:path';

export const LOCK_TIMEOUT = 'LOCK_TIMEOUT';

function sleepSync(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // busy-wait intentionally: synchronous lock acquisition
  }
}

export function acquireLock(lockPath, { timeoutMs = 5000, retryMs = 25, staleMs = 30000 } = {}) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const start = Date.now();

  for (;;) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeSync(fd, `${process.pid}:${Date.now()}`);
      fs.closeSync(fd);
      return lockPath;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;

      try {
        const stat = fs.statSync(lockPath);
        if (Date.now() - stat.mtimeMs > staleMs) {
          try { fs.unlinkSync(lockPath); } catch {}
          continue;
        }
      } catch {
        continue;
      }

      if (Date.now() - start >= timeoutMs) {
        const timeoutError = new Error(`Failed to acquire lock '${lockPath}' within ${timeoutMs}ms`);
        timeoutError.code = LOCK_TIMEOUT;
        throw timeoutError;
      }
      sleepSync(retryMs);
    }
  }
}

export function releaseLock(lockPath) {
  try {
    fs.unlinkSync(lockPath);
  } catch {
    // Already released or removed; nothing to do.
  }
}

export function withLock(lockPath, fn, options = {}) {
  acquireLock(lockPath, options);
  try {
    return fn();
  } finally {
    releaseLock(lockPath);
  }
}
