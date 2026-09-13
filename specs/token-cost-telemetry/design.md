# Design: Token & Cost Telemetry per Model

- **Spec:** `specs/token-cost-telemetry/spec.md`
- **Status:** Approved

## Context

The predecessor runtime emitted `llm.completed` with model, token breakdown and `estimated_cost_usd`, and its Python runtime documented events carrying `input_tokens, output_tokens, model, estimated_cost`. Praetor kept the FSM, policy and event log but lost the cost layer. This design restores it on top of Praetor's existing sealed, hash-chained event log.

## Architecture & Layers

```
runtime/telemetry/pricing.js        ← model rate table + cost math (new, leaf module)
        ▲                    ▲
        │                    │
runtime/providers/driver.js   runtime/hosts/opencode-plugin-core.js
 (authoritative turn loop)     (host capture path)
        │                    │
        ▼                    ▼
   session.events  ──────► events.jsonl (hash-chained, sealed session)
```

`pricing.js` is a dependency-free leaf so it can be imported by both the provider layer and the host layer without cycles. Cost lands in the same `events.jsonl` Praetor already seals.

## Contracts

- `resolvePricing(model) -> { label, input, output, reasoning, cache_read, cache_write }` (USD/1M).
- `estimateCost(usage) -> number` (USD, 6dp).
- `ProviderDriver.totalUsage` extended with `cost_usd` and `by_model`.
- Event `llm.completed`: `{ model, input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_tokens, total_tokens, cost_usd }`.
- `recordOpencodeLlmUsage(sessionId, usage, { cwd, costUsd }) -> usageRecord`.

## Data Flow

1. Provider returns `usage` + `model` in the turn response.
2. Driver normalizes usage, computes cost via `pricing.js`, accumulates totals, appends `llm.completed`.
3. OpenCode plugin captures `model` from `chat.message`, sums token/cost from `message.updated` parts, calls `recordOpencodeLlmUsage`, which appends to the session log.

## Decisions

| Decision | Choice | Rationale | Alternative rejected |
|----------|--------|-----------|----------------------|
| Pricing location | Leaf `runtime/telemetry/pricing.js` | Shared by provider + host, no cycles | Inline in each host |
| Cost source | Host `part.cost` if present, else estimate | Prefer authoritative provider cost | Always estimate |
| Reasoning tokens | Charged at output rate | Matches predecessor behavior | Separate rate |
| Storage | Reuse `llm.completed` event | Auditable + already signed/chained | Separate SQLite DB |

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Stale pricing table | Low accuracy | Data-driven, documented; easy to update |
| Event log unavailable | Lost audit line | Guarded append; accumulation still works |
| Token double counting | Inflated cost | Single source per turn (driver) / per message (plugin) |

## Rollout / Migration

Additive. No data migration. Past sessions lack `llm.completed`; new sessions accrue cost. `praetor audit verify` can surface the events once exposed.
