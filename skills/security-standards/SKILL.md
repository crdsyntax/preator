---
name: security-standards
id: security-standards
description: Core security role playbook — secret protection, untrusted input, destructive-op denial.
target_agents:
  - core-security
required_tools:
  - read
version: "1.0"
---

# Skill: Security Standards

Maintain the hard security invariants across the workspace.

## Workflow

- Treat all external data as untrusted; validate and sanitize at boundaries.
- Protect secrets; deny destructive and forced operations.

## Checklist

- No secrets in code, logs or commits.
- No `rm -rf`/force-push/credential exfiltration beyond policy.
- Fail closed on ambiguity.

## Related

Load `skills/code-conventions/SKILL.md`.
