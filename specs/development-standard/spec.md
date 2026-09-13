# Feature: Development Standard (architecture patterns + quality gate)

- **Spec ID:** SPEC-201
- **Slug:** `development-standard`
- **Status:** Approved
- **Owner:** @crdsyntax
- **Related issue:** <to be linked>

## Summary

Add a generic, per-project **development standard** capability to Praetor: a declarative architecture profile, an executable validator, an `architect` agent and a `development-standard` skill covering Git Flow, CI/CD gate, patterns, naming, testing and secrets. It is stack/project agnostic.

## Requirements

- **R1:** A profile `standards/<name>.json` declares `pattern`, `feature_root`, `layers`, `dependency_rules`, `rules` (no_any/no_console/no_comments/enums/secrets), `ignore` and `commands`. `loadArchitectureProfile` merges it over a built-in default.
- **R2:** `validateArchitecture(rootDir, profile)` statically scans code under `feature_root` and reports violations `{file, line, rule, message}` for `layer_dependency`, `no_any`, `no_console`, `no_comments` and `secrets`; test files are exempt from `no_console`/`no_comments`.
- **R3:** `praetor arch check [path] [--profile name] [--json]` prints the report and exits non-zero when there are violations.
- **R4:** `praetor standards check [path] [--profile name]` runs the architecture check plus the profile's `commands` (e.g. type-check/lint/test) as a quality gate.
- **R5:** The capability ships a dedicated `architect` agent and a `development-standard` skill (with an `architecture-patterns` reference) covering all development levels, worded generically (no project-specific coupling).

## Acceptance Criteria

- **AC1** (R1): `loadArchitectureProfile` returns the default pattern when no profile file exists, and merges a profile file when present.
- **AC2** (R2): a feature where `domain/` imports `infrastructure/` yields a `layer_dependency` violation; a well-layered feature yields none; `any`, `console.*` and hardcoded secrets are detected, and `.test.ts` files are exempt from `no_console`.
- **AC3** (R3): `praetor arch check` exits `1` with violations and `0` on a clean tree.
- **AC4** (R4): `praetor standards check` returns non-zero when either the architecture check fails or a profile command fails.
- **AC5** (R5): `agents/architecture/architect.md` and `skills/development-standard/SKILL.md` exist; `praetor` audit still loads the agent catalog.

## Contracts / Interfaces

- `runtime/core/architecture.js`: `DEFAULT_ARCHITECTURE_PROFILE`, `loadArchitectureProfile({ rootDir, profile })`, `validateArchitecture(rootDir, profile)`.
- `standards/default.json` (profile schema).
- CLI: `praetor arch check`, `praetor standards check`.
- `runtime.config.json`: optional `standards.profile` selector.

## Edge Cases

- **E1:** Missing `feature_root` → no files scanned (no false positives on unrelated trees).
- **E2:** Malformed profile → falls back to defaults.
- **E3:** Non-JS/TS files are ignored by v1 rules.
- **E4:** Test files (`*.test.*`, `*.spec.*`, `__tests__/`) are not flagged for `console.*`/comments.

## Non-Functional Requirements

- Dependency-free static analysis; deterministic output.
- No coupling to any specific project; all project specifics live in the profile.

## Out of Scope

- AST-based analysis (v1 is regex/path based; AST is a v2 candidate).
- Auto-fixing violations.
- Executing the CI pipeline itself (the gate delegates to profile `commands`).

## Traceability

| Requirement | Tasks | Tests |
|-------------|-------|-------|
| R1 | T1 | `arch::tests::load_profile` (AC1) |
| R2 | T1 | `arch::tests::{clean, layer, rules}` (AC2) |
| R3 | T2 | CLI smoke (manual) (AC3) |
| R4 | T2 | CLI smoke (manual) (AC4) |
| R5 | T3, T4 | catalog audit (AC5) |
