'use strict';

const http = require('http');
const os = require('os');
const path = require('path');
const { aggregate } = require('./usage');
const { render } = require('./render');
const { displayModel } = require('./view');
const { parseLimit, parseWeekReset } = require('./format');

const config = {
  port: Number(process.env.PORT) || 2523,
  host: process.env.HOST || '0.0.0.0',
  projectsDir: process.env.CLAUDE_PROJECTS_DIR ||
    path.join(os.homedir(), '.claude', 'projects'),
  plan: process.env.CLAUDE_PLAN || 'Claude Pro',
  // Use the process timezone so display and the weekly-reset anchor always agree.
  timezone: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
  sessionLimit: parseLimit(process.env.SESSION_LIMIT),
  weekLimit: parseLimit(process.env.WEEK_LIMIT),
  // Anchored weekly reset, e.g. "Tue 9am". Falls back to a rolling 7-day window.
  weekReset: parseWeekReset(process.env.WEEK_RESET),
};

// Options passed to the renderer / view model on each request.
function viewOpts() {
  return {
    plan: config.plan,
    timezone: config.timezone,
    sessionLimit: config.sessionLimit,
    weekLimit: config.weekLimit,
  };
}

async function buildData() {
  return aggregate(config.projectsDir, new Date(), { weekReset: config.weekReset });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const data = await buildData();
      const html = render(data, viewOpts());
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        // TRMNL re-fetches on its own cadence; never serve a stale cache.
        'Cache-Control': 'no-store, must-revalidate',
      });
      res.end(html);
      return;
    }
    if (url.pathname === '/data.json') {
      const data = await buildData();
      // `display` holds pre-formatted strings for the TRMNL Liquid template.
      data.display = displayModel(data, viewOpts());
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, must-revalidate',
      });
      res.end(JSON.stringify(data, null, 2));
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
  console.log(`  reading  -> ${config.projectsDir}`);
});
