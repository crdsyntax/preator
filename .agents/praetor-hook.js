#!/usr/bin/env bun

import path from "node:path";
import { pathToFileURL } from "node:url";

const praetorPath = process.env.PRAETOR_HOME || "D:/Documents/GitHub/praetor";

try {
  const { AntigravityHostAdapter } = await import(
    pathToFileURL(path.join(praetorPath, "runtime/hosts/antigravity.js")).href
  );
  await AntigravityHostAdapter.runCli();
} catch (err) {
  process.stdout.write(JSON.stringify({
    decision: "deny",
    code: "HOOK_FAIL_CLOSED",
    reason: `Praetor Antigravity hook error: ${err.message}`
  }) + "\n");
}
