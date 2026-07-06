'use strict';

// API-equivalent pricing, USD per 1,000,000 tokens (standard tier).
// Sourced from the Claude platform pricing table. `in`/`out` are the base
// input/output rates; cache multipliers are applied on top of the input rate.
//
// Cache multipliers (relative to base input rate):
//   cache read           -> 0.10x
//   cache write (5m TTL)  -> 1.25x
//   cache write (1h TTL)  -> 2.00x
const CACHE_READ_MULT = 0.10;
const CACHE_WRITE_5M_MULT = 1.25;
const CACHE_WRITE_1H_MULT = 2.0;

// Keyed by a normalized model family. Anything unmatched falls back to Opus
// rates (the most expensive common Claude Code model) so cost is not undercounted.
const PRICES = {
  'opus': { in: 5, out: 25 },
  'sonnet': { in: 3, out: 15 },
  'haiku': { in: 1, out: 5 },
  'fable': { in: 10, out: 50 },
  'mythos': { in: 10, out: 50 },
};

const DEFAULT_FAMILY = 'opus';

// Map a raw model id (e.g. "claude-opus-4-8") to a pricing family.
function familyOf(model) {
  if (!model) return DEFAULT_FAMILY;
  const m = String(model).toLowerCase();
  if (m.includes('opus')) return 'opus';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('haiku')) return 'haiku';
  if (m.includes('fable')) return 'fable';
  if (m.includes('mythos')) return 'mythos';
  return DEFAULT_FAMILY;
}

// Short, glanceable label for a model id.
function labelOf(model) {
  if (!model) return 'Unknown';
  const m = String(model).toLowerCase();
  // Pull a "4.8" style version out of "claude-opus-4-8" when present.
  const ver = m.match(/(\d+)-(\d+)/);
  const suffix = ver ? ` ${ver[1]}.${ver[2]}` : '';
  const fam = familyOf(model);
  const nice = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', fable: 'Fable', mythos: 'Mythos' }[fam] || 'Claude';
  return `${nice}${suffix}`;
}

// Cost in USD for a single usage record's token counts.
function costOf(model, usage) {
  const p = PRICES[familyOf(model)] || PRICES[DEFAULT_FAMILY];
  const inputTokens = usage.input_tokens || 0;
  const outputTokens = usage.output_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;

  // Split cache-creation into 5m / 1h buckets when the detailed breakdown is
  // present; otherwise treat the lump `cache_creation_input_tokens` as 5m.
  const cc = usage.cache_creation || {};
  let write5m = cc.ephemeral_5m_input_tokens;
  let write1h = cc.ephemeral_1h_input_tokens;
  if (write5m == null && write1h == null) {
    write5m = usage.cache_creation_input_tokens || 0;
    write1h = 0;
  } else {
    write5m = write5m || 0;
    write1h = write1h || 0;
  }

  const perMillion = (
    inputTokens * p.in +
    outputTokens * p.out +
    cacheRead * p.in * CACHE_READ_MULT +
    write5m * p.in * CACHE_WRITE_5M_MULT +
    write1h * p.in * CACHE_WRITE_1H_MULT
  );
  return perMillion / 1_000_000;
}

module.exports = { familyOf, labelOf, costOf, PRICES };
