'use strict';

// Turns raw usage + an optional configured limit into a gauge: used, limit,
// remaining, and percent used. When no limit is configured the baseline is the
// user's personal peak (busiest session / week), flagged `auto` so the UI can
// label it "of peak" rather than implying an official plan quota.

function one(used, limitCfg, peak) {
  const auto = !(limitCfg && limitCfg > 0);
  const peakVal = Math.max(peak || 0, 0);
  const limit = auto ? Math.max(peakVal, used, 1) : limitCfg;
  const remaining = Math.max(0, limit - used);
  const pctUsed = Math.min(100, Math.round((used / limit) * 100));
  // In auto mode, "record" means the current period is your busiest ever, so a
  // "remaining" figure would be a misleading zero.
  const record = auto && used > 0 && used >= peakVal;
  return { used, limit, remaining, pctUsed, auto, record };
}

// Foot text for a gauge: real "left" when a limit is configured, otherwise a
// peak-relative reading that degrades gracefully on record periods.
function gaugeText(g, fmt) {
  if (!g.auto) {
    return { remaining: `${fmt.tokens(g.remaining)} left`, pct: `${g.pctUsed}% used` };
  }
  return {
    remaining: g.record ? 'at your peak' : `${fmt.tokens(g.remaining)} left`,
    pct: `${g.pctUsed}% of peak`,
  };
}

function buildGauges(data, opts = {}) {
  const s = data.session || {};
  const w = data.week || {};
  const session = one(s.tokens || 0, opts.sessionLimit, s.maxTokens || 0);
  session.active = !!s.active;
  session.remainingMs = s.remainingMs || 0;
  const week = one(w.totalTokens || 0, opts.weekLimit, w.peakTokens || 0);
  return { session, week };
}

module.exports = { buildGauges, one, gaugeText };
