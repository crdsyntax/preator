---
name: orchestration
id: orchestration
description: Root orchestrator playbook — lifecycle governance, specialist routing and delegation contracts.
target_agents:
  - orchestrator
required_tools:
  - read
version: "1.0"
---

# Skill: Orchestration

Drive the 8-phase lifecycle and delegate to specialists; the orchestrator never implements directly.

## Workflow

1. **ANALYZE** — read `AGENTS.md`, `runtime.config.json`, `specs/` and the repository structure.
2. **PLAN** — produce the plan and select specialists from the routing directory.
3. **REVIEW** — require approval before `EXECUTE`; run `praetor arch check` when architecture is involved.
4. **EXECUTE / VERIFY / DOCUMENT** — delegate with a bounded scope and merge results into root context.

## Checklist

- Single-root delegation tree; specialists never delegate among themselves.
- Depth ≤ 3, ≤ 3 iterations per delegation, ≤ 4 concurrent delegations.
- Every delegation declares objective, phase, applicable policies, reference paths and budget.

## Output

Current Phase · Analysis · Delegation/Action · Evidence · Next Phase Gate.
