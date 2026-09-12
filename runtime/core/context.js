import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { deepFreeze } from './contracts.js';
import { HARD_DENIED_PATTERNS } from './policy.js';

export const CONTEXT_SOURCE_TYPES = Object.freeze({
  FILE: 'file',
  DIRECTORY: 'directory',
  SPECIFICATION: 'specification',
  CODE_SNAPSHOT: 'code_snapshot',
  SCHEMA_SNAPSHOT: 'schema_snapshot',
  SKILL: 'skill',
  ARTIFACT: 'artifact'
});

export const DEFAULT_MAX_TOKENS = 8000;
export const DEFAULT_MAX_ITEMS = 10;
export const MAX_FILE_SIZE_BYTES = 500 * 1024;

export function sha256(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export class ContextGovernance {
  constructor({
    rootDir = process.cwd(),
    allowedScopes = null,
    deniedPatterns = HARD_DENIED_PATTERNS,
    maxFileSizeBytes = MAX_FILE_SIZE_BYTES
  } = {}) {
    this.rootDir = path.resolve(rootDir);
    this.allowedScopes = Array.isArray(allowedScopes) ? allowedScopes : null;
    this.deniedPatterns = deniedPatterns;
    this.maxFileSizeBytes = maxFileSizeBytes;
  }

  isAccessAllowed(targetPath) {
    const resolved = path.resolve(this.rootDir, targetPath);

    if (resolved !== this.rootDir && !resolved.startsWith(this.rootDir + path.sep)) {
      return { allowed: false, reason: 'PATH_TRAVERSAL_DENIED', message: 'Target path escapes workspace root boundary' };
    }

    try {
      const realResolved = fs.realpathSync(resolved);
      if (realResolved !== this.rootDir && !realResolved.startsWith(this.rootDir + path.sep)) {
        return { allowed: false, reason: 'PATH_TRAVERSAL_DENIED', message: 'Target path escapes workspace root boundary via symbolic link' };
      }
    } catch {
      // Path does not exist yet; lexical boundary check above remains authoritative.
    }

    const relPath = path.relative(this.rootDir, resolved).replace(/\\/g, '/');

    for (const pattern of this.deniedPatterns) {
      if (pattern.test(relPath) || pattern.test(path.basename(resolved))) {
        return {
          allowed: false,
          reason: 'CONTEXT_ACCESS_DENIED',
          message: `Access denied to sensitive or restricted resource: '${relPath}'`
        };
      }
    }

    if (this.allowedScopes && this.allowedScopes.length > 0) {
      const topDir = relPath.split('/')[0];
      const isAllowed = this.allowedScopes.includes(topDir) ||
        relPath === 'package.json' ||
        relPath === 'runtime.config.json' ||
        relPath === 'AGENTS.md' ||
        relPath === 'README.md';

      if (!isAllowed) {
        return {
          allowed: false,
          reason: 'SCOPE_NOT_ALLOWED',
          message: `Scope '${topDir}' is not within permitted context scopes: [${this.allowedScopes.join(', ')}]`
        };
      }
    }

    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      const stats = fs.statSync(resolved);
      if (stats.size > this.maxFileSizeBytes) {
        return {
          allowed: false,
          reason: 'FILE_SIZE_EXCEEDED',
          message: `File '${relPath}' size (${stats.size} bytes) exceeds maximum limit of ${this.maxFileSizeBytes} bytes`
        };
      }
    }

    return { allowed: true, reason: null, resolvedPath: resolved, relativePath: relPath };
  }
}

export function createRetrievalRequest({
  requestId,
  runId,
  agentId,
  query = '',
  sources = [],
  maxTokens = DEFAULT_MAX_TOKENS,
  maxItems = DEFAULT_MAX_ITEMS,
  priority = 'normal',
  purpose = ''
}) {
  if (!runId) throw new Error("Missing 'runId' in RetrievalRequest");
  if (!agentId) throw new Error("Missing 'agentId' in RetrievalRequest");
  if (!Array.isArray(sources)) throw new Error("'sources' must be an array in RetrievalRequest");

  const req = {
    request_id: requestId || `retrieval-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    run_id: runId,
    agent_id: agentId,
    query: typeof query === 'string' ? query : '',
    sources: [...sources],
    max_tokens: Number(maxTokens) > 0 ? Number(maxTokens) : DEFAULT_MAX_TOKENS,
    max_items: Number(maxItems) > 0 ? Number(maxItems) : DEFAULT_MAX_ITEMS,
    priority: ['high', 'normal', 'low'].includes(priority) ? priority : 'normal',
    purpose: typeof purpose === 'string' ? purpose : '',
    requested_at: new Date().toISOString()
  };

  return deepFreeze(req);
}

export class RetrievalEngine {
  constructor({ rootDir = process.cwd(), governance = null } = {}) {
    this.rootDir = path.resolve(rootDir);
    this.governance = governance || new ContextGovernance({ rootDir: this.rootDir });
  }

  async resolve(retrievalRequest) {
    const { request_id, sources, max_tokens, max_items } = retrievalRequest;
    const collectedItems = [];

    for (const source of sources) {
      if (collectedItems.length >= max_items) break;

      const sourcePath = typeof source === 'string' ? source : (source.path || source.target);
      if (!sourcePath) continue;

      let filePath = sourcePath;
      let targetSection = null;
      if (sourcePath.includes('#')) {
        const parts = sourcePath.split('#');
        filePath = parts[0];
        targetSection = parts[1];
      }

      const govCheck = this.governance.isAccessAllowed(filePath);
      if (!govCheck.allowed) {
        const err = new Error(`Governance Denied: ${govCheck.message}`);
        err.code = govCheck.reason;
        err.details = { path: filePath, reason: govCheck.reason };
        throw err;
      }

      const fullPath = govCheck.resolvedPath;
      if (!fs.existsSync(fullPath)) continue;

      const stat = fs.statSync(fullPath);
      if (stat.isFile()) {
        let content = fs.readFileSync(fullPath, 'utf8');
        if (content.charCodeAt(0) === 0xFEFF) {
          content = content.slice(1);
        }

        if (targetSection) {
          const sectionRegex = new RegExp(`(^##+\\s+.*${targetSection.trim()}.*$[\\s\\S]*?)(?=^##+\\s|$)`, 'im');
          const match = content.match(sectionRegex);
          content = match ? match[1].trim() : content;
        }

        const itemHash = sha256(content);
        const tokenEst = estimateTokens(content);

        collectedItems.push({
          source_id: govCheck.relativePath + (targetSection ? `#${targetSection}` : ''),
          type: targetSection ? CONTEXT_SOURCE_TYPES.SPECIFICATION : CONTEXT_SOURCE_TYPES.FILE,
          path: govCheck.relativePath,
          section: targetSection || null,
          content,
          hash: itemHash,
          token_estimate: tokenEst
        });
      }
    }

    collectedItems.sort((a, b) => a.source_id.localeCompare(b.source_id));

    const budgetItems = [];
    let currentTokens = 0;

    for (const item of collectedItems) {
      if (currentTokens + item.token_estimate <= max_tokens) {
        budgetItems.push(item);
        currentTokens += item.token_estimate;
      } else {
        const remainingBudget = max_tokens - currentTokens;
        if (remainingBudget >= 20 && budgetItems.length === 0) {
          const suffix = '\n... [TRUNCATED]';
          const maxChars = remainingBudget * 4;
          const sliceChars = Math.max(0, maxChars - suffix.length);
          const truncatedContent = item.content.slice(0, sliceChars) + suffix;
          const tokenEst = estimateTokens(truncatedContent);

          if (tokenEst <= remainingBudget) {
            const truncatedItem = {
              ...item,
              content: truncatedContent,
              hash: sha256(truncatedContent),
              token_estimate: tokenEst
            };
            budgetItems.push(truncatedItem);
            currentTokens += tokenEst;
          }
        }
        break;
      }
    }

    const canonicalDescriptor = budgetItems
      .map(i => `${i.source_id}:${i.hash}:${i.token_estimate}`)
      .join('|');
    const bundleHash = sha256(canonicalDescriptor);

    const bundle = {
      bundle_id: `bundle-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
      request_id,
      generated_at: new Date().toISOString(),
      bundle_hash: bundleHash,
      items: budgetItems,
      total_items: budgetItems.length,
      total_tokens: currentTokens,
      max_tokens_budget: max_tokens
    };

    return deepFreeze(bundle);
  }
}
