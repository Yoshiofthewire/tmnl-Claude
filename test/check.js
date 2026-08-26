'use strict';

// Dependency-free self-check for the usage-API client, normalization, and the
// display model. Run: node test/check.js   (also `npm test`)

const assert = require('assert');
const fmt = require('../src/format');
const { normalize, pickBars, modelName, clampPct, fetchUsage, parseHeader, NOT_AUTHED } = require('../src/usageApi');
const { displayModel } = require('../src/view');
const { render } = require('../src/render');

const SAMPLE_BODY = {
  plan: 'Max',
  bars: [
    { label: 'Current session', pctUsed: 36, resetsText: 'Resets 12:29pm (America/New_York)' },
    { label: 'Current week (all models)', pctUsed: 6, resetsText: 'Resets Jul 21, 8:59am (America/New_York)' },
    { label: 'Current week (Opus)', pctUsed: 12, resetsText: null },
    { label: 'Current week (Fable)', pctUsed: 0, resetsText: null },
  ],
  session: { totalCostUsd: 4.62, apiDuration: '3m 12s', wallDuration: '18m 4s' },
  characteristics: [{ pct: 84, summary: 'usage came from subagent-heavy sessions', detail: '…' }],
  lastUpdatedAt: '2026-07-16T12:00:00.000Z',
  stale: false,
  error: null,
};

// --- formatting ---
assert.strictEqual(fmt.usd(4.62), '$4.62');
assert.strictEqual(fmt.usd(0), '$0.00');
assert.strictEqual(fmt.usd(null), '$0.00');
assert.strictEqual(fmt.usd(150), '$150');
assert.strictEqual(fmt.pct(6), '6%');
assert.strictEqual(fmt.pct(150), '100%');
assert.strictEqual(fmt.pct('x'), '0%');

// --- localizeResets: reset text re-rendered in the configured timezone ---
{
  const now = new Date('2026-07-16T12:00:00Z'); // Jul 16, 8:00am EDT / 9:00pm JST
  const lr = (text, tz) => fmt.localizeResets(text, tz, now);
  // same zone: drops the "(Zone)" suffix
  assert.strictEqual(lr('Resets 12:29pm (America/New_York)', 'America/New_York'), 'Resets 12:29pm');
  // cross zone, same day: 12:29pm EDT = 4:29pm UTC
  assert.strictEqual(lr('Resets 12:29pm (America/New_York)', 'UTC'), 'Resets 4:29pm');
  // explicit date, kept when it isn't today in the target zone
  assert.strictEqual(lr('Resets Jul 21, 8:59am (America/New_York)', 'UTC'), 'Resets Jul 21, 12:59pm');
  // time-only reset that crosses midnight in the target zone gains a date
  assert.strictEqual(lr('Resets 11:30pm (America/New_York)', 'Asia/Tokyo'), 'Resets Jul 17, 12:30pm');
  // explicit date that lands on today in the target zone drops the date
  assert.strictEqual(lr('Resets Jul 16, 8:59am (America/New_York)', 'UTC'), 'Resets 12:59pm');
  // dashboard scraping in UTC (headless browser on a server) -> local time
  assert.strictEqual(lr('Resets 4:29pm (UTC)', 'America/New_York'), 'Resets 12:29pm');
  assert.strictEqual(lr('Resets Jul 21, 12:59pm (UTC)', 'America/New_York'), 'Resets Jul 21, 8:59am');
  assert.strictEqual(lr('Resets 4:29pm (GMT)', 'America/New_York'), 'Resets 12:29pm');
  // no "(Zone)" suffix / unparseable / unknown zone -> unchanged
  assert.strictEqual(lr('Resets 12:29pm', 'UTC'), 'Resets 12:29pm');
  assert.strictEqual(lr('Resets soon', 'UTC'), 'Resets soon');
  assert.strictEqual(lr('Resets 12:29pm (Mars/Olympus)', 'UTC'), 'Resets 12:29pm (Mars/Olympus)');
  assert.strictEqual(lr(null, 'UTC'), null);
}

// --- clampPct / modelName ---
assert.strictEqual(clampPct(150), 100);
assert.strictEqual(clampPct(-5), 0);
assert.strictEqual(clampPct('x'), 0);
assert.strictEqual(clampPct(36.6), 37);
assert.strictEqual(modelName('Current week (Fable)'), 'Fable');
assert.strictEqual(modelName('Current week (Opus)'), 'Opus');

// --- parseHeader ---
assert.deepStrictEqual(parseHeader('Authorization: Bearer abc'), { Authorization: 'Bearer abc' });
assert.deepStrictEqual(parseHeader('X-API-Key: k:e:y'), { 'X-API-Key': 'k:e:y' }); // colon in value
assert.deepStrictEqual(parseHeader(''), {});
assert.deepStrictEqual(parseHeader('nocolon'), {});
assert.deepStrictEqual(parseHeader(undefined), {});

// --- bar classification (label match) ---
{
  const g = pickBars(SAMPLE_BODY.bars);
  assert.strictEqual(g.session.pctUsed, 36, 'session bar');
  assert.strictEqual(g.session.left, 64, 'session left');
  assert.strictEqual(g.week.pctUsed, 6, 'week (all models) bar');
  assert.strictEqual(g.models.length, 2, 'two per-model bars');
  assert.strictEqual(g.models[0].label, 'Opus');
  assert.strictEqual(g.models[0].pctUsed, 12);
}

// --- bar classification (index fallback when labels don't match) ---
{
  const g = pickBars([
    { label: 'A', pctUsed: 10 }, { label: 'B', pctUsed: 20 }, { label: 'C', pctUsed: 30 },
  ]);
  assert.strictEqual(g.session.pctUsed, 10, 'fallback session = bars[0]');
  assert.strictEqual(g.week.pctUsed, 20, 'fallback week = bars[1]');
  assert.strictEqual(g.models.length, 1, 'fallback per-model = rest');
}

// --- normalize ---
{
  const api = normalize(SAMPLE_BODY);
  assert.strictEqual(api.authenticated, true);
  assert.strictEqual(api.plan, 'Max');
  assert.strictEqual(api.session.totalCostUsd, 4.62);
  assert.strictEqual(api.characteristics.length, 1);
  assert.strictEqual(api.gauges.week.pctUsed, 6);
}

// --- normalize: a 200 carrying no bars is a failed scrape, not usable data ---
// The dashboard answers 200 with only {plan, error} when its scrape times out.
// Reporting that as authenticated renders an all-zero screen instead of saying
// what broke (and poisons server.js's last-good cache).
{
  const api = normalize({
    plan: 'Max', lastUpdatedAt: null, stale: false,
    error: 'timed out waiting for expected terminal state',
  });
  assert.strictEqual(api.authenticated, false, 'no bars -> not usable data');
  assert.strictEqual(api.error, 'timed out waiting for expected terminal state');
  const d = displayModel(api, { plan: 'Claude Pro', timezone: 'UTC' });
  assert.strictEqual(d.authenticated, false);
  assert.match(render(api, { timezone: 'UTC' }), /Can't reach the usage dashboard/);
  // an empty bars array is the same failure
  assert.strictEqual(normalize({ plan: 'Max', bars: [] }).authenticated, false);
}

// --- displayModel ---
{
  const d = displayModel(normalize(SAMPLE_BODY), {
    plan: 'Claude Pro', timezone: 'UTC', now: new Date('2026-07-16T12:00:00Z'),
  });
  assert.strictEqual(d.authenticated, true);
  assert.strictEqual(d.plan, 'Claude Max', 'plan from API (Claude + tier)');
  assert.strictEqual(d.session.used_text, '36% used');
  assert.strictEqual(d.session.left_text, '64% left');
  assert.strictEqual(d.session.resets, 'Resets 4:29pm', 'reset time converted to configured tz');
  assert.strictEqual(d.week.resets, 'Resets Jul 21, 12:59pm');
  assert.strictEqual(d.week.pct_used, 6);
  assert.strictEqual(d.has_models, true);
  assert.strictEqual(d.models[0].pct_text, '12%');
  assert.strictEqual(d.session_cost, '$4.62');
  assert.strictEqual(d.api_duration, '3m 12s');
  assert.strictEqual(d.insight.pct, '84%');
  assert.ok(d.insight.summary.length > 0);

  const na = displayModel({ ...NOT_AUTHED }, { plan: 'Claude Pro', timezone: 'UTC' });
  assert.strictEqual(na.authenticated, false);
  assert.strictEqual(na.plan, 'Claude Pro', 'falls back to CLAUDE_PLAN when API has no plan');

  // API plan null -> CLAUDE_PLAN fallback even when authenticated
  const noPlan = displayModel(normalize({ ...SAMPLE_BODY, plan: null }), { plan: 'Claude Pro', timezone: 'UTC' });
  assert.strictEqual(noPlan.plan, 'Claude Pro');
}

// --- fetchUsage: 503 -> not authenticated; 200 -> normalized ---
(async () => {
  const realFetch = global.fetch;
  try {
    global.fetch = async () => ({ status: 503, ok: false });
    const na = await fetchUsage('http://x', 1000);
    assert.strictEqual(na.authenticated, false, '503 -> not authenticated');
    assert.strictEqual(na.error, 'not authenticated');

    global.fetch = async () => ({ status: 200, ok: true, json: async () => SAMPLE_BODY });
    const ok = await fetchUsage('http://x/', 1000);
    assert.strictEqual(ok.authenticated, true, '200 -> authenticated');
    assert.strictEqual(ok.gauges.session.pctUsed, 36);

    // custom poll header is forwarded alongside accept
    let captured = null;
    global.fetch = async (_url, opts) => { captured = opts; return { status: 200, ok: true, json: async () => SAMPLE_BODY }; };
    await fetchUsage('http://x', 1000, { Authorization: 'Bearer T' });
    assert.strictEqual(captured.headers.accept, 'application/json');
    assert.strictEqual(captured.headers.Authorization, 'Bearer T', 'custom header sent');

    global.fetch = async () => ({ status: 502, ok: false });
    await assert.rejects(() => fetchUsage('http://x', 1000), /HTTP 502/, 'non-503 error throws');
  } finally {
    global.fetch = realFetch;
  }
  // eslint-disable-next-line no-console
  console.log('OK — all self-checks passed');
})();
