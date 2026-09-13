---
name: architecture
id: architecture
description: Architecture role playbook — select and enforce design patterns and record ADRs.
target_agents:
  - architect
required_tools:
  - read
version: "1.0"
---

# Skill: Architecture

Select the design pattern, declare it as a profile, and enforce it.

## Workflow

- Choose the pattern (Screaming/Clean, Hexagonal, Layered) and record an ADR in `docs/adr/`.
- Declare `standards/<profile>.json` (feature root, layers, dependency rules, quality rules).
- Produce the skeleton (feature folders, contracts, value objects) and validate.

## Checklist

- Domain must not depend on application/infrastructure.
- Ports (interfaces) separated from implementations; no name collisions.
- `praetor arch check` passes before REVIEW.

## Related

Load `skills/development-standard/SKILL.md` (+ its `references/architecture-patterns.md`) and `skills/code-conventions/SKILL.md`.
