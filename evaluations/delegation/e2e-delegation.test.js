import assert from "node:assert";
import { createTask, executeTask, getTask } from "../../protocol/index.js";
import { createSession } from "../../runtime/session.js";

async function runE2EDelegationTest() {
  console.log("\x1b[1m\x1b[36m=== Testing End-to-End Autonomous Delegation (§E2E-01) ===\x1b[0m\n");

  let childSessionInvoked = false;
  let childSessionAgentId = null;
  let toolExecutedSuccessfully = false;
  let unauthorizedDelegationBlocked = false;

  const task = createTask({
    goal: "Analizar y optimizar endpoint backend de productos"
  });

  assert.strictEqual(task.status, "created");
  assert.strictEqual(task.phase, "REQUEST");
  console.log("  ✔ Task created in initial REQUEST phase");

  const result = await executeTask(task.taskId, {
    childExecutorFn: async (childSession) => {
      childSessionInvoked = true;
      childSessionAgentId = childSession.agentId;

      assert.strictEqual(childSession.agentDefinition.identity.id, "backend-engineer");
      assert.strictEqual(childSession.agentDefinition.identity.role, "specialist");
      assert.strictEqual(childSession.agentDefinition.identity.type, "subagent");

      childSession.registerTool({
        name: "view_file",
        isWrite: false,
        executor: async (args) => {
          return { content: "mock product endpoint code", path: args.AbsolutePath };
        }
      });

      const readOutput = await childSession.executeTool("view_file", {
        AbsolutePath: "src/products.rs"
      });
      if (readOutput && readOutput.content) {
        toolExecutedSuccessfully = true;
      }

      const invalidDelegation = await childSession.delegate({
        childAgentId: "frontend-engineer",
        task: { description: "Attempt illegal specialist-to-specialist delegation" }
      });

      if ((invalidDelegation.status === "DENIED" || invalidDelegation.status === "denied") && invalidDelegation.error?.code === "UNAUTHORIZED_DELEGATION_DENIED") {
        unauthorizedDelegationBlocked = true;
      }

      return {
        specialist: "backend-engineer",
        readOutput,
        summary: "Analysis of products endpoint completed"
      };
    }
  });

  assert.strictEqual(childSessionInvoked, true);
  console.log("  ✔ Orchestrator routed task and invoked specialist child session");

  assert.strictEqual(childSessionAgentId, "backend-engineer");
  console.log("  ✔ Specialist correctly resolved to 'backend-engineer'");

  assert.strictEqual(toolExecutedSuccessfully, true);
  console.log("  ✔ Specialist executed authorized tool through Execution Gateway");

  assert.strictEqual(unauthorizedDelegationBlocked, true);
  console.log("  ✔ Specialist prohibited from delegating to another specialist (ARCH-07)");

  assert.strictEqual(result.status, "completed");
  assert.strictEqual(result.phase, "COMPLETE");
  assert.ok(result.audit_seal, "Result must contain cryptographic audit seal");
  console.log("  ✔ Task reached COMPLETE phase with sealed cryptographic state");

  const finalRecord = getTask(task.taskId);
  assert.strictEqual(finalRecord.status, "completed");
  assert.strictEqual(finalRecord.phase, "COMPLETE");
  console.log("  ✔ Final task record verified in registry");

  console.log("\n\x1b[32m=== All End-to-End Delegation Tests Passed (100% Verified) ===\x1b[0m\n");
}

runE2EDelegationTest().catch(err => {
  console.error("E2E Delegation Test Failed:", err);
  process.exit(1);
});
