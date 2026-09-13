import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_ARCHITECTURE_PROFILE = Object.freeze({
  pattern: 'layered',
  feature_root: 'src',
  layers: ['presentation', 'application', 'domain', 'infrastructure'],
  structure: { enforce_layers: false },
  dependency_rules: [
    { from: 'domain', disallow: ['application', 'infrastructure', 'presentation'] },
    { from: 'application', disallow: ['infrastructure', 'presentation'] }
  ],
  rules: {
    no_any: true,
    no_console: true,
    no_comments: false,
    enums_for_closed_sets: false,
    secrets: true
  },
  ignore: ['node_modules', '.git', 'dist', 'build', 'target', 'coverage', 'update-dist', '.agent'],
  commands: []
});

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const SECRET_VALUE = /(api[_-]?key|secret|password|passwd|access[_-]?token|auth[_-]?token|private[_-]?key|client[_-]?secret|bearer)\s*[:=]\s*['"][^'"]{8,}['"]/i;
const PRIVATE_KEY_BLOCK = /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/;
const CONSOLE_CALL = /console\.(?:log|error|warn|info|debug|trace)\s*\(/;
const ANY_TYPE = /(?::\s*any\b|\bas\s+any\b|<any>|\bArray<any>)/;

export function defaultArchitectureProfilePath(rootDir = process.cwd()) {
  return path.join(rootDir, 'standards', 'default.json');
}

export function loadArchitectureProfile({ rootDir = process.cwd(), profile = 'default' } = {}) {
  const file = path.join(rootDir, 'standards', `${profile}.json`);
  if (fs.existsSync(file)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
      return {
        ...DEFAULT_ARCHITECTURE_PROFILE,
        ...parsed,
        structure: { ...DEFAULT_ARCHITECTURE_PROFILE.structure, ...(parsed.structure || {}) },
        rules: { ...DEFAULT_ARCHITECTURE_PROFILE.rules, ...(parsed.rules || {}) },
        ignore: Array.isArray(parsed.ignore) ? parsed.ignore : DEFAULT_ARCHITECTURE_PROFILE.ignore,
        layers: Array.isArray(parsed.layers) ? parsed.layers : DEFAULT_ARCHITECTURE_PROFILE.layers,
        dependency_rules: Array.isArray(parsed.dependency_rules) ? parsed.dependency_rules : DEFAULT_ARCHITECTURE_PROFILE.dependency_rules,
        commands: Array.isArray(parsed.commands) ? parsed.commands : []
      };
    } catch {
      // Fall through to defaults on malformed profile.
    }
  }
  return DEFAULT_ARCHITECTURE_PROFILE;
}

function isIgnored(relPath, ignore) {
  const segments = relPath.split(/[\\/]/);
  return segments.some(s => ignore.includes(s));
}

function isTestFile(relPath) {
  return /(?:^|[\\/])(?:__tests__|test|tests|spec)(?:[\\/]|$)/i.test(relPath) || /\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(relPath);
}

function detectLayer(relPath, layers) {
  const segments = relPath.split(/[\\/]/).map(s => s.toLowerCase());
  for (const segment of segments) {
    const normalized = segment.replace(/-/g, '');
    const match = layers.find(layer => layer.toLowerCase() === segment || layer.toLowerCase().replace(/-/g, '') === normalized);
    if (match) return match;
  }
  return null;
}

function collectFiles(rootDir, profile) {
  const root = path.resolve(rootDir, profile.feature_root || '.');
  if (!fs.existsSync(root)) return [];
  const base = root;
  const files = [];

  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(rootDir, full);
      if (isIgnored(rel, profile.ignore)) continue;
      if (entry.isDirectory()) {
        walk(full);
      } else if (CODE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push({ full, rel });
      }
    }
  };

  walk(base);
  return files;
}

function extractImports(content) {
  const imports = [];
  const esImport = /\bimport\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  const requireCall = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match;
  while ((match = esImport.exec(content)) !== null) imports.push(match[1]);
  while ((match = requireCall.exec(content)) !== null) imports.push(match[1]);
  return imports;
}

export function validateArchitecture(rootDir = process.cwd(), profile = DEFAULT_ARCHITECTURE_PROFILE) {
  const files = collectFiles(rootDir, profile);
  const violations = [];
  const rules = profile.rules || {};
  const ignore = profile.ignore || [];

  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(file.full, 'utf8');
    } catch {
      continue;
    }

    const lines = content.split(/\r?\n/);
    const extension = path.extname(file.rel).toLowerCase();
    const scriptExt = extension === '.ts' || extension === '.tsx' || extension === '.js' || extension === '.jsx' || extension === '.mjs' || extension === '.cjs';
    const layer = detectLayer(file.rel, profile.layers);
    const testFile = isTestFile(file.rel);

    lines.forEach((line, index) => {
      const lineNo = index + 1;
      if (rules.no_any && (extension === '.ts' || extension === '.tsx') && ANY_TYPE.test(line) && !/\/\/\s*eslint-disable/.test(line)) {
        violations.push({ file: file.rel, line: lineNo, rule: 'no_any', message: 'Explicit `any` is forbidden; use a precise type or `unknown` with narrowing.' });
      }
      if (rules.no_console && !testFile && CONSOLE_CALL.test(line)) {
        violations.push({ file: file.rel, line: lineNo, rule: 'no_console', message: '`console.*` is forbidden in production code; use the project logger.' });
      }
      if (rules.no_comments && !testFile && scriptExt) {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
          violations.push({ file: file.rel, line: lineNo, rule: 'no_comments', message: 'Comments are not allowed in production code.' });
        }
      }
      if (rules.secrets && (SECRET_VALUE.test(line) || PRIVATE_KEY_BLOCK.test(line))) {
        violations.push({ file: file.rel, line: lineNo, rule: 'secrets', message: 'Potential hardcoded secret detected.' });
      }
    });

    if (layer && profile.dependency_rules?.length) {
      const forbidden = new Set(
        profile.dependency_rules
          .filter(rule => rule.from && rule.from.toLowerCase() === layer.toLowerCase())
          .flatMap(rule => rule.disallow || [])
          .map(l => l.toLowerCase())
      );
      if (forbidden.size > 0) {
        for (const spec of extractImports(content)) {
          if (!spec.startsWith('.')) continue;
          const targetAbs = path.resolve(path.dirname(file.full), spec);
          const targetRel = path.relative(rootDir, targetAbs);
          const targetLayer = detectLayer(targetRel, profile.layers);
          if (targetLayer && forbidden.has(targetLayer.toLowerCase())) {
            violations.push({
              file: file.rel,
              line: 0,
              rule: 'layer_dependency',
              message: `Layer '${layer}' must not import '${targetLayer}' (${spec}).`
            });
          }
        }
      }
    }

    if (profile.structure?.enforce_layers && !layer) {
      violations.push({
        file: file.rel,
        line: 0,
        rule: 'structure',
        message: `File is outside every declared layer (${profile.layers.join(', ')}).`
      });
    }
  }

  const counts = violations.reduce((acc, v) => {
    acc[v.rule] = (acc[v.rule] || 0) + 1;
    return acc;
  }, {});

  return {
    profile: profile.pattern,
    feature_root: profile.feature_root,
    scanned: files.length,
    violations,
    counts,
    valid: violations.length === 0
  };
}
