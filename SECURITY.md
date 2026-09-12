# Security Policy

## Reporting a vulnerability

Report suspected vulnerabilities privately to the maintainers (open a GitHub Security Advisory). Do not open public issues for security problems. Include a description, reproduction steps, affected version and impact.

## Threat model

Praetor sits between an AI agent (which *proposes* actions) and the host (IDE/agent) that *executes* them. The runtime is the only authority that authorizes tool execution.

Trust boundaries:
- **Untrusted:** model output, tool arguments, host payloads, `events.jsonl`/`state.json` on disk (assumed mutable by an attacker with filesystem access).
- **Trusted:** the seal key, the approval actor identity, the runtime `Gateway` and `PolicyEngine`.

In scope: unauthorized tool execution, phase/write-gate bypass, path escape, credential access, tampered state/event logs, approval forgery or replay.
Out of scope: a fully compromised host with the seal key and arbitrary code execution, and prompt-injection that stays within authorized tools.

## State sealing & key management

- `state.json` is sealed with HMAC-SHA256 when a key is available; otherwise it falls back to legacy unkeyed SHA-256 (v1) for compatibility. **Production deployments must set a key** so tamper resistance is real.
- Key resolution order: `PRAETOR_STATE_SECRET` environment variable, then `.agent/state.key` (created with mode `0600`).
- The key must be available to every process that reads state: the host hook, the CLI and the MCP server.
- **Back up the key.** Losing it makes existing v2 sessions unverifiable (fail-closed). Rotating the key invalidates prior seals; re-seal with `praetor migrate` after rotation.
- Never commit the key. `.agent/` is gitignored by default.

## Tamper-evident event log

Each event records `seq`, `prev_hash` and `event_hash`, chaining HMACs. Deleting, reordering or editing chained events breaks verification and fails closed. Legacy (pre-0.3.0) logs are not retroactively chained; `praetor migrate` re-seals state and the chain continues from new events.

## Human-in-the-loop approvals

- Approvals are bound to the exact `request_id` and canonical argument hash of the pending action, are single-use, and expire (default 15 minutes).
- `resolved_by` (the approving actor) is **mandatory**; anonymous approvals are rejected.
- The approval endpoint (CLI/MCP) is security-critical: when exposed remotely, it must be authenticated and access-controlled. The default `mcp-client` actor is a placeholder, not an identity guarantee.
- `context.hasApproval` is deprecated and ignored.

## Migration

```bash
export PRAETOR_STATE_SECRET="<your-secret>"
praetor doctor            # inspect config, key, session integrity
praetor migrate --dry-run # preview
praetor migrate           # re-seal v1 sessions, quarantine invalid ones
```

Invalid sessions are moved to `.agent/quarantine/` rather than silently reset.

## Enforcement model per host

| Host | Mechanism | Strength |
|---|---|---|
| Antigravity | `PreToolUse` hook (stdin/stdout) | Hard: intercepts every native tool call |
| OpenCode / Claude / Codex | MCP tool server | Soft: agent must delegate through Praetor |

MCP governance is opt-in; a misbehaving agent can bypass it by using its own tools. For hard enforcement, prefer hosts that support a pre-tool hook, or combine MCP with host-side allowlisting.
