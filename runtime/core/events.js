import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { GENESIS_HASH, eventHash, resolveStateKey } from "./sealing.js";
import { withLock } from "./locks.js";

export class EventLog extends EventEmitter {
  constructor({ sessionId, logDir = null, key = undefined, loadExisting = false } = {}) {
    super();
    this.sessionId = sessionId || `session-${Date.now()}`;
    this.logDir = logDir || path.join(process.cwd(), '.agent', 'sessions', this.sessionId);
    this.logFile = path.join(this.logDir, 'events.jsonl');

    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

    this.key = key !== undefined ? key : resolveStateKey({ allowLegacy: true });
    this.events = loadExisting ? EventLog.readLogFile(this.logFile) : [];

    let seq = 0;
    let lastHash = GENESIS_HASH;
    for (let i = this.events.length - 1; i >= 0; i--) {
      const event = this.events[i];
      if (event && typeof event.event_hash === 'string' && Number.isInteger(event.seq)) {
        seq = event.seq + 1;
        lastHash = event.event_hash;
        break;
      }
    }

    const hasChained = this.events.some(e => e && typeof e.event_hash === 'string');
    if (!hasChained) {
      seq = this.events.length;
      lastHash = GENESIS_HASH;
    }

    this.seq = seq;
    this.lastHash = lastHash;
  }

  append(type, payload = {}) {
    const lockPath = path.join(this.logDir, '.events.lock');
    return withLock(lockPath, () => {
      this._resyncFromDisk();

      const base = {
        event_id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        session_id: this.sessionId,
        event_type: type,
        timestamp: new Date().toISOString(),
        ...payload,
        seq: this.seq,
        prev_hash: this.lastHash
      };

      const event = { ...base, event_hash: eventHash(base, this.lastHash, { key: this.key }) };
      this.seq++;
      this.lastHash = event.event_hash;
      this.events.push(event);

      try {
        fs.appendFileSync(this.logFile, JSON.stringify(event) + '\n', 'utf8');
      } catch (err) {
        console.error(`[EventLog] Failed to persist event: ${err.message}`);
      }

      this.emit(type, event);
      this.emit('*', event);
      return event;
    });
  }

  _resyncFromDisk() {
    if (!fs.existsSync(this.logFile)) return;
    try {
      const content = fs.readFileSync(this.logFile, 'utf8').trimEnd();
      if (!content) return;
      const lastLine = content.slice(content.lastIndexOf('\n') + 1);
      const last = JSON.parse(lastLine);
      if (last && typeof last.event_hash === 'string' && Number.isInteger(last.seq)) {
        if (last.event_hash !== this.lastHash) {
          this.lastHash = last.event_hash;
          this.seq = last.seq + 1;
        }
      }
    } catch {
      // Ignore; next append hashes from the in-memory tail.
    }
  }

  list() {
    return [...this.events];
  }

  filterByType(type) {
    return this.events.filter(e => e.event_type === type);
  }

  static readLogFile(filePath) {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf8');
    const events = [];
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        events.push(JSON.parse(trimmed));
      } catch {
        console.warn(`[EventLog] Skipping malformed event line in ${filePath}`);
      }
    }
    return events;
  }
}
