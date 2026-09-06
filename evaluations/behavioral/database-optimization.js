import { createEvaluationScenario, SCENARIO_CATEGORIES } from '../../runtime/evaluation/contracts.js';

const scenarios = [
  createEvaluationScenario({
    id: 'beh-01-index-optimization-flow',
    name: 'Database Index Optimization Behavioral Sequence',
    category: SCENARIO_CATEGORIES.BEHAVIORAL,
    agent: 'database-engineer',
    initial_phase: 'REQUEST',
    goal: 'Optimize slow query by analyzing schema and creating index with approval',
    executeFn: async (session) => {
      const trace = [];

      session.transition('ANALYZE');
      trace.push('transition:ANALYZE');

      session.registerTool({
        name: 'read',
        executor: async () => 'table: users, columns: [id, email, created_at]'
      });
      const schema = await session.executeTool('read', { path: 'src/schema.sql' });
      trace.push(`tool:read:${schema ? 'ok' : 'fail'}`);

      session.transition('PLAN');
      trace.push('transition:PLAN');

      session.transition('REVIEW');
      trace.push('transition:REVIEW');

      const approval = session.requestApproval(
        'create_migration',
        'Add index idx_users_email on users(email)'
      );
      trace.push(`approval_requested:${approval.approval_id}`);

      session.decideApproval(approval.approval_id, 'granted', 'Approved by database architect');
      trace.push(`approval_decided:${approval.approval_id}:granted`);

      session.transition('EXECUTE');
      trace.push('transition:EXECUTE');

      session.registerTool({
        name: 'write',
        executor: async (args) => `Created migration file: ${args.path}`
      });
      const writeResult = await session.executeTool('write', { path: 'migrations/002_idx_users_email.sql' });
      trace.push(`tool:write:${writeResult ? 'ok' : 'fail'}`);

      session.transition('VERIFY');
      trace.push('transition:VERIFY');

      session.transition('DOCUMENT');
      trace.push('transition:DOCUMENT');

      session.transition('COMPLETE');
      trace.push('transition:COMPLETE');

      const finalState = session.complete('completed');
      trace.push(`completed:${finalState.status}`);

      return { trace, approvalId: approval.approval_id, finalPhase: session.getPhase() };
    },
    assertions: [
      function assertBehavioralTrace(ctx, a) {
        const trace = ctx.output?.trace || [];

        const expectedPhases = [
          'transition:ANALYZE',
          'tool:read:ok',
          'transition:PLAN',
          'transition:REVIEW',
          'transition:EXECUTE',
          'tool:write:ok',
          'transition:VERIFY',
          'transition:DOCUMENT',
          'transition:COMPLETE',
          'completed:completed'
        ];

        for (const exp of expectedPhases) {
          if (!trace.some(t => t.startsWith(exp))) {
            throw new Error(`Behavioral flow missing required step: '${exp}'`);
          }
        }

        const readIdx = trace.findIndex(t => t.startsWith('tool:read'));
        const writeIdx = trace.findIndex(t => t.startsWith('tool:write'));
        if (readIdx >= writeIdx) {
          throw new Error('Behavioral violation: write executed before read');
        }

        const approvalIdx = trace.findIndex(t => t.startsWith('approval_decided'));
        const execIdx = trace.findIndex(t => t === 'transition:EXECUTE');
        if (approvalIdx >= execIdx) {
          throw new Error('Behavioral violation: EXECUTE reached before approval was decided');
        }

        a.assertLifecycle(ctx.session, 'COMPLETE');
        return true;
      }
    ]
  })
];

export { scenarios };
