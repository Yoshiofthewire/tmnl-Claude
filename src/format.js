'use strict';

// USD: $44.43 under 100, $321 above. null -> "$0.00".
function usd(n) {
  if (n == null || !Number.isFinite(Number(n))) return '$0.00';
  n = Number(n);
  if (n >= 100) return '$' + Math.round(n).toLocaleString('en-US');
  return '$' + n.toFixed(2);
}

// Whole-number percent string, clamped 0-100.
function pct(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '0%';
  return `${Math.max(0, Math.min(100, Math.round(x)))}%`;
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

module.exports = { usd, pct, dateLabel, longDate, timeLabel };
