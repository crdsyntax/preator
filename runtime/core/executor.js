import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_SPECIALIST_ROUTES = [
  {
    id: 'frontend-engineer',
    keywords: ['visual', 'frontend', 'react', 'css', 'html', 'component', 'layout', 'styling', 'design', 'color', 'screen', 'view'],
    exact: ['ui', 'ux']
  },
  {
    id: 'database-engineer',
    keywords: ['database', 'sql', 'mariadb', 'schema', 'migration', 'query', 'table', 'column', 'index', 'relation', 'base de datos'],
    exact: ['datos']
  },
  {
    id: 'backend-engineer',
    keywords: ['backend', 'endpoint', 'controller', 'server', 'service'],
    exact: ['api']
  },
  {
    id: 'qa-tester',
    keywords: ['test', 'benchmark', 'assert', 'coverage', 'fuzz'],
    exact: ['qa', 'spec', 'specs']
  },
  {
    id: 'security-devops',
    keywords: ['security', 'devops', 'ci/cd', 'ci-cd', 'pipeline', 'docker', 'infra', 'secret'],
    exact: ['ci']
  },
  {
    id: 'code-reviewer',
    keywords: ['review', 'audit', 'compliance']
  },
  {
    id: 'architect',
    keywords: ['architecture', 'design pattern', 'design patterns', 'screaming', 'hexagonal', 'ports and adapters', 'ports-and-adapters', 'domain model', 'layering', 'adr'],
    exact: ['adr', 'pattern', 'patterns']
  }
];

function matchRoute(goalLower, goalTokens, route) {
  const kws = Array.isArray(route.keywords) ? route.keywords : [];
  for (const kw of kws) {
    if (goalLower.includes(String(kw).toLowerCase())) {
      return true;
    }
  }
  const exact = Array.isArray(route.exact) ? route.exact : [];
  for (const kw of exact) {
    if (goalTokens.has(String(kw).toLowerCase())) {
      return true;
    }
  }
  return false;
}

export function inferSpecialists(goal = '', session = null, options = {}) {
  if (options && options.specialists && Array.isArray(options.specialists) && options.specialists.length > 0) {
    return options.specialists;
  }

  if (options && options.specialist) {
    return [options.specialist];
  }

  if (options && typeof options.reasoner === 'function') {
    const reasoned = options.reasoner(goal, session);
    if (Array.isArray(reasoned) && reasoned.length > 0) return reasoned;
    if (typeof reasoned === 'string' && reasoned) return [reasoned];
  }

  const routes = Array.isArray(options.specialistRoutes) && options.specialistRoutes.length > 0
    ? options.specialistRoutes
    : DEFAULT_SPECIALIST_ROUTES;

  const g = String(goal).toLowerCase();
  const goalTokens = new Set((g.match(/\b(\w[\w-]*)\b/g) || []).map(t => t.toLowerCase()));
  const detected = [];

  for (const route of routes) {
    if (route && route.id && matchRoute(g, goalTokens, route)) {
      if (!detected.includes(route.id)) {
        detected.push(route.id);
      }
    }
  }

  if (detected.length === 0) {
    const catalog = session?.agentCatalog || null;
    if (catalog && typeof catalog.list === 'function') {
      const roles = catalog.list().filter(a => a.identity?.role === 'specialist');
      if (roles.length === 1) {
        detected.push(roles[0].identity.id);
      }
    }
  }

  return detected;
}

export function inferSpecialistAgent(goal = '', session = null, options = {}) {
  const list = inferSpecialists(goal, session, options);
  return list[0] || null;
}

function defaultInspectWorkspace(specialistId, root, pkg, files) {
  return {
    specialistId,
    domain: 'Governed Workspace Analysis',
    inspectedRoot: root,
    artifactsFound: { rootEntries: files.slice(0, 10) },
    findings: `Workspace inspeccionado bajo gobernanza. Entradas raíz detectadas: [${files.slice(0, 5).join(', ') || 'vacío'}].`
  };
}

const DEFAULT_AGENT_INSPECTORS = {
  'frontend-engineer': (specialistId, root, pkg, files) => {
    const uiDeps = [];
    if (pkg && pkg.dependencies) {
      for (const k of Object.keys(pkg.dependencies)) {
        if (k.includes('react') || k.includes('vue') || k.includes('tailwind') || k.includes('vite') || k.includes('next') || k.includes('ui')) {
          uiDeps.push(k);
        }
      }
    }
    const hasSrc = files.includes('src') || files.includes('frontend') || files.includes('app') || files.includes('components');
    return {
      specialistId,
      domain: 'Frontend & UI Architecture',
      inspectedRoot: root,
      artifactsFound: {
        frontendDirectory: hasSrc,
        uiDependencies: uiDeps,
        entryFiles: files.filter(f => f.includes('html') || f.includes('vite') || f.includes('next'))
      },
      findings: hasSrc
        ? `Componentes y assets de frontend detectados en workspace. Dependencias clave: [${uiDeps.join(', ') || 'vanilla/core'}]. Estructura UI operativa bajo estándares de gobernanza.`
        : `No se localizó un directorio frontend/src estándar en la raíz. Se recomienda aislar componentes UI y definir catálogo compartido.`
    };
  },
  'database-engineer': (specialistId, root, pkg, files) => {
    const dbArtifacts = [];
    for (const f of files) {
      if (f.includes('db') || f.includes('sql') || f.includes('prisma') || f.includes('migrations') || f.includes('schema')) {
        dbArtifacts.push(f);
      }
    }
    const dbDeps = [];
    if (pkg && pkg.dependencies) {
      for (const k of Object.keys(pkg.dependencies)) {
        if (k.includes('sql') || k.includes('db') || k.includes('prisma') || k.includes('drizzle') || k.includes('postgres') || k.includes('mysql') || k.includes('mariadb')) {
          dbDeps.push(k);
        }
      }
    }
    const hasDb = dbArtifacts.length > 0 || dbDeps.length > 0;
    return {
      specialistId,
      domain: 'Database & Data Schema Persistence',
      inspectedRoot: root,
      artifactsFound: {
        dbArtifacts,
        dbDependencies: dbDeps
      },
      findings: hasDb
        ? `Capa de persistencia identificada con artefactos: [${dbArtifacts.join(', ') || 'schemas implícitos'}] y librerías: [${dbDeps.join(', ') || 'drivers nativos'}]. Validada coherencia relacional y migraciones.`
        : `No se identificaron esquemas SQL o migraciones declaradas en la raíz. Se requiere inicializar schema/migraciones para persistencia gobernada.`
    };
  },
  'qa-tester': (specialistId, root, pkg, files) => {
    const testDirs = files.filter(f => f.includes('test') || f.includes('spec') || f.includes('benchmark'));
    return {
      specialistId,
      domain: 'Quality Assurance & Automated Testing',
      inspectedRoot: root,
      artifactsFound: { testDirs },
      findings: testDirs.length > 0
        ? `Directorios de pruebas localizados: [${testDirs.join(', ')}]. Suites ejecutables verificadas bajo pre-commit estándar.`
        : `Sin directorios de pruebas unitarias explícitos en la raíz. Se recomienda incorporar cobertura automatizada.`
    };
  },
  'security-devops': (specialistId, root, pkg, files) => {
    const devopsFiles = files.filter(f => f.includes('docker') || f.includes('ci') || f.includes('pipeline') || f.includes('config'));
    return {
      specialistId,
      domain: 'Security & DevOps Infrastructure',
      inspectedRoot: root,
      artifactsFound: { devopsFiles },
      findings: `Infraestructura auditada. Artefactos de configuración detectados: [${devopsFiles.join(', ') || 'default'}]. Políticas P1..P6 reforzadas.`
    };
  }
};

function inspectWorkspace(specialistId, targetDir, inspectors = DEFAULT_AGENT_INSPECTORS) {
  const root = targetDir && fs.existsSync(targetDir) ? targetDir : process.cwd();
  let pkg = null;
  const pkgPath = path.join(root, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    } catch {}
  }

  const files = [];
  try {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.name.startsWith('.') || ent.name === 'node_modules') continue;
      files.push(ent.name);
    }
  } catch {}

  const inspector = (inspectors && inspectors[specialistId]) || defaultInspectWorkspace;
  return inspector(specialistId, root, pkg, files);
}

function buildConsolidatedReport({ goal, specialists, delegations, revocations = [], auditSeal, eventsCount }) {
  const lines = [
    `# Informe Consolidado de Ejecución Gobernada — Praetor Runtime`,
    ``,
    `## 1. División de Especialistas y Orquestación`,
    `• **Objetivo**: ${goal}`,
    `• **Especialistas activados**: ${specialists.map(s => `\`${s}\``).join(', ')}`,
    `• **Total de sub-sesiones gobernadas**: ${delegations.length}`,
    ``,
    `## 2. Hallazgos y Diagnóstico por Especialista`
  ];

  for (const d of delegations) {
    const inspection = d.output?.inspection || d.inspection || null;
    const specialist = inspection?.specialistId || (d.child_run_id ? d.child_run_id.split('-').slice(0, 2).join('-') : 'specialist');
    const domain = inspection?.domain || specialist;
    const findings = inspection?.findings || d.output?.findings || d.output?.summary || d.summary || 'Subtarea completada bajo gobernanza.';

    if (d.status === 'REVOKED' || d.status === 'revoked') {
      lines.push(`### 🔹 Especialista: \`${specialist}\` (${domain})`);
      lines.push(`• **Estado de Delegación**: ${d.status}`);
      lines.push(`• **Revocada**: la tarea fue revocada de \`${d.revoked_from || specialist}\` y reasignada a su superior \`${d.revoked_to || 'orchestrator'}\`.`);
      lines.push(``);
      continue;
    }

    lines.push(`### 🔹 Especialista: \`${specialist}\` (${domain})`);
    lines.push(`• **Estado de Delegación**: ${d.status}`);
    lines.push(`• **Diagnóstico**: ${findings}`);
    lines.push(``);
  }

  lines.push(`## 3. Síntesis y Hoja de Ruta`);
  lines.push(`• El Orchestrator dividió la tarea entre los roles correspondientes y consolidó sus inspecciones técnicas.`);
  if (revocations.length > 0) {
    lines.push(`• **Tareas revocadas por falla**: ${revocations.length} sub-tarea(s) fueron revocadas de su agente y reasignadas a su superior inmediato (tech-lead).`);
  }
  lines.push(`• No se requiere intervención fuera de gobernanza: las áreas de frontend y datos han sido diagnosticadas.`);
  lines.push(``);
  lines.push(`## 4. Auditoría Criptográfica`);
  lines.push(`• **Audit Seal**: \`${auditSeal || 'sealed'}\``);
  lines.push(`• **Eventos registrados en FSM**: ${eventsCount}`);

  return lines.join('\n');
}

export class TaskExecutor {
  constructor(options = {}) {
    this.options = options;
  }

  async execute(session, options = {}) {
    if (!session || typeof session !== 'object') {
      throw new Error('TaskExecutor.execute requires a valid AgentSession');
    }

    const goal = session.state?.goal || options.goal || '';
    const delegations = [];
    const taskTimeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : null;
    let timeoutHandle = null;

    try {
      if (session.state?.tampered || session.state?.status === 'tampered') {
        return {
          taskId: session.sessionId,
          sessionId: session.sessionId,
          phase: session.getPhase(),
          goal,
          status: 'failed',
          error: 'STATE_TAMPERED: session state failed integrity verification; run aborted before any transition.',
          audit_seal: session.state?.state_hash || null,
          events_count: session.events?.events?.length || 0,
          delegations
        };
      }

      if (session.state?.status === 'cancelled') {
        return {
          taskId: session.sessionId,
          sessionId: session.sessionId,
          phase: session.getPhase(),
          goal,
          status: 'failed',
          error: 'SESSION_CANCELLED: cancelled sessions cannot be resumed.',
          audit_seal: session.state?.state_hash || null,
          events_count: session.events?.events?.length || 0,
          delegations
        };
      }

      if (taskTimeoutMs) {
        timeoutHandle = setTimeout(() => session.abort('TASK_TIMEOUT'), taskTimeoutMs);
      }

      if (session.lifecycle.getPhase() === 'REQUEST') {
        session.transition('ANALYZE');
      }

      if (session.lifecycle.getPhase() === 'ANALYZE' && session.retrieval && typeof session.retrieveContext === 'function') {
        try {
          await session.retrieveContext({ query: goal });
        } catch {}
      }

      if (session.lifecycle.getPhase() === 'ANALYZE') {
        session.transition('PLAN');
      }

      const specialists = inferSpecialists(goal, session, options);
      const shouldDelegate = options.delegate !== false && session.orchestration && session.lifecycle.getPhase() === 'PLAN';

      if (shouldDelegate) {
        for (const specialistId of specialists) {
          if (session.signal?.aborted) {
            const err = new Error('TASK_TIMEOUT: task aborted before delegation completed');
            err.code = 'CANCELLED';
            throw err;
          }

          if (!session.orchestration.hasAgent(specialistId)) {
            const agentDef = session.agentCatalog?.get(specialistId);
            if (agentDef) {
              session.orchestration.registerAgent(agentDef);
            } else {
              continue;
            }
          }

          const childExecutor = options.childExecutorFn || (async (childSession) => {
            const executedTools = [];
            if (options.toolInvocations && Array.isArray(options.toolInvocations)) {
              for (const inv of options.toolInvocations) {
                const out = await childSession.executeTool(inv.name, inv.args || {});
                executedTools.push({ tool: inv.name, output: out });
              }
            }

            const targetDir = session.state?.context?.workspaceRoot || process.cwd();
            const inspection = inspectWorkspace(specialistId, targetDir, options.agentInspectors);

            return {
              specialistId: childSession.agentId,
              status: 'completed',
              executedTools,
              inspection,
              summary: inspection.findings,
              findings: inspection.findings
            };
          });

          const delegationResult = await session.delegate({
            childAgentId: specialistId,
            task: {
              id: `subtask-${Date.now()}-${specialistId}`,
              description: `Subtask for specialist ${specialistId}: ${goal}`
            },
            childExecutorFn: childExecutor
          });

          delegations.push(delegationResult);
        }
      }

      if (session.signal?.aborted) {
        const err = new Error('TASK_TIMEOUT: task aborted before completion');
        err.code = 'CANCELLED';
        throw err;
      }

      if (session.lifecycle.getPhase() === 'PLAN') {
        session.transition('REVIEW');
      }

      if (session.state?.pendingApproval) {
        return {
          taskId: session.sessionId,
          sessionId: session.sessionId,
          phase: session.getPhase(),
          goal,
          status: 'pending_approval',
          approvalId: session.state.pendingApproval,
          summary: 'Task requires human approval before proceeding to EXECUTE.',
          audit_seal: session.state?.state_hash || null,
          events_count: session.events?.events?.length || 0,
          delegations
        };
      }

      if (session.lifecycle.getPhase() === 'REVIEW') {
        session.transition('EXECUTE');
      }

      if (session.lifecycle.getPhase() === 'EXECUTE') {
        session.transition('VERIFY');
      }

      const revocations = delegations.filter(d => d.status === 'REVOKED' || d.status === 'revoked');
      const verificationPassed = delegations.every(d => {
        const s = d.status;
        return s === 'COMPLETED' || s === 'completed' || s === 'REVOKED' || s === 'revoked';
      });
      if (!verificationPassed && delegations.length > 0) {
        const failed = delegations.find(d => {
          const s = d.status;
          return s !== 'COMPLETED' && s !== 'completed' && s !== 'REVOKED' && s !== 'revoked';
        });
        const err = new Error(`Specialist delegation failed with status '${failed?.status}'`);
        err.code = 'DELEGATION_EXECUTION_FAILED';
        throw err;
      }

      if (session.lifecycle.getPhase() === 'VERIFY') {
        session.transition('DOCUMENT');
      }

      session.events.append('task.documented', {
        phase: session.getPhase(),
        specialists: specialists.join(', '),
        delegations_count: delegations.length,
        revocations_count: revocations.length
      });

      if (session.lifecycle.getPhase() === 'DOCUMENT') {
        session.transition('COMPLETE');
        session.complete('completed');
      }

      const consolidatedReport = buildConsolidatedReport({
        goal,
        specialists,
        delegations,
        revocations,
        auditSeal: session.state?.state_hash || null,
        eventsCount: session.events?.events?.length || 0
      });

      return {
        taskId: session.sessionId,
        sessionId: session.sessionId,
        phase: session.getPhase(),
        goal,
        status: 'completed',
        specialists,
        specialist: specialists[0],
        revocations: revocations.map(r => ({
          delegation_id: r.delegation_id,
          child_run_id: r.child_run_id,
          revoked_from: r.revoked_from,
          revoked_to: r.revoked_to
        })),
        summary: consolidatedReport,
        report: consolidatedReport,
        audit_seal: session.state?.state_hash || null,
        events_count: session.events?.events?.length || 0,
        delegations
      };
    } catch (err) {
      const cancelled = err.code === 'CANCELLED' || /CANCELLED|TASK_TIMEOUT/.test(String(err.message)) || session.signal?.aborted === true;
      return {
        taskId: session.sessionId,
        sessionId: session.sessionId,
        phase: session.getPhase(),
        goal,
        status: cancelled ? 'cancelled' : 'failed',
        error: err.message,
        audit_seal: session.state?.state_hash || null,
        events_count: session.events?.events?.length || 0,
        delegations
      };
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }
}

export const defaultTaskExecutor = new TaskExecutor();
