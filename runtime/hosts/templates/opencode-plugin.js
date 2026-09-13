import path from "node:path";
import { pathToFileURL } from "node:url";

const PRAETOR_RUNTIME_ROOT = "{{PRAETOR_RUNTIME_ROOT}}";

let corePromise = null;

function loadCore() {
  if (!corePromise) {
    corePromise = import(
      pathToFileURL(path.join(PRAETOR_RUNTIME_ROOT, "runtime/hosts/opencode-plugin-core.js")).href
    );
  }
  return corePromise;
}

function formatModel(model) {
  if (!model) return null;
  if (typeof model === "string") return model;
  if (typeof model === "object") {
    if (model.providerID && model.modelID) return `${model.providerID}/${model.modelID}`;
    if (model.provider && model.model) return `${model.provider}/${model.model}`;
    if (model.modelID) return String(model.modelID);
    if (model.id) return String(model.id);
    if (model.name) return String(model.name);
  }
  return null;
}

export const PraetorPlugin = async ({ directory }) => {
  const { evaluateOpencodeTool, recordOpencodeLlmUsage } = await loadCore();
  const cwd = directory || process.cwd();
  const sessionModels = new Map();

  return {
    "chat.message": async (input) => {
      if (input && input.sessionID) {
        sessionModels.set(input.sessionID, formatModel(input.model));
      }
    },

    "tool.execute.before": async (input, output) => {
      const decision = evaluateOpencodeTool(input.tool, output.args || {}, {
        cwd,
        sessionId: input.sessionID || ""
      });

      if (decision.decision !== "allow") {
        throw new Error(
          `[Praetor] ${String(decision.decision).toUpperCase()} (${decision.code || "POLICY"}): ${decision.reason || "blocked by governance"}`
        );
      }
    },

    event: async ({ event }) => {
      if (!event || event.type !== "message.updated") return;
      const props = event.properties || {};
      const info = props.info || {};
      const parts = Array.isArray(info.parts) ? info.parts : [];

      let input = 0;
      let output = 0;
      let reasoning = 0;
      let cacheRead = 0;
      let cacheWrite = 0;
      let cost = 0;

      for (const part of parts) {
        const tokens = (part && part.tokens) || {};
        input += Number(tokens.input ?? 0);
        output += Number(tokens.output ?? 0);
        reasoning += Number(tokens.reasoning ?? 0);
        const cache = (tokens.cache && typeof tokens.cache === "object") ? tokens.cache : {};
        cacheRead += Number(cache.read ?? 0);
        cacheWrite += Number(cache.write ?? 0);
        cost += Number(part && part.cost ? part.cost : 0);
      }

      const sessionId = props.sessionID || info.sessionID || "";
      const model = formatModel(props.model) || sessionModels.get(sessionId) || null;
      if (input + output + reasoning + cost <= 0) return;

      recordOpencodeLlmUsage(
        sessionId,
        {
          model,
          inputTokens: input,
          outputTokens: output,
          reasoningTokens: reasoning,
          cacheReadTokens: cacheRead,
          cacheWriteTokens: cacheWrite
        },
        { cwd, costUsd: cost > 0 ? cost : null }
      );
    }
  };
};

export default PraetorPlugin;
