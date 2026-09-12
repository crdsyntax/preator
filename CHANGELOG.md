# Changelog

All notable changes to Praetor are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/) and the project adheres to [Semantic Versioning](https://semver.org/).

## [0.3.0] - 2026-09-12

Security-hardening release: state sealing with a real key, tamper-evident event chain, action-bound human approvals, path/symlink hardening, and migration tooling. **Breaking for pre-existing sessions** unless migrated.

### Added
- `runtime/core/sealing.js`: keyed HMAC state sealing (`SEAL_VERSION=2`), legacy-compatible v1 verification, event chain hashing, `verifyChainSegment`.
- `runtime/core/paths.js`: `resolveWithinRoot` with realpath and symlink allowlist.
- CLI commands `praetor migrate` (re-seal v1→v2, quarantine invalid sessions, `--dry-run`) and `praetor doctor`.
- `evaluations/security/sealing.js`, `evaluations/migration/migrate.test.js`, and regression scenarios HRD-07/08/09b/10/11/12/13.
- `SECURITY.md` with the threat model and key-management guidance.

### Changed
- `state.json` is sealed with HMAC-SHA256 when a key is available; the seal binds `goal`, `context`, `pending_approval` and `approvals`.
- Events now carry `seq`, `prev_hash` and `event_hash` (tamper-evident chain).
- Human approvals are bound to `request_id` + canonical argument hash, single-use, with mandatory `resolved_by` actor and TTL.
- `policy`/`context` path checks enforce workspace boundaries via realpath; new config fields `workspace.follow_symlinks` and `workspace.symlink_allowlist`.
- `EventLog` writes next to `state.json` (honors `sessionsRoot`).

### Fixed
- FSM event replay validated the wrong field and flagged legitimate resumed sessions as tampered.
- `context.hasApproval` / `args.hasApproval` self-approval bypass removed.
- `approveTask` called a non-existent `ApprovalManager.approve` method.
- Path prefix boundary bypass (`startsWith` without separator).

### Security
- Missing/malformed seals and v2 seals without a key fail closed.
- Deleted/reordered events break the chain and fail closed.
- `git push` requires a bound approval grant.

## [0.2.0] - 2026-09-12

Governance and host lifecycle hardening: corrected FSM replay, fail-closed sealing, path boundaries, non-destructive host hydration, delegation context/target enforcement, provider/session API completion, config deep validation, argument redaction and broader destructive-command detection.

## [0.1.2] - prior

Initial public baseline: 8-phase FSM, dual-layer policy, execution gateway, host adapters (Antigravity hook, MCP), delegation tree and evaluation harness.
