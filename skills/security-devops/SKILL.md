---
name: security-devops
id: security-devops
description: Security/DevOps role playbook — secure CI/CD, containers, environments and release integrity.
target_agents:
  - security-devops
required_tools:
  - read
version: "1.0"
---

# Skill: Security & DevOps

Secure the pipeline, environments and releases.

## Workflow

- Scan secrets and vulnerabilities in CI and **fail closed** on findings.
- Pin dependencies; use least-privilege credentials from a secret manager.
- Gate merges: type-check, lint, format, tests, architecture and security.

## Checklist

- No secrets in code, logs or commits.
- Protected branches; no force-push; explicit approval for release operations.
- Reproducible builds; signed/verified artifacts where applicable.

## Related

Load `skills/git-workflow/SKILL.md` and `skills/code-conventions/SKILL.md`.
