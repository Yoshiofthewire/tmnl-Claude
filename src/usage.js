'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { familyOf, labelOf, costOf } = require('./pricing');

// Local-time YYYY-MM-DD key for a Date.
function dayKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function emptyBucket() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    assistantMsgs: 0,
    userMsgs: 0,
    sessions: new Set(),
    models: new Map(), // family -> { tokens, cost, label }
  };
}

function addToBucket(b, model, usage, cost) {
  const input = usage.input_tokens || 0;
  const output = usage.output_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const cacheWrite = usage.cache_creation_input_tokens || 0;
  b.input += input;
  b.output += output;
  b.cacheRead += cacheRead;
  b.cacheWrite += cacheWrite;
  b.cost += cost;

  const fam = familyOf(model);
  let entry = b.models.get(fam);
  if (!entry) {
    entry = { tokens: 0, cost: 0, label: labelOf(model) };
    b.models.set(fam, entry);
  }
  entry.tokens += input + output + cacheRead + cacheWrite;
  entry.cost += cost;
}

function bucketTotals(b) {
  return b.input + b.output + b.cacheRead + b.cacheWrite;
}

// Find every Claude Code transcript JSONL under the projects dir.
function findTranscripts(projectsDir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(projectsDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(projectsDir, e.name);
    if (e.isDirectory()) {
      out.push(...findTranscripts(p));
    } else if (e.isFile() && e.name.endsWith('.jsonl')) {
      out.push(p);
    }
  }
  return out;
}

async function scanFile(file, onRecord) {
  const stream = fs.createReadStream(file, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    onRecord(rec);
  }
}

// Aggregate all usage into today / week / all-time views.
// `now` lets tests pin the clock; defaults to real time.
const FIVE_HOURS = 5 * 60 * 60 * 1000;

// Group assistant events into Claude's 5-hour "session" blocks (a block starts
// at the first event, floored to the hour, and spans 5h; a >5h gap starts a new
// one). Returns the currently-active block plus the largest block ever seen.
function computeSession(events, now) {
  const evs = events.slice().sort((a, b) => a.t - b.t);
  const blocks = [];
  let cur = null;
  for (const e of evs) {
    if (!cur || e.t - cur.start >= FIVE_HOURS || e.t - cur.lastT >= FIVE_HOURS) {
      const d = new Date(e.t);
      d.setMinutes(0, 0, 0); // floor to the hour
      cur = { start: d.getTime(), lastT: e.t, tokens: 0, cost: 0, msgs: 0 };
      blocks.push(cur);
    }
    cur.tokens += e.tokens;
    cur.cost += e.cost;
    cur.msgs += 1;
    cur.lastT = e.t;
  }
  const maxTokens = blocks.reduce((m, b) => Math.max(m, b.tokens), 0);
  const last = blocks[blocks.length - 1];
  const nowMs = now.getTime();
  if (last && nowMs - last.start < FIVE_HOURS) {
    const resetsAt = last.start + FIVE_HOURS;
    return {
      active: true,
      tokens: last.tokens,
      cost: last.cost,
      messages: last.msgs,
      startsAt: new Date(last.start).toISOString(),
      resetsAt: new Date(resetsAt).toISOString(),
      remainingMs: Math.max(0, resetsAt - nowMs),
      maxTokens,
    };
  }
  return {
    active: false, tokens: 0, cost: 0, messages: 0,
    startsAt: null, resetsAt: null, remainingMs: 0, maxTokens,
  };
}

// Largest total-token sum over any 7-calendar-day window (a "personal peak"
// baseline for the weekly gauge when no explicit limit is configured).
function weekPeakTokens(byDay) {
  const tok = new Map();
  for (const [k, b] of byDay) tok.set(k, b.input + b.output + b.cacheRead + b.cacheWrite);
  let max = 0;
  for (const endKey of tok.keys()) {
    const end = new Date(endKey + 'T00:00:00');
    let sum = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(end);
      d.setDate(d.getDate() - i);
      sum += tok.get(dayKey(d)) || 0;
    }
    if (sum > max) max = sum;
  }
  return max;
}

// The current weekly window. With an anchored reset (e.g. Tuesday 9 AM) it runs
// from the most recent reset to now, with a real next-reset time. Without one it
// falls back to a rolling 7 days (no reset countdown).
function weekWindow(now, reset) {
  const DAY = 86400000;
  if (!reset) return { start: now.getTime() - 7 * DAY, resetsAt: null };
  const d = new Date(now);
  d.setHours(reset.hour, 0, 0, 0);
  const back = (d.getDay() - reset.dow + 7) % 7;
  d.setDate(d.getDate() - back);
  if (d.getTime() > now.getTime()) d.setDate(d.getDate() - 7); // reset hour not reached yet today
  const start = d.getTime();
  return { start, resetsAt: start + 7 * DAY };
}

async function aggregate(projectsDir, now = new Date(), opts = {}) {
  const files = findTranscripts(projectsDir);

  const byDay = new Map(); // dayKey -> bucket
  const seen = new Set();  // dedup key -> avoid double counting retries
  const activeDays = new Set();
  const events = [];       // per assistant message: { t, tokens, cost }
  const week = emptyBucket();
  const { start: weekStart, resetsAt: weekResetsAt } = weekWindow(now, opts.weekReset);

  const getDay = (key) => {
    let b = byDay.get(key);
    if (!b) { b = emptyBucket(); byDay.set(key, b); }
    return b;
  };

  for (const file of files) {
    // eslint-disable-next-line no-await-in-loop
    await scanFile(file, (rec) => {
      const ts = rec.timestamp ? new Date(rec.timestamp) : null;
      if (!ts || isNaN(ts)) return;
      const tsMs = ts.getTime();
      const inWeek = tsMs >= weekStart;
      const key = dayKey(ts);
      const sid = rec.sessionId || 'unknown';

      if (rec.type === 'user') {
        const b = getDay(key);
        b.userMsgs += 1;
        b.sessions.add(sid);
        activeDays.add(key);
        if (inWeek) { week.userMsgs += 1; week.sessions.add(sid); }
        return;
      }
      if (rec.type !== 'assistant') return;

      const msg = rec.message || {};
      const usage = msg.usage;
      if (!usage) return;

      // Dedup identical assistant messages (retries share requestId + message id).
      const dedup = `${rec.requestId || ''}:${msg.id || ''}`;
      if (dedup !== ':' && seen.has(dedup)) return;
      if (dedup !== ':') seen.add(dedup);

      const cost = costOf(msg.model, usage);
      const b = getDay(key);
      b.assistantMsgs += 1;
      b.sessions.add(sid);
      activeDays.add(key);
      addToBucket(b, msg.model, usage, cost);

      const msgTokens = (usage.input_tokens || 0) + (usage.output_tokens || 0) +
        (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
      events.push({ t: tsMs, tokens: msgTokens, cost });

      if (inWeek) {
        week.assistantMsgs += 1;
        week.sessions.add(sid);
        addToBucket(week, msg.model, usage, cost);
      }
    });
  }

  // --- Today ---
  const todayKey = dayKey(now);
  const today = byDay.get(todayKey) || emptyBucket();

  // --- Streak: consecutive active days ending today (or yesterday if today is
  // still empty), counted backwards. ---
  let streak = 0;
  {
    const cursor = new Date(now);
    if (!activeDays.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
    while (activeDays.has(dayKey(cursor))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
  }

  const modelList = (bucket) =>
    [...bucket.models.entries()]
      .map(([fam, e]) => ({ family: fam, label: e.label, tokens: e.tokens, cost: e.cost }))
      .sort((a, b) => b.tokens - a.tokens);

  const session = computeSession(events, now);
  const weekPeak = weekPeakTokens(byDay);

  return {
    generatedAt: now.toISOString(),
    session,
    today: {
      input: today.input,
      output: today.output,
      cacheRead: today.cacheRead,
      cacheWrite: today.cacheWrite,
      totalTokens: bucketTotals(today),
      cost: today.cost,
      sessions: today.sessions.size,
      messages: today.assistantMsgs,
      userMessages: today.userMsgs,
      models: modelList(today),
    },
    week: {
      totalTokens: bucketTotals(week),
      input: week.input,
      output: week.output,
      cost: week.cost,
      sessions: week.sessions.size,
      messages: week.assistantMsgs,
      daysInARow: streak,
      peakTokens: weekPeak,
      anchored: !!opts.weekReset,
      resetsAt: weekResetsAt ? new Date(weekResetsAt).toISOString() : null,
      remainingMs: weekResetsAt ? Math.max(0, weekResetsAt - now.getTime()) : 0,
      models: modelList(week),
    },
  };
}

module.exports = { aggregate, findTranscripts, dayKey };
