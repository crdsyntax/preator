import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";

export class EventLog extends EventEmitter {
  constructor({ sessionId, logDir = null } = {}) {
    super();
    this.sessionId = sessionId || `session-${Date.now()}`;
    this.events = [];
    this.logDir = logDir || path.join(process.cwd(), '.agent', 'sessions', this.sessionId);
    this.logFile = path.join(this.logDir, 'events.jsonl');

    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  append(type, payload = {}) {
    const event = {
      event_id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      session_id: this.sessionId,
      event_type: type,
      timestamp: new Date().toISOString(),
      ...payload
    };

    this.events.push(event);

    try {
      fs.appendFileSync(this.logFile, JSON.stringify(event) + '\n', 'utf8');
    } catch (err) {
      console.error(`[EventLog] Failed to persist event: ${err.message}`);
    }

    this.emit(type, event);
    this.emit('*', event);
    return event;
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
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => JSON.parse(line));
  }
}
