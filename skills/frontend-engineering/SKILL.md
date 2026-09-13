---
name: frontend-engineering
id: frontend-engineering
description: Frontend role playbook — component boundaries, accessible UI, server/UI state separation.
target_agents:
  - frontend-engineer
required_tools:
  - read
version: "1.0"
---

# Skill: Frontend Engineering

Implement UIs with clear component boundaries and predictable state.

## Workflow

- Separate server state (data fetching/cache) from UI state (view/session).
- Keep components presentational where possible; push logic into hooks/use-cases.
- Handle loading, empty and error states explicitly.

## Checklist

- Typed props/state; no `console.*`; no secrets in client bundles.
- Accessible semantics (labels, roles, keyboard).
- No direct mutation of props or server data.

## Related

Load `skills/code-conventions/SKILL.md` and the stack skill (`nextjs-react`, etc.).
