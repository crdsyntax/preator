import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deepFreeze } from './contracts.js';
import { parseFrontmatter } from './agents.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FRAMEWORK_SKILLS_DIR = path.resolve(__dirname, '../../skills');

export function validateSkillDefinition(def) {
  if (!def || typeof def !== 'object') {
    return { valid: false, error: 'SkillDefinition must be an object' };
  }
  if (!def.id || typeof def.id !== 'string') {
    return { valid: false, error: "Missing or invalid string 'id' in SkillDefinition" };
  }
  if (!def.name || typeof def.name !== 'string') {
    return { valid: false, error: "Missing or invalid string 'name' in SkillDefinition" };
  }
  if (!Array.isArray(def.target_agents)) {
    return { valid: false, error: "'target_agents' must be an array of strings" };
  }
  if (!Array.isArray(def.required_tools)) {
    return { valid: false, error: "'required_tools' must be an array of strings" };
  }
  if (typeof def.instructions !== 'string') {
    return { valid: false, error: "'instructions' must be a string" };
  }

  return { valid: true, error: null };
}

export function createSkillDefinition({
  id,
  name,
  description = '',
  target_agents = [],
  required_tools = [],
  instructions = '',
  version = '1.0'
}) {
  const def = {
    id: id || name,
    name: name || id,
    description: typeof description === 'string' ? description : '',
    target_agents: Array.isArray(target_agents) ? [...target_agents] : [],
    required_tools: Array.isArray(required_tools) ? [...required_tools] : [],
    instructions: typeof instructions === 'string' ? instructions : '',
    version: typeof version === 'string' ? version : '1.0'
  };

  const validation = validateSkillDefinition(def);
  if (!validation.valid) {
    const err = new Error(`SKILL_DEFINITION_INVALID: ${validation.error}`);
    err.code = 'SKILL_DEFINITION_INVALID';
    throw err;
  }

  return deepFreeze(def);
}

export function parseMarkdownSkill(content, filename = 'skill.md') {
  let frontmatter = {};
  let body = content;

  if (content.startsWith('---')) {
    const end = content.indexOf('---', 3);
    if (end !== -1) {
      const rawYaml = content.slice(3, end).trim();
      body = content.slice(end + 3).trim();
      frontmatter = parseFrontmatter(rawYaml);
    }
  }

  const baseName = path.basename(filename, '.md');
  const dirName = path.basename(path.dirname(filename));
  const skillId = frontmatter.id || frontmatter.name || (baseName === 'SKILL' ? dirName : baseName);

  const targetAgents = Array.isArray(frontmatter.target_agents)
    ? frontmatter.target_agents
    : (frontmatter.target ? [frontmatter.target] : []);

  const requiredTools = Array.isArray(frontmatter.required_tools)
    ? frontmatter.required_tools
    : (frontmatter.tools ? [frontmatter.tools] : []);

  return createSkillDefinition({
    id: skillId,
    name: frontmatter.name || skillId,
    description: frontmatter.description || '',
    target_agents: targetAgents,
    required_tools: requiredTools,
    instructions: body,
    version: frontmatter.version || '1.0'
  });
}

export function loadSkillFromMarkdown(filePath) {
  if (!fs.existsSync(filePath)) {
    const err = new Error(`Skill file not found: ${filePath}`);
    err.code = 'SKILL_FILE_NOT_FOUND';
    throw err;
  }
  let content = fs.readFileSync(filePath, 'utf8');
  if (content.charCodeAt(0) === 0xFEFF) {
    content = content.slice(1);
  }
  return parseMarkdownSkill(content, filePath);
}

export class SkillCatalog {
  constructor() {
    this.skills = new Map();
  }

  register(skillDefinition) {
    const val = validateSkillDefinition(skillDefinition);
    if (!val.valid) {
      throw new Error(`Cannot register invalid SkillDefinition: ${val.error}`);
    }
    this.skills.set(skillDefinition.id, deepFreeze(skillDefinition));
    return skillDefinition;
  }

  get(skillId) {
    return this.skills.get(skillId) || null;
  }

  has(skillId) {
    return this.skills.has(skillId);
  }

  list() {
    return Array.from(this.skills.values());
  }

  loadFromDir(dirPath) {
    if (!fs.existsSync(dirPath)) return [];
    const loaded = [];
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dirPath, e.name);
      if (e.isDirectory()) {
        loaded.push(...this.loadFromDir(full));
      } else if (e.name.endsWith('.md')) {
        try {
          const skill = loadSkillFromMarkdown(full);
          this.register(skill);
          loaded.push(skill);
        } catch (err) {

        }
      }
    }
    return loaded;
  }
}

let defaultSkillCatalogInstance = null;

export function getDefaultSkillCatalog(skillsDir = null) {
  if (defaultSkillCatalogInstance && !skillsDir) {
    return defaultSkillCatalogInstance;
  }
  const catalog = new SkillCatalog();
  if (fs.existsSync(FRAMEWORK_SKILLS_DIR)) {
    catalog.loadFromDir(FRAMEWORK_SKILLS_DIR);
  }
  if (skillsDir && fs.existsSync(skillsDir) && skillsDir !== FRAMEWORK_SKILLS_DIR) {
    catalog.loadFromDir(skillsDir);
  }
  if (!skillsDir) {
    defaultSkillCatalogInstance = catalog;
  }
  return catalog;
}
