'use strict';

// Client for the Claude Usage Dashboard API (GET {base}/api/usage). Normalizes
// the panel body into the shape the view/render layers consume. See docs of the
// dashboard for the response contract.

function clampPct(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(100, Math.round(x)));
}

// "Current week (Fable)" -> "Fable"; else strip the "Current week/session" prefix.
function modelName(label) {
  const l = String(label || '');
  const m = l.match(/\(([^)]+)\)/);
  if (m) return m[1].trim();
  return l.replace(/^current\s+(week|session)\s*/i, '').trim() || l;
}

function gaugeFrom(bar, fallbackLabel) {
  if (!bar) return { present: false, label: fallbackLabel, pctUsed: 0, left: 100, resets: null };
  const pct = clampPct(bar.pctUsed);
  return { present: true, label: bar.label || fallbackLabel, pctUsed: pct, left: 100 - pct, resets: bar.resetsText || null };
}

// Classify the panel's bars: first "session" bar, the "week (all models)" bar,
// and any remaining per-model weekly bars. Falls back to positional order.
function pickBars(bars) {
  const list = Array.isArray(bars) ? bars.filter(Boolean) : [];
  const session = list.find((b) => /session/i.test(b.label || '')) || list[0] || null;
  const week =
    list.find((b) => /week/i.test(b.label || '') && /all models/i.test(b.label || '')) ||
    list.find((b) => b !== session) ||
    null;
  const models = list
    .filter((b) => b !== session && b !== week)
    .map((b) => ({ label: modelName(b.label), pctUsed: clampPct(b.pctUsed), resets: b.resetsText || null }));
  return { session: gaugeFrom(session, 'Session'), week: gaugeFrom(week, 'Week'), models };
}

// Normalize a successful /api/usage body into our internal shape.
function normalize(body) {
  const b = body || {};
  const sess = b.session || {};
  return {
    authenticated: true,
    stale: !!b.stale,
    error: b.error || null,
    plan: b.plan || null,
    lastUpdatedAt: b.lastUpdatedAt || null,
    gauges: pickBars(b.bars),
    session: {
      totalCostUsd: typeof sess.totalCostUsd === 'number' ? sess.totalCostUsd : null,
      apiDuration: sess.apiDuration || null,
      wallDuration: sess.wallDuration || null,
    },
    characteristics: Array.isArray(b.characteristics) ? b.characteristics : [],
  };
}

const NOT_AUTHED = {
  authenticated: false, stale: false, error: 'not authenticated', plan: null, lastUpdatedAt: null,
  gauges: { session: gaugeFrom(null, 'Session'), week: gaugeFrom(null, 'Week'), models: [] },
  session: { totalCostUsd: null, apiDuration: null, wallDuration: null },
  characteristics: [],
};

// Fetch + normalize. Returns a normalized object (incl. the not-authenticated
// sentinel on HTTP 503). Throws on timeout, network error, or other non-2xx so
// the caller can fall back to last-good.
// Parse one "Name: Value" header line -> { [name]: value }. Splits on the first
// colon so values may contain colons (Bearer tokens, base64). {} if empty/invalid.
function parseHeader(str) {
  if (!str) return {};
  const s = String(str);
  const i = s.indexOf(':');
  if (i < 1) return {};
  const name = s.slice(0, i).trim();
  const value = s.slice(i + 1).trim();
  if (!name || !value) return {};
  return { [name]: value };
}

async function fetchUsage(baseUrl, timeoutMs = 8000, extraHeaders = {}) {
  if (typeof fetch !== 'function') throw new Error('global fetch unavailable (need Node 18+)');
  const url = String(baseUrl).replace(/\/+$/, '') + '/api/usage';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: 'application/json', ...extraHeaders },
    });
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 503) return { ...NOT_AUTHED };
  if (!res.ok) throw new Error(`usage API returned HTTP ${res.status}`);
  return normalize(await res.json());
}

module.exports = { fetchUsage, normalize, pickBars, modelName, clampPct, parseHeader, NOT_AUTHED };
