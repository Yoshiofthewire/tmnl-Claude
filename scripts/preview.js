'use strict';

// Renders the screen to an HTML file using either live Claude Code data or a
// bundled sample, so you can open it in a browser without running the server.
// Usage: node scripts/preview.js [outFile]

const fs = require('fs');
const os = require('os');
const path = require('path');
const { aggregate } = require('../src/usage');
const { render } = require('../src/render');
const { parseLimit, parseWeekReset } = require('../src/format');

const SAMPLE = {
  generatedAt: new Date().toISOString(),
  session: {
    active: true, tokens: 8500000, cost: 11.2, messages: 118,
    startsAt: new Date(Date.now() - 2.75 * 3600e3).toISOString(),
    resetsAt: new Date(Date.now() + 2.25 * 3600e3).toISOString(),
    remainingMs: 2.25 * 3600e3, maxTokens: 13800000,
  },
  today: {
    input: 97059, output: 362900, cacheRead: 33611488, cacheWrite: 1885326,
    totalTokens: 35956773, cost: 44.43, sessions: 15, messages: 499,
    userMessages: 631,
    models: [{ family: 'opus', label: 'Opus 4.8', tokens: 35956773, cost: 44.43 }],
  },
  week: {
    totalTokens: 547600980, input: 286934, output: 1820886, cost: 344.9,
    sessions: 35, messages: 2562, daysInARow: 3, peakTokens: 640000000,
    anchored: true, remainingMs: 2 * 86400e3 + 4 * 3600e3,
    resetsAt: new Date(Date.now() + 2 * 86400e3 + 4 * 3600e3).toISOString(),
    models: [
      { family: 'sonnet', label: 'Sonnet 4.6', tokens: 375936937, cost: 160.2 },
      { family: 'opus', label: 'Opus 4.8', tokens: 87309300, cost: 94.17 },
      { family: 'fable', label: 'Fable 5', tokens: 44256011, cost: 66.55 },
    ],
  },
};

async function main() {
  const out = process.argv[2] || path.join(__dirname, '..', 'preview.html');
  const projectsDir = process.env.CLAUDE_PROJECTS_DIR ||
    path.join(os.homedir(), '.claude', 'projects');

  let data;
  try {
    data = await aggregate(projectsDir, new Date(), { weekReset: parseWeekReset(process.env.WEEK_RESET) });
    if (!data.today.totalTokens && !data.week.totalTokens) data = SAMPLE;
  } catch {
    data = SAMPLE;
  }

  const html = render(data, {
    plan: process.env.CLAUDE_PLAN || 'Claude Pro',
    timezone: process.env.TZ || 'America/Los_Angeles',
    sessionLimit: parseLimit(process.env.SESSION_LIMIT),
    weekLimit: parseLimit(process.env.WEEK_LIMIT),
  });
  fs.writeFileSync(out, html);
  // eslint-disable-next-line no-console
  console.log('wrote', out);
}

main();
