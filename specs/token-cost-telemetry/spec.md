# Feature: Token & Cost Telemetry per Model

- **Spec ID:** SPEC-101
- **Slug:** `token-cost-telemetry`
- **Status:** Approved
- **Owner:** @crdsyntax
- **Related issue:** <to be linked>

## Summary

Restore per-model token and **real cost** telemetry that existed in Praetor's predecessor but was dropped when the runtime was extracted. Emit an auditable `llm.completed` event carrying model, token breakdown and USD cost, accumulate cost per session/model, and capture usage in the OpenCode host integration.

## Requirements

- **R1:** A pricing module resolves a per-model rate (USD per 1M tokens) for input/output/reasoning and cache read/write, with a safe default when the model is unknown.
- **R2:** `estimateCost({ model, inputTokens, outputTokens, reasoningTokens, cacheReadTokens, cacheWriteTokens })` returns USD rounded to 6 decimals.
- **R3:** `ProviderDriver` computes cost from each turn's usage + model and accumulates `totalUsage.cost_usd` and `totalUsage.by_model`.
- **R4:** `ProviderDriver` emits a `llm.completed` event (when the session exposes an event log) with `model`, token fields and `cost_usd`.
- **R5:** `ModelTurnResponse` carries an optional `model` field.
- **R6:** The OpenCode host integration captures the model per session and, on LLM completion, records an `llm.completed` event into the session's hash-chained log, preferring the host-provided cost when present.
- **R7:** `praetor audit verify <sessionId>` reports the session's accumulated tokens and cost, and `praetor doctor` reports the total cost across sessions (with models).

## Acceptance Criteria

- **AC1** (R1): `resolvePricing('gpt-4o-mini')` returns input `0.15`/output `0.60`; `resolvePricing('gemini-1.5-pro')` returns `1.25`/`5.00`; an unknown model returns the default (`1.25`/`5.00`).
- **AC2** (R2): `estimateCost({ model: 'gpt-4o', inputTokens: 1000, outputTokens: 500 }) === 0.0075`.
- **AC3** (R3, R4): After a turn with usage `{prompt_tokens:1000, completion_tokens:500}` and model `gpt-4o`, `driver.totalUsage.cost_usd === 0.0075` and the session log contains one `llm.completed` with `cost_usd === 0.0075`.
- **AC4** (R5): `createModelTurnResponse({ model: 'gpt-4o' }).model === 'gpt-4o'`.
- **AC5** (R6): `recordOpencodeLlmUsage(sessionId, { model:'sonnet', inputTokens:1000, outputTokens:500 }, { cwd })` appends `llm.completed` with `cost_usd === 0.0105` (3.00/1M in, 15.00/1M out) and the event chain remains valid.
- **AC6** (R7): `verifySession` returns `usage.cost_usd` for a session whose log has `llm.completed`; `runDoctor` returns `cost.total_usd` and `cost.by_model` aggregating the same events.

## Contracts / Interfaces

- `runtime/telemetry/pricing.js`: `DEFAULT_PRICING`, `resolvePricing(model)`, `estimateCost(usage)`, `createUsageRecord(usage)`.
- `runtime/providers/contracts.js`: `createModelTurnResponse({ model, ... })`.
- `runtime/providers/driver.js`: `totalUsage = { prompt_tokens, completion_tokens, total_tokens, cost_usd, by_model }`; event `llm.completed`.
- `runtime/hosts/opencode-plugin-core.js`: `recordOpencodeLlmUsage(sessionId, usage, { cwd, costUsd })`.
- `runtime/hosts/templates/opencode-plugin.js`: `chat.message` (model capture) + `event` (`message.updated`) hooks.

## Edge Cases

- **E1:** Unknown/empty model → default rates, never `NaN`.
- **E2:** Zero tokens → cost `0`.
- **E3:** Host provides `cost` (from opencode) → preferred over the estimate.
- **E4:** Event log unavailable → cost accumulation still works, no event emitted.

## Non-Functional Requirements

- Pricing table is data-driven and easy to extend; no external dependencies.
- Cost math is deterministic and unit-tested.

## Out of Scope

- Live price fetching from providers.
- Budget enforcement/quotas (future).
- Historical backfill of past sessions.

## Traceability

| Requirement | Tasks | Tests |
|-------------|-------|-------|
| R1 | T1 | `cost::tests::resolve_pricing` (AC1) |
| R2 | T1 | `cost::tests::estimate_cost` (AC2) |
| R3, R4 | T2 | `cost::tests::provider_driver_cost` (AC3) |
| R5 | T3 | `cost::tests::turn_response_model` (AC4) |
| R6 | T4, T5 | `cost::tests::opencode_usage_event` (AC5) |
| R7 | T7 | `cost::tests::{audit_verify_cost, doctor_cost}` (AC6) |
