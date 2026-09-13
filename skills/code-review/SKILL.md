---
name: code-review
id: code-review
description: Code review role playbook — diff inspection, architecture compliance, security and maintainability.
target_agents:
  - code-reviewer
required_tools:
  - read
version: "1.0"
---

# Skill: Code Review

Review diffs for correctness, architecture compliance, security and maintainability.

## Workflow

- Verify layer direction and contracts (interfaces over concrete types).
- Check enum usage for closed domains, error handling, and absence of secrets.
- Run `praetor arch check` and require a green gate before approving.

## Checklist

- No `any`, no `console.*`, no comments in production code.
- Changes are scoped; tests accompany functional changes.
- Security invariants respected (no secret leakage, no destructive ops).

## Related

Load `skills/code-conventions/SKILL.md` and `skills/development-standard/SKILL.md`.
