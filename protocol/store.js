import fs from 'node:fs';
import path from 'node:path';

export class PersistentTaskStore {
  constructor(rootDir = null) {
    this.memory = new Map();
    const baseDir = rootDir || process.cwd();
    this.rootDir = path.join(baseDir, '.agent', 'tasks');
    this.sessionsDir = path.join(baseDir, '.agent', 'sessions');
  }

  save(record) {
    if (!record || !record.taskId) {
      throw new Error('TaskRecord must have taskId');
    }
    return this.set(record.taskId, record);
  }

  load(taskId) {
    return this.get(taskId);
  }

  ensureDir() {
    if (!fs.existsSync(this.rootDir)) {
      fs.mkdirSync(this.rootDir, { recursive: true });
    }
  }

  set(taskId, record) {
    this.memory.set(taskId, record);
    this.ensureDir();
    const filePath = path.join(this.rootDir, `${taskId}.json`);
    const serializable = {
      taskId: record.taskId,
      sessionId: record.sessionId || record.taskId,
      goal: record.goal || '',
      status: record.status || 'created',
      phase: (record.session ? record.session.getPhase() : record.phase) || 'REQUEST',
      summary: record.summary || null,
      report: record.report || null,
      specialists: record.specialists || null,
      audit_seal: record.audit_seal || (record.session?.state?.state_hash) || null,
      createdAt: record.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(filePath, JSON.stringify(serializable, null, 2), 'utf8');
    return record;
  }

  get(taskId) {
    if (this.memory.has(taskId)) {
      return this.memory.get(taskId);
    }

    const taskFile = path.join(this.rootDir, `${taskId}.json`);
    if (fs.existsSync(taskFile)) {
      try {
        const raw = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
        this.memory.set(taskId, raw);
        return raw;
      } catch {}
    }

    const sessionFile = path.join(this.sessionsDir, taskId, 'state.json');
    if (fs.existsSync(sessionFile)) {
      try {
        const state = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
        const reconstructed = {
          taskId: state.session_id || taskId,
          sessionId: state.session_id || taskId,
          goal: state.goal || '',
          status: state.status || 'completed',
          phase: state.current_phase || 'COMPLETE',
          pendingApproval: state.pending_approval || null,
          audit_seal: state.state_hash || null,
          events_count: 0,
          createdAt: state.updated_at || new Date().toISOString(),
          updatedAt: state.updated_at || new Date().toISOString()
        };
        this.memory.set(taskId, reconstructed);
        return reconstructed;
      } catch {}
    }

    return null;
  }

  has(taskId) {
    if (this.memory.has(taskId)) return true;
    if (fs.existsSync(path.join(this.rootDir, `${taskId}.json`))) return true;
    if (fs.existsSync(path.join(this.sessionsDir, taskId, 'state.json'))) return true;
    return false;
  }

  delete(taskId) {
    this.memory.delete(taskId);
    const taskFile = path.join(this.rootDir, `${taskId}.json`);
    if (fs.existsSync(taskFile)) {
      try {
        fs.unlinkSync(taskFile);
      } catch {}
    }
    return true;
  }
}

export const defaultTaskStore = new PersistentTaskStore();
