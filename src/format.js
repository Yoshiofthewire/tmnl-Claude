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

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// Calendar parts of an instant as seen in a timezone.
function wallParts(d, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
  }).formatToParts(d);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return { y: get('year'), mo: get('month') - 1, d: get('day'), h: get('hour'), mi: get('minute') };
}

// The instant whose wall-clock time in `tz` is y/mo/d h:mi (DST-aware).
function wallTimeToUtc(y, mo, d, h, mi, tz) {
  const target = Date.UTC(y, mo, d, h, mi);
  let t = target;
  for (let i = 0; i < 2; i++) {
    const p = wallParts(new Date(t), tz);
    t += target - Date.UTC(p.y, p.mo, p.d, p.h, p.mi);
  }
  return new Date(t);
}

// Re-render the dashboard's reset text in `tz`, so every time on the screen is
// in one zone: "Resets Jul 21, 8:59am (America/New_York)" -> "Resets 12:59pm"
// (the date is kept only when it isn't today in `tz`). Text without a "(Zone)"
// suffix passes through unchanged — the source zone is unknown.
function localizeResets(text, tz, now = new Date()) {
  if (!text) return text;
  const m = String(text).match(
    /^(.*?)(?:([A-Za-z]{3,9})\s+(\d{1,2}),\s*)?(\d{1,2}):(\d{2})\s*(am|pm)\s*\(([^)]+)\)$/i,
  );
  if (!m) return text;
  const [, prefix, monName, dayStr, hStr, miStr, ampm, srcTz] = m;
  let h = Number(hStr) % 12;
  if (/pm/i.test(ampm)) h += 12;

  let instant;
  try {
    const srcToday = wallParts(now, srcTz);
    let { y, mo, d } = srcToday;
    if (monName) {
      mo = MONTHS.indexOf(monName.slice(0, 3).toLowerCase());
      if (mo < 0) return text;
      d = Number(dayStr);
      // Resets are near-future; around New Year pick the closest year.
      const HALF_YEAR = 183 * 86400e3;
      const gap = Date.UTC(y, mo, d) - Date.UTC(srcToday.y, srcToday.mo, srcToday.d);
      if (gap < -HALF_YEAR) y += 1;
      else if (gap > HALF_YEAR) y -= 1;
    }
    instant = wallTimeToUtc(y, mo, d, h, Number(miStr), srcTz);
  } catch {
    return text; // unrecognized source zone — keep the original
  }

  const time = timeLabel(instant, tz).replace(/\s/g, '').toLowerCase();
  const here = wallParts(instant, tz);
  const today = wallParts(now, tz);
  const sameDay = here.y === today.y && here.mo === today.mo && here.d === today.d;
  const datePart = sameDay ? '' : `${new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', timeZone: tz,
  }).format(instant)}, `;
  return `${prefix}${datePart}${time}`;
}

module.exports = { usd, pct, dateLabel, longDate, timeLabel, localizeResets };
