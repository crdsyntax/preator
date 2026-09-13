import assert from "node:assert";
import { createTask, executeTask, getTask } from "../../protocol/index.js";
import { createSession } from "../../runtime/session.js";
import { OrchestratorEngine, createDelegationRequest } from "../../runtime/core/index.js";

async function runRevocationTest() {
  console.log("\x1b[1m\x1b[36m=== Testing Supervised Delegation Revocation (§REV-01) ===\x1b[0m\n");

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

  assert.strictEqual(result.status, "needs_correction", "Unresolved specialist failure blocks completion");
  console.log("  ✔ Task does NOT claim completion after an unresolved specialist failure");

  assert.ok(Array.isArray(result.revocations), "Result exposes revocations list");
  assert.strictEqual(result.revocations.length, 1, "Exactly one delegation revoked");
  assert.strictEqual(result.revocations[0].revoked_from, "backend-engineer", "Revoked from the failing specialist");
  assert.strictEqual(result.revocations[0].revoked_to, "orchestrator", "Revoked to the nearest superior (orchestrator)");
  console.log("  ✔ Task revoked from 'backend-engineer' and re-assigned to 'orchestrator'");

  assert.ok(Array.isArray(result.alerts) && result.alerts.length >= 1, "The user is alerted that the agent did not complete");
  assert.strictEqual(result.alerts[0].child_agent_id, "backend-engineer");
  console.log("  ✔ User alert emitted for the incomplete task");

  const finalRecord = getTask(task.taskId);
  assert.strictEqual(finalRecord.status, "needs_correction");
  console.log("  ✔ Final task record persisted as needs_correction");

  console.log("\n[Test] Verifying direct OrchestratorEngine revocation (REV-02)...");
  const orch = new OrchestratorEngine({ maxDepth: 3, maxCorrections: 0 });
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
    async () => { throw new Error("boom"); },
    (childOptions) => createSession({ ...childOptions, initialPhase: "REQUEST" })
  );

  assert.strictEqual(failedResult.status, "REVOKED", "Delegation status is REVOKED on failure");
  assert.strictEqual(failedResult.revoked_from, "backend-engineer", "revoked_from is the failing child");
  assert.strictEqual(failedResult.revoked_to, "orchestrator", "revoked_to is the nearest superior");
  assert.strictEqual(failedResult.needs_correction, true, "Result is flagged as needing correction");
  console.log("  ✔ OrchestratorEngine marks failed delegation REVOKED and targets nearest superior");

  const reassignedOwnership = Array.from(orch.taskOwnerships.values())
    .find(o => o.status === "ASSIGNED" && o.owner_agent_id === "orchestrator");
  assert.ok(reassignedOwnership, "Re-assigned task ownership exists");
  console.log("  ✔ Task ownership transferred to nearest superior");

  console.log("\n[Test] Verifying escalation to a superior resolves the task (REV-03)...");
  const orch3 = new OrchestratorEngine({ maxDepth: 3, maxCorrections: 0 });
  orch3.registerAgent({ identity: { id: "orchestrator", role: "root" } });
  orch3.registerAgent({ identity: { id: "backend-engineer", role: "specialist" } });
  const req3 = createDelegationRequest({
    parentRunId: "run-root-3",
    parentAgentId: "orchestrator",
    childAgentId: "backend-engineer",
    task: { description: "Implement schema" },
    depth: 1
  });

  const escalated = await orch3.delegate(
    req3,
    async () => { throw new Error("specialist failed"); },
    null,
    {
      maxCorrections: 0,
      escalationExecutorFn: async (superior) => ({ resolved_by: superior, ok: true })
    }
  );
  assert.strictEqual(escalated.status, "COMPLETED", "Escalation resolves the task");
  assert.strictEqual(escalated.resolved_by, "orchestrator", "Resolved by the superior");
  assert.strictEqual(escalated.revoked_from, "backend-engineer");
  console.log("  ✔ Superior resolved the escalated task");

  console.log("\n\x1b[32m=== Supervised Delegation Revocation Tests Passed (100% Verified) ===\x1b[0m\n");
}

runRevocationTest().catch(err => {
  console.error("Revocation Test Failed:", err);
  process.exit(1);
});
