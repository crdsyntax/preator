# Design: Supervised Delegation

- **Spec:** `specs/supervised-delegation/spec.md`
- **Status:** Approved

## Context

Delegation previously revoked only on a thrown exception, treated `REVOKED` as acceptable, and never alerted the user or re-ran the task. This design adds a supervision loop around each delegation: verify → alert → correct (hot) → escalate (superior).

## Architecture & Layers

```
TaskExecutor (runtime/core/executor.js)
   │  options: verify, maxCorrections, escalationExecutorFn, onAlert
   ▼
AgentSession.delegate (runtime/session.js)  ──►  OrchestratorEngine.delegate (runtime/core/orchestration.js)
                                                        │  loop: childExecutorFn × (1 + maxCorrections)
                                                        │  verify(output) → valid?
                                                        │  invalid → emit delegation.alert
                                                        │  exhausted → REVOKED + escalate to parent
                                                        ▼
                                              events.jsonl (hash-chained) + task ownership
```

## Contracts

- `delegate(request, childExecutorFn, sessionFactoryFn, { verify, maxCorrections, escalationExecutorFn, onAlert })`.
- Result additions: `attempts`, `escalated_to`, `resolved_by`, `needs_correction`, `alerts[]`.
- `TaskExecutor` short-circuits to `status: 'needs_correction'` when any delegation is unresolved.

## Data Flow

1. `delegate` gates the request, starts the delegation, then loops up to `1 + maxCorrections`.
2. Each attempt runs `childExecutorFn`; `verify` scores the output.
3. Invalid → `delegation.alert` + `onAlert`; retry if corrections remain.
4. Exhausted → `delegation.revoked`, ownership → parent, optional `escalationExecutorFn(superior)`.
5. Resolved by superior → `COMPLETED` with `resolved_by`/`escalated_to`; otherwise `REVOKED` + `needs_correction`.

## Decisions

| Decision | Choice | Rationale | Alternative rejected |
|----------|--------|-----------|----------------------|
| Verification | Pluggable `verify` hook | Project-specific quality/completeness | Hardcoded checks in the runtime |
| Alert | Event + result + callback | Human-visible, host-agnostic | Log only |
| Correction | Retry same specialist | “Hot” fix before escalating | Immediate escalation |
| Escalation | Nearest superior (parent) | Respects single-root tree | Peer delegation |
| Unresolved status | `needs_correction` blocks COMPLETE | Don’t claim success | Optimistic `completed` |

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Misconfigured `verify` | False corrections | Defaults to accept when absent; conservative checks |
| Retry storms | Cost | Bounded `maxCorrections` |
| Silent success after failure | Wrong reports | `needs_correction` blocks COMPLETE; alerts surfaced |
