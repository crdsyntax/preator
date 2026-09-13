# Tasks: Development Standard

- **Spec:** `specs/development-standard/spec.md`
- **Design:** `specs/development-standard/design.md`

## Checklist

- [ ] **T1** (R1, R2, AC1, AC2) — Profile loader + validator.
  - Files: `runtime/core/architecture.js`, `standards/default.json`
  - Tests: `arch::tests::{load_profile, clean, layer, rules}`
- [ ] **T2** (R3, R4, AC3, AC4) — CLI commands.
  - Files: `bin/praetor.js`
- [ ] **T3** (R5, AC5) — Architect agent.
  - Files: `agents/architecture/architect.md`, `AGENTS.md`
- [ ] **T4** (R5, AC5) — Development-standard skill + patterns reference + ADR template.
  - Files: `skills/development-standard/SKILL.md`, `skills/development-standard/references/architecture-patterns.md`, `docs/adr/template.md`
- [ ] **T5** — Wire config + test suite, docs, version.
  - Files: `runtime.config.json`, `package.json`, `CHANGELOG.md`, `README.md`

## Verification

- [ ] `bun run test`
- [ ] `bun run agents:enforce`
- [ ] `praetor arch check <path>` (clean → 0, violating → non-zero)
