'use strict';

// Renders the screen to an HTML file using either the live usage API
// (USAGE_API_URL) or a bundled sample body, so you can open it in a browser
// without running the server. Usage: node scripts/preview.js [outFile]

const fs = require('fs');
const path = require('path');
const { render } = require('../src/render');
const { fetchUsage, normalize, parseHeader } = require('../src/usageApi');

// Shape matches the dashboard's GET /api/usage response.
const SAMPLE_BODY = {
  plan: 'Max',
  bars: [
    { label: 'Current session', pctUsed: 36, resetsText: 'Resets 12:29pm (America/New_York)' },
    { label: 'Current week (all models)', pctUsed: 6, resetsText: 'Resets Jul 21, 8:59am (America/New_York)' },
    { label: 'Current week (Opus)', pctUsed: 12, resetsText: null },
    { label: 'Current week (Fable)', pctUsed: 0, resetsText: null },
  ],
  session: { totalCostUsd: 4.62, apiDuration: '3m 12s', wallDuration: '18m 4s' },
  characteristics: [
    { pct: 84, summary: 'usage came from subagent-heavy sessions', detail: '…' },
  ],
  raw: '…',
  lastUpdatedAt: new Date().toISOString(),
  stale: false,
  error: null,
};

async function main() {
  const out = process.argv[2] || path.join(__dirname, '..', 'preview.html');
  const base = (process.env.USAGE_API_URL || '').replace(/\/+$/, '');

  let api;
  try {
    api = base ? await fetchUsage(base, 8000, parseHeader(process.env.USAGE_API_HEADER)) : normalize(SAMPLE_BODY);
  } catch {
    api = normalize(SAMPLE_BODY);
  }

  const html = render(api, {
    plan: process.env.CLAUDE_PLAN || 'Claude Pro',
    timezone: process.env.TZ || 'America/New_York',
    apiUrl: base || 'http://your-dashboard:8080',
  });
  fs.writeFileSync(out, html);
  // eslint-disable-next-line no-console
  console.log('wrote', out);
}

main();
