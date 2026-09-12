import assert from "node:assert";
import { createTask, executeTask, getTask } from "../../protocol/index.js";

async function runAutonomousExecutionTest() {
  console.log("\x1b[1m\x1b[36m=== Testing Autonomous Visual Task Execution (§AUTON-01) ===\x1b[0m\n");

  const visualGoal = "busca y detecta los errores visuales de la aplicación y haz una lista";
  const task = createTask({ goal: visualGoal });

  assert.strictEqual(task.status, "created");
  assert.strictEqual(task.phase, "REQUEST");
  console.log("  ✔ Visual task created in REQUEST phase");

  let specialistResolved = null;
  let toolsCalledBySpecialist = [];

  const result = await executeTask(task.taskId, {
    childExecutorFn: async (childSession) => {
      specialistResolved = childSession.agentId;

      assert.strictEqual(childSession.agentDefinition.identity.id, "frontend-engineer");
      assert.strictEqual(childSession.agentDefinition.identity.role, "specialist");

      childSession.registerTool({
        name: "view_file",
        isWrite: false,
        executor: async (args) => {
          return {
            path: args.AbsolutePath,
            content: "<div style='color: red; padding: 0;'>Broken Layout</div>"
          };
        }
      });

      const inspectedUI = await childSession.executeTool("view_file", {
        AbsolutePath: "src/components/Header.tsx"
      });

      toolsCalledBySpecialist.push({
        tool: "view_file",
        output: inspectedUI
      });

      return {
        specialist: "frontend-engineer",
        findings: [
          "Header.tsx: Redundant zero-padding causing overlap with navbar",
          "Missing responsive container breakpoint for mobile viewport"
        ],
        toolsCalled: toolsCalledBySpecialist.length
      };
    }
  });

  assert.strictEqual(specialistResolved, "frontend-engineer");
  console.log("  ✔ Visual/UI task correctly routed to 'frontend-engineer' (not backend-engineer)");

  assert.strictEqual(toolsCalledBySpecialist.length, 1);
  console.log("  ✔ Frontend engineer executed inspection tool through Execution Gateway");

  assert.strictEqual(result.status, "completed");
  assert.strictEqual(result.phase, "COMPLETE");
  assert.strictEqual(result.specialist, "frontend-engineer");
  assert.ok(result.audit_seal, "Sealed cryptographic state hash present");
  console.log("  ✔ Autonomous task verified, documented, and completed with audit seal");

  const taskRecord = getTask(task.taskId);
  assert.strictEqual(taskRecord.status, "completed");
  assert.strictEqual(taskRecord.phase, "COMPLETE");
  const multiSpecialistGoal = "Analiza este sistema y determina qué especialistas necesitas. Si encuentras problemas de frontend y base de datos, divide el trabajo y consolida los resultados.";
  const multiTask = createTask({ goal: multiSpecialistGoal });
  const multiResult = await executeTask(multiTask.taskId);

  assert.strictEqual(multiResult.status, "completed");
  assert.strictEqual(multiResult.phase, "COMPLETE");
  assert.ok(Array.isArray(multiResult.specialists), "Specialists list present in result");
  assert.ok(multiResult.specialists.includes("frontend-engineer"), "Frontend engineer included in multi-specialist delegation");
  assert.ok(multiResult.specialists.includes("database-engineer"), "Database engineer included in multi-specialist delegation");
  assert.strictEqual(multiResult.delegations.length, 2, "Two distinct specialist sub-sessions delegated");
  assert.ok(multiResult.report.includes("frontend-engineer"), "Consolidated report includes frontend specialist section");
  assert.ok(multiResult.report.includes("database-engineer"), "Consolidated report includes database specialist section");
  console.log("  ✔ Multi-specialist task autonomously delegated to both frontend and database specialists");
  console.log("  ✔ Consolidated governance report successfully generated and verified");

  console.log("\n\x1b[32m=== Autonomous Visual Task Execution Verified (100% Passed) ===\x1b[0m\n");
}

runAutonomousExecutionTest().catch(err => {
  console.error("Autonomous Execution Test Failed:", err);
  process.exit(1);
});
