# Tasks: Supervised Delegation

- **Spec:** `specs/supervised-delegation/spec.md`
- **Design:** `specs/supervised-delegation/design.md`

## Checklist

- [ ] **T1** (R1, R2, R3, R4, AC1–AC4) — Verify + alert + correction + escalation in `OrchestratorEngine.delegate`.
  - Files: `runtime/core/orchestration.js`, `runtime/core/delegation.js`
  - Tests: `supervised::sup_01`, `supervised::sup_02`
- [ ] **T2** (R4) — Forward options through the session.
  - Files: `runtime/session.js`
  - Tests: `revocation` REV-03
- [ ] **T3** (R5, AC5) — Block completion on unresolved delegations.
  - Files: `runtime/core/executor.js`
  - Tests: `supervised::sup_03`, `revocation` REV-01
- [ ] **T4** — Wire the suite and document.
  - Files: `package.json`, `CHANGELOG.md`, `specs/supervised-delegation/`

## Verification

- [ ] `bun run test`
- [ ] `bun run agents:enforce`
