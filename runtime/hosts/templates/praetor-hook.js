#!/usr/bin/env bun

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function failClosed(reason, code = "HOOK_FAIL_CLOSED") {
  const payload = {
    decision: "deny",
    code,
    reason: String(reason)
  };
  process.stdout.write(JSON.stringify(payload) + "\n");
}

async function resolvePraetorAdapter() {
  try {
    const pkg = await import("praetor/hosts");
    if (pkg && pkg.AntigravityHostAdapter) {
      return pkg.AntigravityHostAdapter;
    }
  } catch {}

  const envHome = process.env.PRAETOR_HOME || process.env.PRAETOR_PATH;
  if (envHome) {
    const candidate = path.join(envHome, "runtime", "hosts", "antigravity.js");
    if (fs.existsSync(candidate)) {
      const mod = await import(pathToFileURL(candidate).href);
      if (mod && mod.AntigravityHostAdapter) {
        return mod.AntigravityHostAdapter;
      }
    }
  }

  const embeddedPath = "{{PRAETOR_RUNTIME_PATH}}";
  if (embeddedPath && !embeddedPath.startsWith("{{") && fs.existsSync(embeddedPath)) {
    const mod = await import(pathToFileURL(embeddedPath).href);
    if (mod && mod.AntigravityHostAdapter) {
      return mod.AntigravityHostAdapter;
    }
  }

  throw new Error("Unable to resolve Praetor runtime. Ensure 'praetor' is installed or PRAETOR_HOME is set.");
}

async function run() {
  let rawStdin = "";
  try {
    for await (const chunk of process.stdin) {
      rawStdin += chunk;
    }
  } catch (err) {
    failClosed(`Failed to read stdin: ${err.message}`);
    return;
  }

  if (!rawStdin.trim()) {
    failClosed("Empty stdin payload received from Antigravity");
    return;
  }

  let payload;
  try {
    payload = JSON.parse(rawStdin);
  } catch (err) {
    failClosed(`Invalid JSON on stdin: ${err.message}`);
    return;
  }

  try {
    const Adapter = await resolvePraetorAdapter();
    const decision = Adapter.evaluatePayload(payload, { cwd: process.cwd() });
    process.stdout.write(JSON.stringify(decision) + "\n");
  } catch (err) {
    failClosed(`Praetor Host Adapter error: ${err.message}`);
  }
}

run().catch(err => {
  failClosed(`Fatal hook error: ${err.message}`);
});
