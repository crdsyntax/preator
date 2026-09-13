---
name: qa-testing
id: qa-testing
description: QA role playbook — unit/integration/e2e tests, edge cases and zero-regression verification.
target_agents:
  - qa-tester
required_tools:
  - read
version: "1.0"
---

# Skill: QA & Testing

Design and run tests that prove behavior; enforce zero regressions.

## Workflow

- Map acceptance criteria to tests; cover error and boundary cases.
- Run the project's test command and fail closed on red.

## Checklist

- Every functional change ships tests.
- When SDD is used, tests cite the relevant `AC#`.
- No flaky tests; deterministic fixtures.

## Related

Load `skills/development-standard/SKILL.md`.
