'use strict';

// Builds a flat, pre-formatted "display" model from a normalized usage-API
// object (see src/usageApi.js). Both the self-rendered HTML and the TRMNL Liquid
// template consume these strings, so formatting lives in one place (format.js).

const fmt = require('./format');

function gaugeView(g) {
  return {
    present: !!g.present,
    pct_used: g.pctUsed,
    pct_left: g.left,
    used_text: `${g.pctUsed}% used`,
    left_text: `${g.left}% left`,
    resets: g.resets || '',
  };
}

function displayModel(api, opts = {}) {
  const tz = opts.timezone || process.env.TZ || 'UTC';
  const now = opts.now || new Date();
  const updated = api.lastUpdatedAt ? new Date(api.lastUpdatedAt) : null;

  const models = (api.gauges.models || []).slice(0, 4).map((m) => ({
    label: m.label,
    pct: m.pctUsed,
    width: m.pctUsed,
    pct_text: fmt.pct(m.pctUsed),
    resets: m.resets || '',
  }));

  const c = (api.characteristics || [])[0];
  const insight = c
    ? { pct: typeof c.pct === 'number' ? fmt.pct(c.pct) : '', summary: c.summary || '' }
    : null;

  return {
    authenticated: !!api.authenticated,
    stale: !!api.stale,
    error: api.error || null,
    // Plan comes from the API (/settings-recorded tier). CLAUDE_PLAN is a fallback.
    plan: api.plan ? `Claude ${api.plan}` : (opts.plan || 'Claude'),
    api_url: opts.apiUrl || '',
    long_date: fmt.longDate(now, tz),
    updated_time: updated ? fmt.timeLabel(updated, tz) : '—',
    updated_date: updated ? fmt.dateLabel(updated, tz) : '',
    session: gaugeView(api.gauges.session),
    week: gaugeView(api.gauges.week),
    models,
    has_models: models.length > 0,
    session_cost: fmt.usd(api.session.totalCostUsd),
    api_duration: api.session.apiDuration || '—',
    wall_duration: api.session.wallDuration || '—',
    insight,
  };
}

module.exports = { displayModel };
