# AI Instructions - Governed Agent Runtime Framework

Always load:
- agents/core/engineering.md
- agents/core/security.md

Root Orchestrator:
- agents/orchestrator.md

Specialists:
- agents/backend/engineer.md
- agents/frontend/engineer.md
- agents/database/engineer.md
- agents/qa/tester.md
- agents/reviews/review.md
- agents/security/devops.md

Process:
1 Analyze
2 Plan
3 List files
4 Wait approval
5 One change
6 Stop

Zero `any` tolerance.
Use `bun` for package management and testing.
Mandatory pre-commit checks:
- `bun run test` (Audit, Architectural Conformance ARCH-01..10, and Evaluation 35/35)
- `bun run agents:enforce`
