'use strict';

// Dependency-free self-check for the cost math and the log aggregation.
// Run: node test/check.js   (also `npm test`)

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { costOf, familyOf } = require('../src/pricing');
const { aggregate } = require('../src/usage');
const { buildGauges } = require('../src/gauge');
const { safeTarget } = require('../src/safepath');
const fmt = require('../src/format');

// --- ingest path sanitization (security-critical) ---
{
  const base = path.join(path.sep, 'tmp', 'recv');
  assert.strictEqual(safeTarget(base, 'proj/a.jsonl'), path.join(base, 'proj', 'a.jsonl'));
  assert.strictEqual(safeTarget(base, '/abs/x.jsonl'), path.join(base, 'abs', 'x.jsonl')); // contained
  assert.strictEqual(safeTarget(base, '../../etc/evil.jsonl'), null); // traversal
  assert.strictEqual(safeTarget(base, 'proj/a.txt'), null); // wrong ext
  assert.strictEqual(safeTarget(base, ''), null);
  assert.strictEqual(safeTarget(base, undefined), null);
}

// --- pricing: every token bucket at 1M, Opus rates (in 5 / out 25) ---
// 5 + 25 + read(1M*5*0.10=0.5) + write5m(1M*5*1.25=6.25) + write1h(1M*5*2=10) = 46.75
{
  const cost = costOf('claude-opus-4-8', {
    input_tokens: 1_000_000,
    output_tokens: 1_000_000,
    cache_read_input_tokens: 1_000_000,
    cache_creation: {
      ephemeral_5m_input_tokens: 1_000_000,
      ephemeral_1h_input_tokens: 1_000_000,
    },
  });
  assert.strictEqual(Number(cost.toFixed(4)), 46.75, `pricing: got ${cost}`);
  assert.strictEqual(familyOf('claude-sonnet-4-6'), 'sonnet');
  assert.strictEqual(familyOf('weird-unknown'), 'opus'); // safe fallback
}

// --- formatting ---
assert.strictEqual(fmt.tokens(97059), '97.1K');
assert.strictEqual(fmt.tokens(35_956_773), '36M');
assert.strictEqual(fmt.usd(44.4284), '$44.43');
assert.strictEqual(fmt.usd(320.9), '$321');
assert.strictEqual(fmt.durationShort(2 * 3600e3 + 14 * 60e3), '2h 14m');
assert.strictEqual(fmt.durationShort(48 * 60e3), '48m');
assert.strictEqual(fmt.durationLong(2 * 86400e3 + 4 * 3600e3), '2d 4h');
assert.strictEqual(fmt.durationLong(90 * 60e3), '1h 30m');
assert.deepStrictEqual(fmt.parseWeekReset('Tue 9am'), { dow: 2, hour: 9 });
assert.deepStrictEqual(fmt.parseWeekReset('tuesday 09:00'), { dow: 2, hour: 9 });
assert.deepStrictEqual(fmt.parseWeekReset('mon 5pm'), { dow: 1, hour: 17 });
assert.strictEqual(fmt.parseWeekReset('garbage'), null);
assert.strictEqual(fmt.parseLimit('50m'), 50_000_000);
assert.strictEqual(fmt.parseLimit('500k'), 500_000);
assert.strictEqual(fmt.parseLimit('2b'), 2_000_000_000);
assert.strictEqual(fmt.parseLimit('1000'), 1000);
assert.strictEqual(fmt.parseLimit(''), null);

// --- aggregation over a synthetic log tree ---
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-usage-'));
  const proj = path.join(dir, 'projects', '-demo');
  fs.mkdirSync(proj, { recursive: true });

  // Local noon on a given calendar day, so dayKey() is timezone-stable.
  const noon = (y, m, d) => new Date(y, m - 1, d, 12, 0, 0).toISOString();
  const asst = (ts, req, id, sid, input) => JSON.stringify({
    type: 'assistant', timestamp: ts, requestId: req, sessionId: sid,
    message: { id, model: 'claude-opus-4-8', usage: { input_tokens: input, output_tokens: 0 } },
  });
  const user = (ts, sid) => JSON.stringify({ type: 'user', timestamp: ts, sessionId: sid });

  const lines = [
    // today (Jul 5): msg1, an exact retry of msg1 (must dedupe), msg2, one user turn
    asst(noon(2026, 7, 5), 'R1', 'M1', 'A', 1_000_000),
    asst(noon(2026, 7, 5), 'R1', 'M1', 'A', 1_000_000), // duplicate -> ignored
    asst(noon(2026, 7, 5), 'R2', 'M2', 'A', 1_000_000),
    user(noon(2026, 7, 5), 'B'),
    // yesterday + day before -> 3-day streak, both inside the 7-day week
    asst(noon(2026, 7, 4), 'R3', 'M3', 'C', 1_000_000),
    asst(noon(2026, 7, 3), 'R4', 'M4', 'D', 1_000_000),
    // outside the rolling week -> excluded from week totals
    asst(noon(2026, 6, 25), 'R9', 'M9', 'Z', 1_000_000),
  ];
  fs.writeFileSync(path.join(proj, 's.jsonl'), lines.join('\n') + '\n');

  const NOW = new Date(2026, 6, 5, 12, 0, 0); // Sunday, Jul 5 2026, noon local
  return aggregate(path.join(dir, 'projects'), NOW).then(async (d) => {
    // today
    assert.strictEqual(d.today.messages, 2, 'today.messages (dedup applied)');
    assert.strictEqual(d.today.sessions, 2, 'today.sessions (A + B)');
    assert.strictEqual(d.today.input, 2_000_000, 'today.input');
    assert.strictEqual(d.today.totalTokens, 2_000_000, 'today.totalTokens');
    assert.strictEqual(Number(d.today.cost.toFixed(2)), 10, 'today.cost'); // 2 * 5
    // week (rolling 7 days: Jul 5,4,3 in; Jun 25 out)
    assert.strictEqual(d.week.daysInARow, 3, 'week.daysInARow');
    assert.strictEqual(d.week.sessions, 4, 'week.sessions (A,B,C,D)');
    assert.strictEqual(d.week.input, 4_000_000, 'week.input excludes Jun 25');
    assert.strictEqual(d.week.messages, 4, 'week.messages');

    // session: today's two assistant events form the active 5h block
    assert.strictEqual(d.session.active, true, 'session.active');
    assert.strictEqual(d.session.tokens, 2_000_000, 'session.tokens (dedup applied)');
    assert.strictEqual(d.session.messages, 2, 'session.messages');
    assert.strictEqual(d.session.maxTokens, 2_000_000, 'session.maxTokens (peak block)');

    // week peak = busiest 7-day window (Jul 3-5 = 4M), which equals current week
    assert.strictEqual(d.week.peakTokens, 4_000_000, 'week.peakTokens');

    // auto gauges: current session & week are the peak -> "record"
    const auto = buildGauges(d, {});
    assert.strictEqual(auto.session.auto, true, 'session gauge auto');
    assert.strictEqual(auto.session.record, true, 'session gauge record');
    assert.strictEqual(auto.week.record, true, 'week gauge record');

    // configured limit: real remaining + percentage
    const cfg = buildGauges(d, { sessionLimit: 10_000_000 });
    assert.strictEqual(cfg.session.auto, false, 'configured gauge not auto');
    assert.strictEqual(cfg.session.remaining, 8_000_000, 'configured remaining');
    assert.strictEqual(cfg.session.pctUsed, 20, 'configured pctUsed');

    // anchored weekly reset (Tue 9am): window since last Tue, next reset next Tue
    const d2 = await aggregate(path.join(dir, 'projects'), NOW, { weekReset: { dow: 2, hour: 9 } });
    assert.strictEqual(d2.week.anchored, true, 'week anchored');
    assert.strictEqual(d2.week.input, 4_000_000, 'anchored week total (Jul 3-5)');
    const reset = new Date(d2.week.resetsAt);
    assert.strictEqual(reset.getDay(), 2, 'reset lands on Tuesday');
    assert.strictEqual(reset.getHours(), 9, 'reset at 9am');
    assert.ok(reset.getTime() > NOW.getTime(), 'reset is in the future');
    assert.ok(d2.week.remainingMs > 0, 'week remainingMs positive');

    fs.rmSync(dir, { recursive: true, force: true });
    console.log('OK — all self-checks passed');
  });
}
