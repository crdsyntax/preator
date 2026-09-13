# Feature: Supervised Delegation (verify → alert → correct → escalate)

- **Spec ID:** SPEC-301
- **Slug:** `supervised-delegation`
- **Status:** Approved
- **Owner:** @crdsyntax
- **Related issue:** <to be linked>

## Summary

Turn delegation into a supervised loop: verify every specialist output, alert the user when an agent does not complete the task, require in-run (hot) correction, and if it is not corrected, revoke and escalate to the nearest superior. An unresolved delegation must never be reported as a completed task.

## Requirements

- **R1:** `OrchestratorEngine.delegate` accepts a `verify(output, request)` hook; a `{ valid: false }` result marks the attempt incomplete (not completed).
- **R2:** Each failed attempt emits a user alert: event `delegation.alert`, entries in the delegation result `alerts[]`, and an optional `onAlert` callback, stating the agent did not complete the task and must correct it.
- **R3:** Hot correction: the same specialist is retried up to `maxCorrections` (initial attempt + corrections) before escalating.
- **R4:** If still unresolved, the delegation is revoked and escalated to the nearest superior (`parent_agent_id`); an optional `escalationExecutorFn(superior, request, ctx)` may resolve the task, in which case the result is `COMPLETED` with `resolved_by`/`escalated_to` set.
- **R5:** An unresolved delegation returns `status: REVOKED`, `needs_correction: true`; `TaskExecutor` must not advance to `DOCUMENT`/`COMPLETE` and returns overall `status: 'needs_correction'` with `alerts[]` and `revocations[]`.

## Acceptance Criteria

- **AC1** (R1): with `verify` rejecting an output, the delegation does not complete.
- **AC2** (R2): a failed attempt produces `DELEGATION_INCOMPLETE` alerts (event + `result.alerts`).
- **AC3** (R3): first attempt invalid, second valid → `status: COMPLETED`, `attempts: 2`, exactly one alert (SUP-01).
- **AC4** (R4): always-invalid output with a resolving `escalationExecutorFn` → `COMPLETED`, `resolved_by` = superior, `revoked_from` = specialist, `revoked_to` = superior (SUP-02).
- **AC5** (R5): always-invalid output without escalation → `REVOKED`, `needs_correction: true`, `escalated_to` = superior (SUP-03); `executeTask` returns `needs_correction` and the persisted task is not `completed` (REV-01).

## Contracts / Interfaces

- `OrchestratorEngine({ maxCorrections })` and `delegate(request, childExecutorFn, sessionFactoryFn, { verify, maxCorrections, escalationExecutorFn, onAlert })`.
- `DELEGATION_STATUS.INCOMPLETE`; `createDelegationResult({ attempts, escalatedTo, resolvedBy, needsCorrection, alerts })`.
- Events: `delegation.alert`, `delegation.revoked`, `delegation.escalated`, `delegation.completed`, `task.needs_correction`.
- `AgentSession.delegate({ ..., verify, maxCorrections, escalationExecutorFn, onAlert })`.
- `TaskExecutor.execute(session, { verify, maxCorrections, escalationExecutorFn, onAlert })`.

## Edge Cases

- **E1:** `maxCorrections: 0` → no retry; still alerts once and escalates.
- **E2:** No `verify` → outputs are accepted (backward compatible).
- **E3:** Escalation without `escalationExecutorFn` → `needs_correction`.
- **E4:** A thrown exception is treated like an invalid output (alert + correction + escalation).

## Non-Functional Requirements

- Deterministic; no infinite loops (bounded attempts). Alerts are emitted for every failed attempt.
- Backward compatible: existing delegations without `verify` keep completing.

## Out of Scope

- Cross-specialist (peer) delegation; escalation stays single-root (nearest superior).
- Automatic resolution without a superior executor.

## Traceability

| Requirement | Tasks | Tests |
|-------------|-------|-------|
| R1 | T1, T2 | `supervised::sup_01` (AC1, AC3) |
| R2 | T1 | `supervised::sup_02`, `revocation` (AC2) |
| R3 | T1 | `supervised::sup_01` (AC3) |
| R4 | T1, T2 | `supervised::sup_02`, `revocation` REV-03 (AC4) |
| R5 | T3 | `supervised::sup_03`, `revocation` REV-01 (AC5) |
