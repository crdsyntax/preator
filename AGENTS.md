# AI Instructions - Governed Agent Runtime Framework

Always load:
- agents/core/engineering.md
- agents/core/security.md
- skills/code-conventions/SKILL.md

Root Orchestrator:
- agents/orchestrator.md

Specialists:
- agents/backend/engineer.md
- agents/frontend/engineer.md
- agents/database/engineer.md
- agents/qa/tester.md
- agents/reviews/review.md
- agents/security/devops.md
- agents/architecture/architect.md

Process:
1 Analyze
2 Plan
3 List files
4 Wait approval
5 One change
6 Stop

Zero `any` tolerance.
Use `bun` for package management and testing.

Versioning:
- Patch-only progression until 1.0.0. Increment the last numeric field on every release.
- Carry on overflow: 0.9.99 -> 0.10.0, ..., 0.99.99 -> 1.0.0.
- Apply the same version to: package.json, runtime/index.js, runtime/transports/mcp.js, README (title + badge), scripts/audit-agent-runtime.js; add a CHANGELOG entry.

Mandatory pre-commit checks:
- `bun run test` (Audit, Architectural Conformance ARCH-01..10, and Evaluation 35/35)
- `bun run agents:enforce`
