import assert from "node:assert";
import { createTask, executeTask, getTask } from "../../protocol/index.js";
import { createSession } from "../../runtime/session.js";
import { OrchestratorEngine, createDelegationRequest } from "../../runtime/core/index.js";

async function runRevocationTest() {
  console.log("\x1b[1m\x1b[36m=== Testing Delegation Revocation to Nearest Superior (§REV-01) ===\x1b[0m\n");

  const task = createTask({
    goal: "Analizar y optimizar endpoint backend de productos"
  });
  assert.strictEqual(task.status, "created");
  assert.strictEqual(task.phase, "REQUEST");
  console.log("  ✔ Task created in initial REQUEST phase");

  const result = await executeTask(task.taskId, {
    childExecutorFn: async () => {
      const err = new Error("Specialist crashed while executing subtask");
      err.code = "EXECUTION_FAILED";
      throw err;
    }
  });

  assert.strictEqual(result.status, "completed", "Task completes despite specialist failure");
  console.log("  ✔ Task reached COMPLETE phase (not failed) after specialist failure");

  assert.ok(Array.isArray(result.revocations), "Result exposes revocations list");
  assert.strictEqual(result.revocations.length, 1, "Exactly one delegation revoked");
  console.log("  ✔ One sub-task was revoked after specialist failure");

  assert.strictEqual(result.revocations[0].revoked_from, "backend-engineer", "Revoked from the failing specialist");
  assert.strictEqual(result.revocations[0].revoked_to, "orchestrator", "Revoked to the nearest superior (orchestrator)");
  console.log("  ✔ Task revoked from 'backend-engineer' and re-assigned to 'orchestrator'");

  assert.ok(result.report.includes("revocadas"), "Consolidated report notes revoked tasks");
  assert.ok(result.report.includes("orchestrator"), "Consolidated report names the re-assignment superior");
  console.log("  ✔ Consolidated report documents the revocation and re-assignment");

  const finalRecord = getTask(task.taskId);
  assert.strictEqual(finalRecord.status, "completed");
  assert.strictEqual(finalRecord.phase, "COMPLETE");
  console.log("  ✔ Final task record persisted as completed in registry");

  console.log("\n[Test] Verifying direct OrchestratorEngine revocation (REV-02)...");
  const orch = new OrchestratorEngine({ maxDepth: 3 });
  orch.registerAgent({ identity: { id: "orchestrator", role: "root" } });
  orch.registerAgent({ identity: { id: "backend-engineer", role: "specialist" } });

  const req = createDelegationRequest({
    parentRunId: "run-root",
    parentAgentId: "orchestrator",
    childAgentId: "backend-engineer",
    task: { description: "Implement schema" },
    depth: 1
  });

  const failedResult = await orch.delegate(
    req,
    async () => {
      throw new Error("boom");
    },
    (childOptions) => createSession({
      ...childOptions,
      initialPhase: "REQUEST"
    })
  );

  assert.strictEqual(failedResult.status, "REVOKED", "Delegation status is REVOKED on failure");
  assert.strictEqual(failedResult.revoked_from, "backend-engineer", "revoked_from is the failing child");
  assert.strictEqual(failedResult.revoked_to, "orchestrator", "revoked_to is the nearest superior");
  console.log("  ✔ OrchestratorEngine marks failed delegation REVOKED and targets nearest superior");

  const reassignedOwnership = Array.from(orch.taskOwnerships.values())
    .find(o => o.status === "ASSIGNED" && o.owner_agent_id === "orchestrator");
  assert.ok(reassignedOwnership, "Re-assigned task ownership exists");
  assert.strictEqual(reassignedOwnership.owner_agent_id, "orchestrator", "Ownership transferred to nearest superior");
  console.log("  ✔ Task ownership transferred to nearest superior");

  console.log("\n\x1b[32m=== Delegation Revocation Tests Passed (100% Verified) ===\x1b[0m\n");
}

runRevocationTest().catch(err => {
  console.error("Revocation Test Failed:", err);
  process.exit(1);
});