import path from "node:path";
import { pathToFileURL } from "node:url";

const PRAETOR_RUNTIME_ROOT = "D:/Documents/GitHub/praetor";

let corePromise = null;

function loadCore() {
  if (!corePromise) {
    corePromise = import(
      pathToFileURL(path.join(PRAETOR_RUNTIME_ROOT, "runtime/hosts/opencode-plugin-core.js")).href
    );
  }
  return corePromise;
}

export const PraetorPlugin = async ({ directory }) => {
  const { evaluateOpencodeTool } = await loadCore();

  return {
    "tool.execute.before": async (input, output) => {
      const decision = evaluateOpencodeTool(input.tool, output.args || {}, {
        cwd: directory || process.cwd(),
        sessionId: input.sessionID || ""
      });

      if (decision.decision !== "allow") {
        throw new Error(
          `[Praetor] ${String(decision.decision).toUpperCase()} (${decision.code || "POLICY"}): ${decision.reason || "blocked by governance"}`
        );
      }
    }
  };
};

export default PraetorPlugin;
