import { createEvaluationScenario, SCENARIO_CATEGORIES } from '../../runtime/evaluation/contracts.js';

export const scenarios = [

  createEvaluationScenario({
    id: 'stk-01-rust-cargo-governance',
    name: 'Rust & Cargo Stack Lifecycle Governance',
    category: SCENARIO_CATEGORIES.STACKS,
    agent: 'backend-engineer',
    initial_phase: 'REQUEST',
    goal: 'Govern Rust workflow from cargo check in ANALYZE to test in VERIFY',
    executeFn: async (session) => {
      const trace = [];

      session.transition('ANALYZE');
      trace.push('phase:ANALYZE');

      session.registerTool({
        name: 'read',
        executor: async () => 'fn main() { println!("hello"); }'
      });
      const code = await session.executeTool('read', { path: 'src/main.rs' });
      trace.push(`read:${Boolean(code)}`);

      session.transition('PLAN');
      session.transition('REVIEW');
      trace.push('phase:REVIEW');

      session.transition('EXECUTE');
      trace.push('phase:EXECUTE');

      session.registerTool({
        name: 'write',
        executor: async () => 'formatted and written'
      });
      session.registerTool({
        name: 'run_command',
        executor: async (args) => `Executed: ${args.cmd}`
      });

      const writeRes = await session.executeTool('write', { path: 'src/lib.rs' });
      trace.push(`write:${Boolean(writeRes)}`);

      const fmtRes = await session.executeTool('run_command', { cmd: 'cargo fmt --all -- --check' });
      trace.push(`fmt:${Boolean(fmtRes)}`);

      session.transition('VERIFY');
      const testRes = await session.executeTool('run_command', { cmd: 'cargo test --lib' });
      trace.push(`test:${Boolean(testRes)}`);

      session.transition('DOCUMENT');
      session.transition('COMPLETE');
      session.complete('completed');

      return { trace, status: session.state.status };
    },
    assertions: [
      function assertRustStackGoverned(ctx, a) {
        const trace = ctx.output?.trace || [];
        if (!trace.includes('read:true') || !trace.includes('write:true') || !trace.includes('test:true')) {
          throw new Error('Rust workflow incomplete');
        }
        a.assertLifecycle(ctx.session, 'COMPLETE');
        return true;
      }
    ]
  }),

  createEvaluationScenario({
    id: 'stk-02-nextjs-react-governance',
    name: 'Next.js & React Frontend Stack Governance',
    category: SCENARIO_CATEGORIES.STACKS,
    agent: 'frontend-engineer',
    initial_phase: 'REQUEST',
    goal: 'Govern Next.js component creation, tsc check, and build verification',
    executeFn: async (session) => {
      const trace = [];

      session.transition('ANALYZE');
      session.transition('PLAN');
      session.transition('REVIEW');
      session.transition('EXECUTE');

      session.registerTool({
        name: 'write',
        executor: async () => 'React component created'
      });
      session.registerTool({
        name: 'run_command',
        executor: async (args) => `Executed: ${args.cmd}`
      });

      const writeComp = await session.executeTool('write', { path: 'app/components/Button.tsx' });
      trace.push(`component_written:${Boolean(writeComp)}`);

      session.transition('VERIFY');
      const tscRes = await session.executeTool('run_command', { cmd: 'bunx tsc -b' });
      trace.push(`tsc:${Boolean(tscRes)}`);

      session.transition('DOCUMENT');
      session.transition('COMPLETE');
      session.complete('completed');

      return { trace, status: session.state.status };
    },
    assertions: [
      function assertNextjsStackGoverned(ctx, a) {
        const trace = ctx.output?.trace || [];
        if (!trace.includes('component_written:true') || !trace.includes('tsc:true')) {
          throw new Error('Next.js workflow incomplete');
        }
        a.assertLifecycle(ctx.session, 'COMPLETE');
        return true;
      }
    ]
  }),

  createEvaluationScenario({
    id: 'stk-03-database-sql-governance',
    name: 'Universal SQL & Relational Database Governance',
    category: SCENARIO_CATEGORIES.STACKS,
    agent: 'database-engineer',
    initial_phase: 'EXECUTE',
    goal: 'Ensure SQL migrations and queries are parameterized and governed',
    executeFn: async (session) => {
      session.registerTool({
        name: 'write',
        executor: async () => 'Migration created'
      });

      const migration = await session.executeTool('write', {
        path: 'migrations/001_create_accounts.sql',
        content: 'CREATE TABLE accounts (id SERIAL PRIMARY KEY, balance NUMERIC);'
      });

      return { migrationCreated: Boolean(migration) };
    },
    assertions: [
      function assertSqlStackGoverned(ctx) {
        if (!ctx.output?.migrationCreated) {
          throw new Error('SQL migration creation was not governed');
        }
        return true;
      }
    ]
  }),

  createEvaluationScenario({
    id: 'stk-04-python-pytest-governance',
    name: 'Python & Pytest Stack Governance',
    category: SCENARIO_CATEGORIES.STACKS,
    agent: 'backend-engineer',
    initial_phase: 'EXECUTE',
    goal: 'Govern Python source writing and pytest verification',
    executeFn: async (session) => {
      session.registerTool({ name: 'write', executor: async () => 'python module created' });
      session.registerTool({ name: 'run_command', executor: async () => 'tests passed' });

      const writePy = await session.executeTool('write', { path: 'src/service.py' });
      session.transition('VERIFY');
      const testPy = await session.executeTool('run_command', { cmd: 'pytest tests/' });

      return { written: Boolean(writePy), tested: Boolean(testPy) };
    },
    assertions: [
      function assertPythonStackGoverned(ctx) {
        if (!ctx.output?.written || !ctx.output?.tested) {
          throw new Error('Python stack workflow incomplete');
        }
        return true;
      }
    ]
  }),

  createEvaluationScenario({
    id: 'stk-05-go-stack-governance',
    name: 'Go / Golang Stack Governance',
    category: SCENARIO_CATEGORIES.STACKS,
    agent: 'backend-engineer',
    initial_phase: 'EXECUTE',
    goal: 'Govern Go package writing and go test verification',
    executeFn: async (session) => {
      session.registerTool({ name: 'write', executor: async () => 'go package created' });
      session.registerTool({ name: 'run_command', executor: async () => 'go test passed' });

      const writeGo = await session.executeTool('write', { path: 'pkg/server/server.go' });
      session.transition('VERIFY');
      const testGo = await session.executeTool('run_command', { cmd: 'go test ./...' });

      return { written: Boolean(writeGo), tested: Boolean(testGo) };
    },
    assertions: [
      function assertGoStackGoverned(ctx) {
        if (!ctx.output?.written || !ctx.output?.tested) {
          throw new Error('Go stack workflow incomplete');
        }
        return true;
      }
    ]
  })
];
