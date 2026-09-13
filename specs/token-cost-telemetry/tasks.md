# Tasks: Token & Cost Telemetry per Model

- **Spec:** `specs/token-cost-telemetry/spec.md`
- **Design:** `specs/token-cost-telemetry/design.md`

## Checklist

- [ ] **T1** (R1, R2, AC1, AC2) — Create the pricing module.
  - Files: `runtime/telemetry/pricing.js`
  - Tests: `cost::tests::resolve_pricing`, `cost::tests::estimate_cost`
- [ ] **T2** (R3, R4, AC3) — Accumulate cost + emit `llm.completed` in the provider driver.
  - Files: `runtime/providers/driver.js`
  - Tests: `cost::tests::provider_driver_cost`
- [ ] **T3** (R5, AC4) — Carry `model` on the turn response.
  - Files: `runtime/providers/contracts.js`
  - Tests: `cost::tests::turn_response_model`
- [ ] **T4** (R6, AC5) — Host record helper.
  - Files: `runtime/hosts/opencode-plugin-core.js`
  - Tests: `cost::tests::opencode_usage_event`
- [ ] **T5** (R6) — Capture model + usage in the OpenCode plugin template.
  - Files: `runtime/hosts/templates/opencode-plugin.js`
- [ ] **T6** — Wire the suite into `bun run test` and update docs.
  - Files: `package.json`, `README.md`, `CHANGELOG.md`
- [ ] **T7** (R7, AC6) — Expose cost in the CLI (audit verify + doctor).
  - Files: `scripts/audit-session.js`, `scripts/doctor.js`
  - Tests: `cost::tests::{audit_verify_cost, doctor_cost}`

## Verification

- [ ] All acceptance criteria (AC#) have a passing test.
- [ ] `bun run test`
- [ ] `bun run agents:enforce`
