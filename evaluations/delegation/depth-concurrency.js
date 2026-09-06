import { createEvaluationScenario, SCENARIO_CATEGORIES } from '../../runtime/evaluation/contracts.js';

const scenarios = [

  createEvaluationScenario({
    id: 'del-01-depth-ceiling-enforcement',
    name: 'Delegation Depth Ceiling (depth <= 3)',
    category: SCENARIO_CATEGORIES.DELEGATION,
    agent: 'orchestrator',
    initial_phase: 'EXECUTE',
    goal: 'Ensure orchestrator cannot delegate beyond depth 3',
    executeFn: async (session) => {
      session.orchestration.registerAgent('orchestrator', { role: 'root' });
      session.orchestration.registerAgent('backend-engineer', { role: 'specialist' });

      const res = await session.delegate({
        childAgentId: 'backend-engineer',
        task: 'Excessive depth delegation',
        depth: 4,
        childExecutorFn: async () => 'should_not_run'
      });

      return {
        status: res.status,
        errorCode: res.error?.code
      };
    },
    assertions: [
      function assertDepthExceededDenied(ctx) {
        if (ctx.output?.status !== 'DENIED' || ctx.output?.errorCode !== 'DELEGATION_DEPTH_EXCEEDED') {
          throw new Error(`Expected DELEGATION_DEPTH_EXCEEDED, got ${ctx.output?.errorCode} (${ctx.output?.status})`);
        }
        return true;
      }
    ]
  }),

  createEvaluationScenario({
    id: 'del-02-delegation-loop-prevention',
    name: 'Delegation Anti-Loop Gate',
    category: SCENARIO_CATEGORIES.DELEGATION,
    agent: 'orchestrator',
    initial_phase: 'EXECUTE',
    goal: 'Ensure an agent cannot be delegated to if it is already in the ancestor chain',
    executeFn: async (session) => {
      session.orchestration.registerAgent('orchestrator', { role: 'root' });

      const res = await session.delegate({
        childAgentId: 'orchestrator',
        task: 'Circular self delegation',
        depth: 1,
        childExecutorFn: async () => 'loop'
      });

      return {
        status: res.status,
        errorCode: res.error?.code
      };
    },
    assertions: [
      function assertLoopDenied(ctx) {
        if (ctx.output?.status !== 'DENIED' || ctx.output?.errorCode !== 'DELEGATION_LOOP_DENIED') {
          throw new Error(`Expected DELEGATION_LOOP_DENIED, got ${ctx.output?.errorCode}`);
        }
        return true;
      }
    ]
  })
];

export { scenarios };
