---
name: code-conventions
id: code-conventions
description: Team coding conventions ported from the project's governing standard— layering, typing, naming, logging, secrets and commit rules.
target_agents:
  - orchestrator
  - backend-engineer
  - frontend-engineer
  - database-engineer
  - code-reviewer
  - core-engineering
required_tools:
  - read
version: "1.0"
---

# Skill: Team Code Conventions

Portable coding conventions derived from the project's governing standard. They apply across the governed workspace and are enforced (where possible) by lint/CI, not only by prompt.

## Code quality

1. **Zero `any`:** every variable, parameter, return value and property has an explicit type. Use `unknown` plus a type guard when the type is genuinely unknown. Untyped dicts / `interface{}` are forbidden.
2. **No `console.*` in production code.** Use the project logger or propagate errors with context.
3. **No silent failures:** empty `catch` blocks are forbidden. Handle, mitigate, or rethrow with context.
4. **Comments:** none in production code except to document the non-obvious **why** (business decisions, hacks, mitigations). Never explain the self-evident "what".
5. **Naming:** consistent and in English for identifiers; `camelCase`/`PascalCase` per language idiom; no abbreviations that hide intent.
6. **SOLID / DRY / KISS** by default; prefer small, single-responsibility modules.

## Secrets

- **No secrets in code, logs, or commits.** Configuration comes from environment variables and a config module; ship an `.env.example`, never real values.

## Layering & contracts

- Dependency direction is the real contract: **domain must never depend on application or infrastructure**. `application` may depend on domain; `infrastructure` implements ports.
- Distinguish **application service ports** (`CatalogService`), **domain repository ports** (`ProductRepository`) and **adapters** (`HttpClient`) by role; keep the roles distinct.
- Do **not** create ceremonial layers. Introduce `domain/repositories/` only when the domain persists entities or protects business rules.
- Never collide a port name with its implementation name in the same file (`interface AuthService` + `class AuthService` is forbidden); use `DefaultAuthService implements AuthService` or separate files.
- Model **closed domains as enums** (or const-object + typed union), never ad-hoc string unions scattered across consumers.

## Toolchain

- Package manager: **`bun` or `pnpm`. `npm` is forbidden** for install/run/test/build.
- Run linters, type-checks and tests before claiming a change is complete.

## Git

- **Git Flow**; quality gate (lint + type-check + tests) must pass before commit/push.
- Commit format: `<type>: <module>/<submodule> <description>` — allowed types `feat:`, `fix:`, `refactor:`, `test:`, `chore:`, `docs:`, `build:`, `ci:`. **No parenthesized scopes** (❌ `feat(x): ...`).
  - ✅ `fix: quotations/client resolve recipient mapping`
- **Never commit, push, or merge into protected branches** (e.g. `main`/`production`, `dev`/`developer`, `release`) **without an explicit user request.** Local edits do not imply committing.
