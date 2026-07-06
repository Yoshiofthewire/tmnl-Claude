'use strict';

// Builds a flat, pre-formatted "display" model from aggregated usage. Both the
// self-rendered HTML and the TRMNL Liquid template consume these strings, so
// number formatting lives in exactly one place (format.js).

const fmt = require('./format');
const { buildGauges, gaugeText } = require('./gauge');

const FILLS = ['#111111', '#7d7d7d', '#c4c4c4', '#e0e0e0'];

function gaugeView(g) {
  const txt = gaugeText(g, fmt);
  return {
    pct_used: g.pctUsed,
    remaining_text: txt.remaining,
    pct_text: txt.pct,
  };
}

function displayModel(data, opts = {}) {
  const tz = opts.timezone || process.env.TZ || 'UTC';
  const gen = new Date(data.generatedAt);
  const t = data.today;
  const w = data.week;
  const s = data.session || {};
  const g = buildGauges(data, opts);
  const weekMeta = w.anchored ? `resets in ${fmt.durationLong(w.remainingMs)}` : 'rolling 7 days';

  const total = (w.models || []).reduce((s, m) => s + m.tokens, 0) || 1;
  const models = (w.models || []).slice(0, 4).map((m, i) => {
    const pct = (m.tokens / total) * 100;
    return {
      label: m.label,
      tokens: fmt.tokens(m.tokens),
      cost: fmt.usd(m.cost),
      pct: Math.round(pct),
      width: Number(pct.toFixed(2)),
      fill: FILLS[i] || FILLS[FILLS.length - 1],
      dark: i === 0,
      show_pct: pct >= 9,
    };
  });

  return {
    plan: opts.plan || 'Claude',
    long_date: fmt.longDate(gen, tz),
    updated_time: fmt.timeLabel(gen, tz),
    updated_date: fmt.dateLabel(gen, tz),
    session_meta: s.active ? `resets in ${fmt.durationShort(s.remainingMs)}` : 'no active session',
    week_meta: weekMeta,
    session: gaugeView(g.session),
    week_gauge: gaugeView(g.week),
    today: {
      total_tokens: fmt.tokens(t.totalTokens),
      cost: fmt.usd(t.cost),
      input: fmt.tokens(t.input),
      output: fmt.tokens(t.output),
      sessions: fmt.count(t.sessions),
      messages: fmt.count(t.messages),
    },
    week: {
      total_tokens: fmt.tokens(w.totalTokens),
      cost: fmt.usd(w.cost),
      sessions: fmt.count(w.sessions),
      days_in_a_row: w.daysInARow,
      streak_label: w.daysInARow + (w.daysInARow === 1 ? ' day' : ' days'),
    },
    models,
  };
}

module.exports = { displayModel };
