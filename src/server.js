'use strict';

const http = require('http');
const path = require('path');
const { fetchUsage, parseHeader, NOT_AUTHED } = require('./usageApi');
const { render } = require('./render');
const { displayModel } = require('./view');

// Load .env (local dev convenience). systemd/real env vars still win; missing
// file is fine.
try { process.loadEnvFile(path.join(process.cwd(), '.env')); } catch { /* no .env */ }

const config = {
  port: Number(process.env.PORT) || 2523,
  host: process.env.HOST || '0.0.0.0',
  plan: process.env.CLAUDE_PLAN || 'Claude Pro',
  timezone: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
  usageApiUrl: (process.env.USAGE_API_URL || '').replace(/\/+$/, ''),
  apiTimeoutMs: Number(process.env.USAGE_API_TIMEOUT) || 8000,
  // Optional auth/access header sent when polling the usage API ("Name: Value").
  apiHeaders: parseHeader(process.env.USAGE_API_HEADER),
};

if (!config.usageApiUrl) {
  // eslint-disable-next-line no-console
  console.error('USAGE_API_URL is required (e.g. http://your-dashboard:8080). Set it in .env or the environment.');
  process.exit(1);
}

function viewOpts() {
  return { plan: config.plan, timezone: config.timezone, apiUrl: config.usageApiUrl };
}

// Last successful authenticated scrape, so a transient API blip shows stale data
// rather than a blank screen.
let lastGood = null;

async function buildData() {
  try {
    const api = await fetchUsage(config.usageApiUrl, config.apiTimeoutMs, config.apiHeaders);
    if (api.authenticated) lastGood = api;
    return api; // authenticated data, or the not-authenticated sentinel (503)
  } catch (err) {
    if (lastGood) return { ...lastGood, stale: true, error: err.message };
    return { ...NOT_AUTHED, error: err.message }; // unreachable, nothing cached yet
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const api = await buildData();
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, must-revalidate',
      });
      res.end(render(api, viewOpts()));
      return;
    }
    if (url.pathname === '/data.json') {
      const api = await buildData();
      const out = { ...api, display: displayModel(api, viewOpts()) };
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, must-revalidate',
      });
      res.end(JSON.stringify(out, null, 2));
      return;
    }
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('request error:', err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal error');
  }
});

server.listen(config.port, config.host, () => {
  // eslint-disable-next-line no-console
  console.log(`Claude Code Usage plugin listening on http://${config.host}:${config.port}`);
  // eslint-disable-next-line no-console
  console.log(`  screen   -> /`);
  // eslint-disable-next-line no-console
  console.log(`  raw data -> /data.json`);
  // eslint-disable-next-line no-console
  console.log(`  pulling  -> ${config.usageApiUrl}/api/usage`);
});
