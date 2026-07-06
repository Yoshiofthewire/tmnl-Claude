'use strict';

// Compact token count: 97K, 1.9M, 507M, 1.2B.
function tokens(n) {
  n = n || 0;
  if (n < 1000) return String(n);
  if (n < 1_000_000) return trim(n / 1000) + 'K';
  if (n < 1_000_000_000) return trim(n / 1_000_000) + 'M';
  return trim(n / 1_000_000_000) + 'B';
}

function trim(x) {
  // 1 decimal below 100, whole numbers above.
  if (x >= 100) return String(Math.round(x));
  const r = Math.round(x * 10) / 10;
  return (r % 1 === 0) ? String(r) : r.toFixed(1);
}

// USD: $44.43 under 100, $321 above.
function usd(n) {
  n = n || 0;
  if (n >= 100) return '$' + Math.round(n).toLocaleString('en-US');
  return '$' + n.toFixed(2);
}

// Plain integer with thousands separators.
function count(n) {
  return (n || 0).toLocaleString('en-US');
}

// "Wed, Jul 5" for a date in a given timezone.
function dateLabel(d, tz) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: tz,
  }).format(d);
}

// "Sunday, July 5" for a date in a given timezone.
function longDate(d, tz) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: tz,
  }).format(d);
}

// "8:42 PM" for a date in a given timezone.
function timeLabel(d, tz) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: tz,
  }).format(d);
}

// Milliseconds -> "2h 14m" / "48m" / "now".
function durationShort(ms) {
  if (!ms || ms <= 0) return 'now';
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

// Milliseconds -> "2d 14h" / "14h 3m" / "40m" / "now" (for multi-day countdowns).
function durationLong(ms) {
  if (!ms || ms <= 0) return 'now';
  const mins = Math.floor(ms / 60000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

const DOW = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const DOW_LABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Parse a weekly reset like "tue 9", "Tuesday 09:00", "tue 9am" -> {dow, hour}.
function parseWeekReset(s) {
  if (!s) return null;
  const m = String(s).trim().toLowerCase()
    .match(/^([a-z]{3,})[\s,]+(\d{1,2})(?::\d{2})?\s*(am|pm)?$/);
  if (!m) return null;
  const dow = DOW[m[1].slice(0, 3)];
  if (dow == null) return null;
  let hour = parseInt(m[2], 10);
  if (m[3] === 'pm' && hour < 12) hour += 12;
  if (m[3] === 'am' && hour === 12) hour = 0;
  if (hour < 0 || hour > 23) return null;
  return { dow, hour };
}

// "Tue 9 AM" label for a {dow, hour} reset.
function weekResetLabel(reset) {
  if (!reset) return '';
  const h12 = reset.hour % 12 === 0 ? 12 : reset.hour % 12;
  const ap = reset.hour < 12 ? 'AM' : 'PM';
  return `${DOW_LABEL[reset.dow]} ${h12} ${ap}`;
}

// Parse a limit like "50m", "2.5m", "500k", "2b", or a plain number of tokens.
function parseLimit(s) {
  if (s == null || s === '') return null;
  const m = String(s).trim().toLowerCase().match(/^([\d.]+)\s*([kmb]?)$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (isNaN(n)) return null;
  const mult = { '': 1, k: 1e3, m: 1e6, b: 1e9 }[m[2]];
  return Math.round(n * mult);
}

module.exports = {
  tokens, usd, count, dateLabel, longDate, timeLabel,
  durationShort, durationLong, parseLimit, parseWeekReset, weekResetLabel,
};
