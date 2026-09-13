export const DEFAULT_PRICING = Object.freeze({
  label: 'default',
  input: 1.25,
  output: 5.00
});

const MODEL_PRICING = Object.freeze([
  { match: /gemini.*3\.8.*flash/, label: 'gemini-3.8-flash', input: 0.15, output: 0.60 },
  { match: /gemini.*flash/, label: 'gemini-flash', input: 0.075, output: 0.30 },
  { match: /gemini.*pro/, label: 'gemini-pro', input: 1.25, output: 5.00 },
  { match: /haiku/, label: 'claude-haiku', input: 0.80, output: 4.00 },
  { match: /sonnet/, label: 'claude-sonnet', input: 3.00, output: 15.00 },
  { match: /gpt-4o-mini/, label: 'gpt-4o-mini', input: 0.15, output: 0.60 },
  { match: /gpt-4o/, label: 'gpt-4o', input: 2.50, output: 10.00 }
]);

export function resolvePricing(model) {
  const name = String(model || '').toLowerCase();
  const hit = MODEL_PRICING.find(entry => entry.match.test(name));
  const base = hit || DEFAULT_PRICING;
  const output = base.output;
  return Object.freeze({
    label: base.label,
    input: base.input,
    output,
    reasoning: output,
    cache_read: base.input,
    cache_write: Number((base.input * 1.25).toFixed(6))
  });
}

export function estimateCost({
  model = null,
  inputTokens = 0,
  outputTokens = 0,
  reasoningTokens = 0,
  cacheReadTokens = 0,
  cacheWriteTokens = 0
} = {}) {
  const pricing = resolvePricing(model);
  const cost = (
    Number(inputTokens) * pricing.input +
    (Number(outputTokens) + Number(reasoningTokens)) * pricing.output +
    Number(cacheReadTokens) * pricing.cache_read +
    Number(cacheWriteTokens) * pricing.cache_write
  ) / 1_000_000;

  return Number((Number.isFinite(cost) ? cost : 0).toFixed(6));
}

export function createUsageRecord({
  model = null,
  inputTokens = 0,
  outputTokens = 0,
  reasoningTokens = 0,
  cacheReadTokens = 0,
  cacheWriteTokens = 0,
  costUsd = null
} = {}) {
  const pricing = resolvePricing(model);
  const input = Number(inputTokens) || 0;
  const output = Number(outputTokens) || 0;
  const reasoning = Number(reasoningTokens) || 0;
  const cacheRead = Number(cacheReadTokens) || 0;
  const cacheWrite = Number(cacheWriteTokens) || 0;

  const computed = estimateCost({
    model,
    inputTokens: input,
    outputTokens: output,
    reasoningTokens: reasoning,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite
  });

  return {
    model: model || 'unknown',
    input_tokens: input,
    output_tokens: output,
    reasoning_tokens: reasoning,
    cache_read_tokens: cacheRead,
    cache_write_tokens: cacheWrite,
    total_tokens: input + output + reasoning,
    cost_usd: (costUsd !== null && Number(costUsd) > 0) ? Number(Number(costUsd).toFixed(6)) : computed,
    pricing_label: pricing.label
  };
}
