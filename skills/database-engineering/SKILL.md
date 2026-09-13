---
name: database-engineering
id: database-engineering
description: Database role playbook — schema, queries, migrations, indexing and data integrity.
target_agents:
  - database-engineer
required_tools:
  - read
version: "1.0"
---

# Skill: Database Engineering

Design schemas, write safe queries and manage migrations.

## Workflow

- Numbered, idempotent migrations; review FK and index dependencies.
- Parameterized queries only; never concatenate user input into SQL.
- Plan rollback/backfill for destructive changes.

## Checklist

- Indexes match real access paths; no full scans on hot paths.
- Explicit transaction boundaries; consistent isolation level.
- Data integrity constraints (FK, unique, not-null) where applicable.

## Related

Load `skills/database-sql/SKILL.md` and `skills/code-conventions/SKILL.md`.
