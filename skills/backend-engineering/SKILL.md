---
name: backend-engineering
id: backend-engineering
description: Backend role playbook — services, APIs, jobs and data flows with explicit errors and boundary validation.
target_agents:
  - backend-engineer
required_tools:
  - read
version: "1.0"
---

# Skill: Backend Engineering

Implement performant, type-safe backend logic across any stack (Rust, Go, Python, Node/TS, Java).

## Workflow

- Keep layer separation (transport → service → repository); program against interfaces.
- Validate all external input at the boundary and map it to internal DTOs before business logic.
- Use idiomatic, explicit error handling (`Result`, typed exceptions); never swallow errors.

## Checklist

- No business logic in transport/adapters.
- Idempotent, retry-safe operations where applicable.
- Concurrency-safe state; no shared mutable state without synchronization.

## Related

Load `skills/code-conventions/SKILL.md` and the relevant stack skill (e.g. `rust-cargo`, `nextjs-react`).
