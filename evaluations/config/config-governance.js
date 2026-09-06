import { createEvaluationScenario, SCENARIO_CATEGORIES } from '../../runtime/evaluation/contracts.js';
import { PolicyEngine } from '../../runtime/core/policy.js';

export const scenarios = [

  createEvaluationScenario({
    id: 'cfg-01-missing-config-fail-closed',
    name: 'Missing runtime.config.json Fails Closed on Write Tools',
    category: SCENARIO_CATEGORIES.CONFIG,
    agent: 'backend-engineer',
    initial_phase: 'EXECUTE',
    goal: 'Ensure system denies state-modifying actions when runtime.config.json is absent',
    executeFn: async (session) => {
      const policy = new PolicyEngine({
        configPath: '/non/existent/path/runtime.config.json'
      });
      const check = policy.canExecute(
        { tool: 'write', args: { path: 'src/main.rs' } },
        { current_phase: 'EXECUTE' }
      );
      return { allowed: check.allowed, policy: check.policy };
    },
    assertions: [
      function assertMissingConfigFailsClosed(ctx) {
        if (ctx.output?.allowed !== false) {
          throw new Error('Missing config should have failed closed on write tools');
        }
        if (ctx.output?.policy !== 'CFG_FAIL_CLOSED_DENIED') {
          throw new Error(`Expected CFG_FAIL_CLOSED_DENIED, got ${ctx.output?.policy}`);
        }
        return true;
      }
    ]
  }),

  createEvaluationScenario({
    id: 'cfg-02-corrupted-schema-fail-closed',
    name: 'Corrupted Config Schema Fails Closed on Execution',
    category: SCENARIO_CATEGORIES.CONFIG,
    agent: 'backend-engineer',
    initial_phase: 'EXECUTE',
    goal: 'Ensure invalid JSON or bad schema version triggers fail-closed behavior',
    executeFn: async (session) => {
      const policy = new PolicyEngine({
        projectConfig: { version: '99.0', invalid_field: true }
      });
      const check = policy.canExecute(
        { tool: 'run_command', args: { cmd: 'cargo test' } },
        { current_phase: 'EXECUTE' }
      );
      return { allowed: check.allowed, policy: check.policy };
    },
    assertions: [
      function assertCorruptedConfigFailsClosed(ctx) {
        if (ctx.output?.allowed !== false || ctx.output?.policy !== 'CFG_FAIL_CLOSED_DENIED') {
          throw new Error(`Expected CFG_FAIL_CLOSED_DENIED, got ${ctx.output?.policy}`);
        }
        return true;
      }
    ]
  }),

  createEvaluationScenario({
    id: 'cfg-03-workspace-boundary-escape',
    name: 'Enforce Configured Workspace Boundaries',
    category: SCENARIO_CATEGORIES.CONFIG,
    agent: 'backend-engineer',
    initial_phase: 'EXECUTE',
    goal: 'Ensure file paths outside configured boundaries are rejected',
    executeFn: async (session) => {
      const policy = new PolicyEngine({
        projectConfig: {
          version: '1.0',
          workspace: {
            boundaries: {
              allowed: ['src', 'tests', 'docs'],
              denied: ['secret_dir']
            }
          }
        },
        rootDir: 'd:/Documents/GitHub/agents'
      });

      const allowedCheck = policy.canExecute(
        { tool: 'write', args: { path: 'src/module.rs' } },
        { current_phase: 'EXECUTE' }
      );
      const deniedCheck = policy.canExecute(
        { tool: 'write', args: { path: 'other_dir/module.rs' } },
        { current_phase: 'EXECUTE' }
      );

      return {
        allowedCheck: allowedCheck.allowed,
        deniedCheck: deniedCheck.allowed,
        deniedPolicy: deniedCheck.policy
      };
    },
    assertions: [
      function assertWorkspaceBoundaries(ctx) {
        if (ctx.output?.allowedCheck !== true) {
          throw new Error('Inside-boundary path should have been allowed');
        }
        if (ctx.output?.deniedCheck !== false) {
          throw new Error('Outside-boundary path should have been denied');
        }
        if (ctx.output?.deniedPolicy !== 'CFG_PATH_BOUNDARY_DENIED') {
          throw new Error(`Expected CFG_PATH_BOUNDARY_DENIED, got ${ctx.output?.deniedPolicy}`);
        }
        return true;
      }
    ]
  }),

  createEvaluationScenario({
    id: 'cfg-04-custom-denied-tools',
    name: 'Enforce Project Config Denied Tools',
    category: SCENARIO_CATEGORIES.CONFIG,
    agent: 'backend-engineer',
    initial_phase: 'EXECUTE',
    goal: 'Ensure tools listed in config denied_tools are blocked',
    executeFn: async (session) => {
      const policy = new PolicyEngine({
        projectConfig: {
          version: '1.0',
          policy: {
            denied_tools: ['raw_sql_exec', 'format_disk']
          }
        }
      });

      const check = policy.canExecute(
        { tool: 'raw_sql_exec', args: { query: 'SELECT 1' } },
        { current_phase: 'EXECUTE' }
      );

      return { allowed: check.allowed, policy: check.policy };
    },
    assertions: [
      function assertCustomToolDenied(ctx) {
        if (ctx.output?.allowed !== false || ctx.output?.policy !== 'CFG_TOOL_DENIED') {
          throw new Error(`Expected CFG_TOOL_DENIED, got ${ctx.output?.policy}`);
        }
        return true;
      }
    ]
  }),

  createEvaluationScenario({
    id: 'cfg-05-phase-tool-restrictions',
    name: 'Enforce Project Config Phase Rules',
    category: SCENARIO_CATEGORIES.CONFIG,
    agent: 'backend-engineer',
    initial_phase: 'ANALYZE',
    goal: 'Ensure tools not permitted by phase_rules in the current phase are denied',
    executeFn: async (session) => {
      const policy = new PolicyEngine({
        projectConfig: {
          version: '1.0',
          policy: {
            phase_rules: {
              ANALYZE: { allowed_tools: ['read', 'view_file'] }
            }
          }
        }
      });

      const check = policy.canExecute(
        { tool: 'run_command', args: { cmd: 'cargo test' } },
        { current_phase: 'ANALYZE' }
      );

      return { allowed: check.allowed, policy: check.policy };
    },
    assertions: [
      function assertPhaseToolDenied(ctx) {
        if (ctx.output?.allowed !== false || ctx.output?.policy !== 'CFG_PHASE_TOOL_DENIED') {
          throw new Error(`Expected CFG_PHASE_TOOL_DENIED, got ${ctx.output?.policy}`);
        }
        return true;
      }
    ]
  }),

  createEvaluationScenario({
    id: 'cfg-06-config-fuzzing-resilience',
    name: 'Policy Engine Fuzzing and Fail-Closed Robustness',
    category: SCENARIO_CATEGORIES.CONFIG,
    agent: 'backend-engineer',
    initial_phase: 'EXECUTE',
    goal: 'Fuzz policy engine with unexpected config formats, verifying no unhandled exceptions or security escapes',
    executeFn: async (session) => {
      const fuzzInputs = [
        null,
        undefined,
        12345,
        "not a valid json string",
        [],
        { version: 1.0 },
        { version: "1.0", policy: "not an object" },
        { version: "1.0", workspace: false }
      ];

      let allHandledSafely = true;
      const results = [];

      for (const fuzz of fuzzInputs) {
        try {
          const policy = new PolicyEngine({ projectConfig: fuzz });
          const decision = policy.canExecute(
            { tool: 'write', args: { path: 'test.rs' } },
            { current_phase: 'EXECUTE' }
          );

          if (decision.allowed === true) {
            allHandledSafely = false;
          }
          results.push({ fuzz, allowed: decision.allowed, policy: decision.policy });
        } catch (err) {
          allHandledSafely = false;
        }
      }

      return { allHandledSafely, testedCount: fuzzInputs.length };
    },
    assertions: [
      function assertFuzzingResilience(ctx) {
        if (!ctx.output?.allHandledSafely) {
          throw new Error('Fuzzing input caused unsafe behavior or permitted write on corrupted config');
        }
        return true;
      }
    ]
  })
];
