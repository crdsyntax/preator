import path from "node:path";
import fs from "node:fs";
import { ALLOWED_WRITE_PHASES, WRITE_TOOLS } from './lifecycle.js';

export const HARD_SECURITY_POLICIES = Object.freeze({
  P1_FORCE_PUSH_DENIED: 'P1_FORCE_PUSH_DENIED',
  P1_DESTRUCTIVE_COMMAND_DENIED: 'P1_DESTRUCTIVE_COMMAND_DENIED',
  P1_PUSH_APPROVAL_REQUIRED: 'P1_PUSH_APPROVAL_REQUIRED',
  P2_PATH_TRAVERSAL_DENIED: 'P2_PATH_TRAVERSAL_DENIED',
  P3_CREDENTIAL_ACCESS_DENIED: 'P3_CREDENTIAL_ACCESS_DENIED',
  P5_ZOMBIE_PREVENTION: 'P5_ZOMBIE_PREVENTION',
  P6_LIFECYCLE_WRITE_VIOLATION: 'P6_LIFECYCLE_WRITE_VIOLATION'
});

export const HARD_DENIED_PATTERNS = Object.freeze([
  /\.env(\..+)?$/i,
  /id_rsa/i,
  /\.pem$/i,
  /signing\.key$/i,
  /signing_pass\.txt$/i,
  /credential/i,
  /secret/i
]);

export function deobfuscateCommand(rawCmd) {
  if (!rawCmd || typeof rawCmd !== 'string') return '';
  let cmd = rawCmd;

  cmd = cmd.replace(/`([a-zA-Z0-9_\-\.\$])/g, '$1');

  const encMatch = cmd.match(/(?:-EncodedCommand|-enc|-e)\s+([A-Za-z0-9+/=]{8,})/i);
  if (encMatch && encMatch[1]) {
    try {
      const b64 = encMatch[1];
      const buf = Buffer.from(b64, 'base64');
      const decodedUtf16 = buf.toString('utf16le');
      const decodedUtf8 = buf.toString('utf8');
      cmd = `${cmd} [DECODED: ${decodedUtf16} / ${decodedUtf8}]`;
    } catch {}
  }

  return cmd;
}

export class PolicyEngine {
  constructor({
    projectConfig = null,
    configPath = null,
    rootDir = process.cwd(),
    strictConfig = true
  } = {}) {
    this.rootDir = path.resolve(rootDir);
    this.strictConfig = strictConfig;
    this.configPath = configPath || path.join(this.rootDir, 'runtime.config.json');
    this.configValidation = this._loadAndValidateConfig(projectConfig);
    this.config = this.configValidation.valid ? this.configValidation.config : null;
  }

  _loadAndValidateConfig(providedConfig) {
    if (providedConfig !== null && providedConfig !== undefined) {
      return this._validateConfigStructure(providedConfig);
    }

    if (fs.existsSync(this.configPath)) {
      try {
        let raw = fs.readFileSync(this.configPath, 'utf8');
      if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
        const parsed = JSON.parse(raw);
        return this._validateConfigStructure(parsed);
      } catch (err) {
        return { valid: false, error: `Corrupted or unparseable runtime.config.json: ${err.message}`, config: null };
      }
    }

    return { valid: false, error: `Missing runtime.config.json at ${this.configPath}`, config: null };
  }

  _validateConfigStructure(cfg) {
    if (!cfg || typeof cfg !== 'object') {
      return { valid: false, error: 'Config must be a non-null JSON object', config: null };
    }
    if (cfg.version !== '1.0') {
      return { valid: false, error: `Unsupported config version '${cfg.version}'. Expected '1.0'`, config: null };
    }
    if (cfg.policy !== undefined && (typeof cfg.policy !== 'object' || cfg.policy === null || Array.isArray(cfg.policy))) {
      return { valid: false, error: "'policy' section in config must be a non-array object", config: null };
    }
    if (cfg.workspace !== undefined && (typeof cfg.workspace !== 'object' || cfg.workspace === null || Array.isArray(cfg.workspace))) {
      return { valid: false, error: "'workspace' section in config must be a non-array object", config: null };
    }

    return { valid: true, error: null, config: cfg };
  }

  canExecute(request, state = {}) {
    const phase = state.current_phase || 'REQUEST';
    const toolName = request.tool || request.tool_name;
    const args = request.args || request.arguments || {};

    if (state.status === 'completed' || state.status === 'failed') {
      return {
        allowed: false,
        reason: `Run is ${state.status}; no further tool execution permitted (Hard Policy P5).`,
        policy: HARD_SECURITY_POLICIES.P5_ZOMBIE_PREVENTION
      };
    }

    if (toolName === 'bash' || toolName === 'run_command') {
      const rawCmd = String(args.cmd || args.CommandLine || args.command || '');
      const cmd = deobfuscateCommand(rawCmd);

      if (!ALLOWED_WRITE_PHASES.has(phase)) {
        const isInlineWrite = /(?:Set-Content|Out-File|Add-Content|New-Item|\[(?:System\.)?IO\.File\]::WriteAllText|\btee\b|>|>>)/i.test(cmd);
        if (isInlineWrite) {
          return {
            allowed: false,
            reason: `Inline shell file write detected in command during non-write phase '${phase}' (Hard Policy P6).`,
            policy: HARD_SECURITY_POLICIES.P6_LIFECYCLE_WRITE_VIOLATION
          };
        }
      }

      if (/git\s+push.*(--force|-f\b)/i.test(cmd)) {
        return {
          allowed: false,
          reason: 'git push --force is strictly forbidden by immutable security policy (Hard Policy P1).',
          policy: HARD_SECURITY_POLICIES.P1_FORCE_PUSH_DENIED
        };
      }

      if (/(rm\s+-rf\s+[\/\*]|mkfs|dd\s+if=.*of=\/dev|format\s+[c-z]:)/i.test(cmd)) {
        return {
          allowed: false,
          reason: 'Destructive root or wildcard command is strictly forbidden (Hard Policy P1).',
          policy: HARD_SECURITY_POLICIES.P1_DESTRUCTIVE_COMMAND_DENIED
        };
      }

      if (/git\s+push/i.test(cmd) && !args.hasApproval && !request.hasApproval) {
        return {
          allowed: false,
          reason: 'git push requires explicit prior human approval (Hard Policy P1).',
          policy: HARD_SECURITY_POLICIES.P1_PUSH_APPROVAL_REQUIRED
        };
      }

      for (const pattern of HARD_DENIED_PATTERNS) {
        if (pattern.test(cmd)) {
          return {
            allowed: false,
            reason: `Command references sensitive protected pattern '${pattern}' (Hard Policy P3).`,
            policy: HARD_SECURITY_POLICIES.P3_CREDENTIAL_ACCESS_DENIED
          };
        }
      }
    }

    const filePath = args.path || args.TargetPath || args.TargetFile || args.AbsolutePath || args.SearchPath || null;
    if (filePath && typeof filePath === 'string') {
      const resolved = path.resolve(this.rootDir, filePath);

      if (!resolved.startsWith(this.rootDir)) {
        return {
          allowed: false,
          reason: `Path '${filePath}' escapes workspace root boundary (Hard Policy P2).`,
          policy: HARD_SECURITY_POLICIES.P2_PATH_TRAVERSAL_DENIED
        };
      }

      const baseName = path.basename(resolved);
      for (const pattern of HARD_DENIED_PATTERNS) {
        if (pattern.test(baseName) || pattern.test(filePath)) {
          return {
            allowed: false,
            reason: `Access to sensitive file '${filePath}' is strictly forbidden (Hard Policy P3).`,
            policy: HARD_SECURITY_POLICIES.P3_CREDENTIAL_ACCESS_DENIED
          };
        }
      }
    }

    const isWrite = WRITE_TOOLS.has(toolName) || request.isWrite === true;
    if (isWrite) {
      if (!ALLOWED_WRITE_PHASES.has(phase)) {
        return {
          allowed: false,
          reason: `Write tool '${toolName}' is forbidden in lifecycle phase '${phase}'. Allowed only in EXECUTE and DOCUMENT (Hard Policy P6).`,
          policy: HARD_SECURITY_POLICIES.P6_LIFECYCLE_WRITE_VIOLATION
        };
      }
    }

    if (!this.configValidation.valid) {

      if (isWrite || toolName === 'bash' || toolName === 'run_command') {
        return {
          allowed: false,
          reason: `Security Fail-Closed: Project configuration is invalid or missing (${this.configValidation.error}). State-modifying operations rejected.`,
          policy: 'CFG_FAIL_CLOSED_DENIED'
        };
      }
    }

    if (this.config) {

      const deniedTools = this.config.policy?.denied_tools || [];
      if (deniedTools.includes(toolName)) {
        return {
          allowed: false,
          reason: `Tool '${toolName}' is forbidden by project runtime.config.json.`,
          policy: 'CFG_TOOL_DENIED'
        };
      }

      const phaseTools = this.config.policy?.phase_rules?.[phase]?.allowed_tools;
      if (Array.isArray(phaseTools) && !phaseTools.includes(toolName) && !phaseTools.includes('*')) {
        return {
          allowed: false,
          reason: `Tool '${toolName}' is not allowed in phase '${phase}' by project configuration.`,
          policy: 'CFG_PHASE_TOOL_DENIED'
        };
      }

      if (filePath && this.config.workspace?.boundaries) {
        const allowedBoundaries = this.config.workspace.boundaries.allowed || [];
        if (allowedBoundaries.length > 0) {
          const rel = path.relative(this.rootDir, path.resolve(this.rootDir, filePath)).replace(/\\/g, '/');
          const isInsideAllowed = allowedBoundaries.some(b => rel === b || rel.startsWith(b.replace(/\/$/, '') + '/'));
          if (!isInsideAllowed && rel !== 'runtime.config.json' && rel !== 'package.json') {
            return {
              allowed: false,
              reason: `Path '${filePath}' is outside configured workspace boundaries: [${allowedBoundaries.join(', ')}].`,
              policy: 'CFG_PATH_BOUNDARY_DENIED'
            };
          }
        }
      }
    }

    return {
      allowed: true,
      reason: `Tool '${toolName}' permitted in phase '${phase}'.`,
      policy: 'ALLOW'
    };
  }

  validateEventLog(events) {
    const violations = [];
    for (const e of events) {
      if (e.event_type === 'tool.completed' || e.event_type === 'tool.requested') {
        const check = this.canExecute({ tool: e.tool_name, args: e.tool_args }, { current_phase: e.phase });
        if (!check.allowed && check.policy !== HARD_SECURITY_POLICIES.P1_PUSH_APPROVAL_REQUIRED) {
          violations.push({ event: e, violation: check });
        }
      }
    }
    return {
      valid: violations.length === 0,
      violations
    };
  }
}
