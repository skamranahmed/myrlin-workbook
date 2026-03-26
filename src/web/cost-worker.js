/**
 * Cost calculation worker thread.
 * Runs JSONL parsing off the main event loop to prevent terminal I/O freezes.
 * Receives { jsonlPath, pricing, defaultPricing } messages,
 * returns the calculated cost breakdown.
 */
const { parentPort } = require('worker_threads');
const fs = require('fs');

parentPort.on('message', (msg) => {
  const { id, jsonlPath, pricing, defaultPricing } = msg;

  try {
    const result = calculateSessionCost(jsonlPath, pricing, defaultPricing);
    parentPort.postMessage({ id, result });
  } catch (err) {
    parentPort.postMessage({ id, error: err.message });
  }
});

/**
 * Parse a JSONL file and calculate token usage and estimated cost.
 * Aggregates usage across all assistant messages, grouped by model.
 * @param {string} jsonlPath - Absolute path to the .jsonl file
 * @param {object} pricing - Model pricing table
 * @param {object} defaultPricing - Default pricing for unknown models
 * @returns {object} Token and cost breakdown
 */
function calculateSessionCost(jsonlPath, pricing, defaultPricing) {
  const content = fs.readFileSync(jsonlPath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());

  const totals = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  const modelBreakdown = {};
  let messageCount = 0;
  let firstMessage = null;
  let lastMessage = null;

  // Context growth tracking
  let latestInputTokens = 0;
  let peakInputTokens = 0;
  const contextSamples = [];

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.type !== 'assistant') continue;

      const msg = entry.message;
      if (!msg || !msg.usage) continue;

      messageCount++;
      const ts = entry.timestamp || null;
      if (ts && (!firstMessage || ts < firstMessage)) firstMessage = ts;
      if (ts && (!lastMessage || ts > lastMessage)) lastMessage = ts;

      const usage = msg.usage;
      const model = msg.model || 'unknown';
      const inputTokens = usage.input_tokens || 0;
      const outputTokens = usage.output_tokens || 0;
      const cacheWriteTokens = usage.cache_creation_input_tokens || 0;
      const cacheReadTokens = usage.cache_read_input_tokens || 0;

      totals.input += inputTokens;
      totals.output += outputTokens;
      totals.cacheWrite += cacheWriteTokens;
      totals.cacheRead += cacheReadTokens;

      latestInputTokens = inputTokens;
      if (inputTokens > peakInputTokens) peakInputTokens = inputTokens;
      contextSamples.push({ msg: messageCount, tokens: inputTokens, ts });

      if (!modelBreakdown[model]) {
        modelBreakdown[model] = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0 };
      }
      modelBreakdown[model].input += inputTokens;
      modelBreakdown[model].output += outputTokens;
      modelBreakdown[model].cacheWrite += cacheWriteTokens;
      modelBreakdown[model].cacheRead += cacheReadTokens;

      const p = pricing[model] || defaultPricing;
      const msgCost =
        (inputTokens / 1_000_000) * p.input +
        (outputTokens / 1_000_000) * p.output +
        (cacheWriteTokens / 1_000_000) * p.cacheWrite +
        (cacheReadTokens / 1_000_000) * p.cacheRead;
      modelBreakdown[model].cost = Math.round((modelBreakdown[model].cost + msgCost) * 1_000_000) / 1_000_000;
    } catch (_) {
      // Skip malformed lines
    }
  }

  // Downsample context growth to max 50 points
  let contextGrowth = contextSamples;
  if (contextSamples.length > 50) {
    const step = Math.ceil(contextSamples.length / 50);
    contextGrowth = contextSamples.filter((_, i) => i % step === 0 || i === contextSamples.length - 1);
  }

  // Calculate total costs
  const cost = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: 0 };
  for (const [model, breakdown] of Object.entries(modelBreakdown)) {
    const p = pricing[model] || defaultPricing;
    cost.input += (breakdown.input / 1_000_000) * p.input;
    cost.output += (breakdown.output / 1_000_000) * p.output;
    cost.cacheWrite += (breakdown.cacheWrite / 1_000_000) * p.cacheWrite;
    cost.cacheRead += (breakdown.cacheRead / 1_000_000) * p.cacheRead;
  }
  cost.input = Math.round(cost.input * 1_000_000) / 1_000_000;
  cost.output = Math.round(cost.output * 1_000_000) / 1_000_000;
  cost.cacheWrite = Math.round(cost.cacheWrite * 1_000_000) / 1_000_000;
  cost.cacheRead = Math.round(cost.cacheRead * 1_000_000) / 1_000_000;
  cost.total = Math.round((cost.input + cost.output + cost.cacheWrite + cost.cacheRead) * 1_000_000) / 1_000_000;

  return {
    tokens: {
      input: totals.input,
      output: totals.output,
      cacheWrite: totals.cacheWrite,
      cacheRead: totals.cacheRead,
      total: totals.input + totals.output + totals.cacheWrite + totals.cacheRead,
    },
    cost,
    modelBreakdown,
    messageCount,
    firstMessage,
    lastMessage,
    quota: {
      latestInputTokens,
      peakInputTokens,
      contextGrowth,
    },
  };
}
