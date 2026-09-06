---
name: database-sql
id: database-sql
description: Universal procedures for database schema design, migrations, query optimization, and dialect handling.
target_agents:
  - database-engineer
  - backend-engineer
required_tools:
  - read
version: "1.0"
---

# Skill: Database & SQL Governance

This skill guides agents in writing secure, portable, and performant SQL across database engines (PostgreSQL, MySQL, SQLite, Oracle).

## Core Principles

1. **Query Parameterization:**
   - NEVER interpolate raw string arguments into SQL queries.
   - Always use prepared statements with parameter placeholders (`$1`, `?`, `:name`).

2. **Index Optimization:**
   - Inspect query plans using `EXPLAIN ANALYZE` or `EXPLAIN`.
   - Index high-cardinality search columns, foreign keys, and filter predicates.

3. **Reversible Migrations:**
   - Every schema change must include both an `UP` (apply) and `DOWN` (rollback) path.
   - Ensure table constraints and indexes are created safely.
