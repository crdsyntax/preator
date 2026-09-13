---
name: engineering-standards
id: engineering-standards
description: Core engineering role playbook — decoupling, type safety, fail-closed design and determinism.
target_agents:
  - core-engineering
required_tools:
  - read
version: "1.0"
---

# Skill: Engineering Standards

Define and enforce cross-stack engineering standards.

## Workflow

- Apply strict decoupling, explicit type safety and fail-closed design.
- Prefer deterministic, idempotent operations and atomic changes.

## Checklist

- Zero `any`; interfaces for all contracts.
- No silent failures; errors handled or rethrown with context.
- Changes verified by automated tests before completion.

## Related

Load `skills/code-conventions/SKILL.md` and `skills/development-standard/SKILL.md`.
