import assert from "node:assert";
import { OrchestratorEngine, createDelegationRequest } from "../../runtime/core/index.js";

let passed = 0;
let total = 0;

async function test(name, fn) {
  total++;
  try {
    await fn();
    passed++;
    console.log(`  \u2714 [${name}] PASS`);
  } catch (err) {
    console.error(`  \u2718 [${name}] FAIL: ${err.message}`);
    throw err;
  }
}

function buildOrch(maxCorrections) {
  const orch = new OrchestratorEngine({ maxDepth: 3, maxCorrections });
  orch.registerAgent({ identity: { id: "orchestrator", role: "root" } });
  orch.registerAgent({ identity: { id: "backend-engineer", role: "specialist" } });
  return orch;
}

function buildRequest(suffix = "") {
  return createDelegationRequest({
    parentRunId: `run-root${suffix}`,
    parentAgentId: "orchestrator",
    childAgentId: "backend-engineer",
    task: { description: `Subtask ${suffix}` },
    depth: 1
  });
}

const verifyOk = (output) => ({
  valid: Boolean(output && output.ok === true),
  reason: "output did not satisfy the task contract"
});

console.log("=== Praetor Supervised Delegation Suite (SUP-01 .. SUP-03) ===\n");

await test("SUP-01: an incomplete output triggers a user alert and hot correction", async () => {
  const orch = buildOrch(1);
  const alerts = [];
  let calls = 0;

  const result = await orch.delegate(
    buildRequest("-sup1"),
    async () => {
      calls++;
      return calls === 1 ? { ok: false, artifacts: [] } : { ok: true, artifacts: ["schema.sql"] };
    },
    null,
    { verify: verifyOk, onAlert: (a) => alerts.push(a) }
  );

  assert.strictEqual(result.status, "COMPLETED", JSON.stringify(result));
  assert.strictEqual(result.attempts, 2, "one correction attempt");
  assert.strictEqual(alerts.length, 1, "exactly one alert for the failed attempt");
  assert.strictEqual(alerts[0].code, "DELEGATION_INCOMPLETE");
});

await test("SUP-02: uncorrected incomplete output is escalated to the superior and resolved", async () => {
  const orch = buildOrch(0);
  const alerts = [];
  let escalatedTo = null;

  const result = await orch.delegate(
    buildRequest("-sup2"),
    async () => ({ ok: false }),
    null,
    {
      maxCorrections: 0,
      verify: verifyOk,
      onAlert: (a) => alerts.push(a),
      escalationExecutorFn: async (superior) => { escalatedTo = superior; return { ok: true, by: superior }; }
    }
  );

  assert.strictEqual(result.status, "COMPLETED", JSON.stringify(result));
  assert.strictEqual(escalatedTo, "orchestrator", "escalated to the nearest superior");
  assert.strictEqual(result.resolved_by, "orchestrator");
  assert.strictEqual(result.revoked_from, "backend-engineer");
  assert.strictEqual(result.revoked_to, "orchestrator");
  assert.ok(alerts.length >= 1, "the user was alerted before escalation");
});

await test("SUP-03: uncorrected and unresolved output is flagged needs_correction", async () => {
  const orch = buildOrch(1);
  const alerts = [];

  const result = await orch.delegate(
    buildRequest("-sup3"),
    async () => ({ ok: false }),
    null,
    { verify: verifyOk, onAlert: (a) => alerts.push(a) }
  );

  assert.strictEqual(result.status, "REVOKED", JSON.stringify(result));
  assert.strictEqual(result.needs_correction, true);
  assert.strictEqual(result.revoked_from, "backend-engineer");
  assert.strictEqual(result.revoked_to, "orchestrator");
  assert.strictEqual(result.escalated_to, "orchestrator");
  assert.ok(alerts.length >= 1);
});

console.log(`\n============================================================`);
console.log(`Supervised Delegation Results: ${passed} passed, 0 failed (out of ${total})`);
console.log(`============================================================\n`);
