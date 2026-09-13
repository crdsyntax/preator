# Changelog

All notable changes to Praetor are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/) and the project adheres to [Semantic Versioning](https://semver.org/).

## [0.9.1] - 2026-09-13

### Changed
- Adopted a patch-only versioning policy until 1.0.0: increment the last numeric field each release, carrying on overflow (`0.9.99 -> 0.10.0`, `0.99.99 -> 1.0.0`). Documented in `AGENTS.md`.

## [0.9.0] - 2026-09-13

Architecture routing and a stricter profile.

### Added
- Automatic routing: architecture/pattern goals delegate to the `architect` specialist; the orchestrator's delegation targets include `architect`.
- `structure.enforce_layers` rule (flags files outside every declared layer).
- Example profile `standards/strict.json` (enforces comments-off, layer structure and project commands).

### Changed
- Architecture suite extended with ARC-04 (routing) and ARC-05 (strict profile).

## [0.8.0] - 2026-09-13

Development standard capability (generic, project-agnostic).

### Added
- `runtime/core/architecture.js` + `standards/default.json`: declarative architecture profile and static validator (layer dependency direction, `no_any`, `no_console`, `no_comments`, `secrets`).
- CLI `praetor arch check` and `praetor standards check` (architecture plus the profile's project commands as a quality gate).
- `agents/architecture/architect.md` and `skills/development-standard/SKILL.md` (+ `references/architecture-patterns.md`), covering Git Flow, CI/CD gate, patterns, naming, typing, testing and secrets.
- `docs/adr/template.md`; SDD spec `specs/development-standard/`; evaluation suite ARC-01..03.
- `runtime.config.json` `standards.profile` selector.

## [0.7.1] - 2026-09-13

### Fixed
- Execution-boundary wording now refers to **protected branches in general** (`main`/`production`, `dev`/`developer`, `release`, etc.) instead of a single `release` branch, across `skills/code-conventions/SKILL.md` and `skills/git-workflow/SKILL.md`.

## [0.7.0] - 2026-09-13

Team code conventions and cost visibility.

### Added
- `skills/code-conventions/SKILL.md`: team coding conventions ported from the project's governing standard— zero `any`, no `console.*`, no secrets, layering (domain must not depend on application/infrastructure; ports vs adapters), enums for closed domains, `bun`/`pnpm` only (never `npm`), and the governed commit format and execution boundaries. Referenced from `AGENTS.md` and `agents/core/engineering.md`.
- Cost visibility: `praetor audit verify` reports per-session tokens/cost (`usage`) and `praetor doctor` reports total cost across sessions with models (`cost`).

### Changed
- `skills/git-workflow/SKILL.md`: commit format `<type>: <module>/<submodule> <description>` (no parenthesized scopes) plus execution boundaries (never commit/push/merge into a protected branch without an explicit request).
- Telemetry suite extended with TELE-06 (audit) and TELE-07 (doctor).

## [0.6.0] - 2026-09-13

Token & cost telemetry per model (restored from an earlier runtime).

### Added
- `runtime/telemetry/pricing.js`: data-driven per-model pricing (USD/1M), `resolvePricing`, `estimateCost`, `createUsageRecord`.
- `llm.completed` event carrying model, token breakdown and `cost_usd`, emitted by `ProviderDriver` and by the OpenCode host helper `recordOpencodeLlmUsage`.
- `ProviderDriver.totalUsage` now includes `cost_usd` and `by_model`.
- OpenCode plugin captures the model (`chat.message`) and LLM usage (`message.updated`), preferring the host-provided cost.
- Evaluation suite `evaluations/telemetry/cost.test.js` (TELE-01..05).

## [0.5.0] - 2026-09-12

Auto-load release: project-scoped host integration with hard enforcement for OpenCode, corrected Antigravity hook schema and MCP exposure.

### Added
- OpenCode auto-load: `opencode.json` MCP entry, auto-discovered `.opencode/plugin/praetor.js` (hard `tool.execute.before` gate), `/praetor` command and instructions; core evaluator `runtime/hosts/opencode-plugin-core.js`.
- Antigravity `.agents/mcp_config.json`; `praetor doctor` validates host integrations (schemas + MCP); `agents:self-setup` script installs both hosts.
- Regression suites: AGT-01..03, OCP-01..03, DOC-01..02 (wired into `bun run test`).

### Changed
- `AntigravityHostAdapter.setup/verify` now emit/validate the official hooks schema (`hook-name -> PreToolUse -> [{matcher, hooks:[{type,command,timeout}]}]`) and are BOM-tolerant.
- Canonicalization accepts `filePath` for OpenCode read/write tool arguments.
- The repository self-installs `.agents/` and `.opencode/` for zero-config auto-load; the real provider is the host's own model via MCP/plugin.

### Fixed
- README host/MCP examples aligned with the real Antigravity and MCP protocols.

## [0.4.0] - 2026-09-12

Reliability release: cross-process locking, first-class resume, real cancellation, audited FSM reset and session audit tooling. Backward compatible with 0.3.0 sessions.

### Added
- `runtime/core/locks.js`: stale-aware lockfiles; `state.json` writes are atomic (temp + rename) under lock.
- First-class resume: `executeTask`/`resumeTask`/`approveTask`/`cancelTask` rehydrate sessions from disk; `TaskExecutor` is resume-safe (no duplicate delegation or transitions).
- Real cancellation: per-session `AbortController`, `session.abort(reason)`, tool-level timeout and global task timeout, terminal `cancelled` status.
- `session.newRun({ reason, actor })` and `praetor audit verify <sessionId>` (reconstructs seal + event chain + FSM trace).
- Regression suites: CON-01..03, RES-01..03, CAN-01..03, RST-01..03, AUD-01..03 (wired into `bun run test`).

### Changed
- `events.jsonl` appends resynchronize `seq`/`prev_hash` under lock, keeping the chain linear across processes.
- FSM: `COMPLETE` no longer silently transitions to `REQUEST`; use audited `newRun`.
- `PersistentTaskStore` derives persisted phase from the live session.

### Fixed
- `EventLog` ignored the session root (events now live beside `state.json`).
- Task store could persist a stale phase after in-memory transitions.

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
