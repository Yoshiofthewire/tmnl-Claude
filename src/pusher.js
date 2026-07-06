'use strict';

// Pusher worker. Runs on the machine where you use Claude Code. Periodically
// scans ~/.claude/projects and pushes any changed transcript files to the
// ingest server (src/ingest.js) with the shared secret. gzip-compressed.
//
// Run continuously (default) or one-shot with `--once` (for cron/systemd timer).

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { findTranscripts } = require('./usage');

const config = {
  sourceDir: process.env.CLAUDE_PROJECTS_DIR ||
    path.join(os.homedir(), '.claude', 'projects'),
  url: (process.env.INGEST_URL || '').replace(/\/+$/, ''),
  secret: process.env.INGEST_SECRET || process.env.PUSH_SECRET || '',
  intervalSec: Number(process.env.PUSH_INTERVAL) || 120,
  stateFile: process.env.PUSH_STATE ||
    path.join(os.homedir(), '.claude-usage', 'push-state.json'),
  once: process.argv.includes('--once'),
};

function fail(msg) {
  // eslint-disable-next-line no-console
  console.error(msg);
  process.exit(1);
}
if (!config.url) fail('INGEST_URL is required, e.g. https://box.example:2524');
if (!config.secret) fail('INGEST_SECRET (or PUSH_SECRET) is required.');
if (typeof fetch !== 'function') fail('Node 18+ is required (global fetch).');

function loadState() {
  try { return JSON.parse(fs.readFileSync(config.stateFile, 'utf8')); }
  catch { return {}; }
}
function saveState(state) {
  fs.mkdirSync(path.dirname(config.stateFile), { recursive: true });
  fs.writeFileSync(config.stateFile, JSON.stringify(state));
}

async function pushFile(file, rel) {
  const body = zlib.gzipSync(fs.readFileSync(file));
  const res = await fetch(`${config.url}/push`, {
    method: 'POST',
    headers: {
      'x-api-key': config.secret,
      'x-rel-path': rel,
      'content-encoding': 'gzip',
      'content-type': 'application/octet-stream',
    },
    body,
  });
  if (!res.ok) throw new Error(`push failed ${res.status}: ${await res.text().catch(() => '')}`);
}

async function runOnce() {
  const state = loadState();
  const files = findTranscripts(config.sourceDir);
  let pushed = 0;
  let failed = 0;
  for (const file of files) {
    const rel = path.relative(config.sourceDir, file).split(path.sep).join('/');
    let st;
    try { st = fs.statSync(file); } catch { continue; }
    const sig = `${Math.round(st.mtimeMs)}:${st.size}`;
    if (state[rel] === sig) continue; // unchanged since last successful push
    try {
      // eslint-disable-next-line no-await-in-loop
      await pushFile(file, rel);
      state[rel] = sig;
      pushed += 1;
    } catch (err) {
      failed += 1;
      // eslint-disable-next-line no-console
      console.error(`  ! ${rel}: ${err.message}`);
    }
  }
  saveState(state);
  // eslint-disable-next-line no-console
  console.log(`pushed ${pushed} file(s)${failed ? `, ${failed} failed` : ''} of ${files.length} scanned`);
}

async function main() {
  // eslint-disable-next-line no-console
  console.log(`Pusher: ${config.sourceDir} -> ${config.url}` +
    (config.once ? ' (once)' : ` (every ${config.intervalSec}s)`));
  if (config.once) { await runOnce(); return; }
  // Continuous loop; keep going even if a cycle throws.
  for (;;) {
    try { await runOnce(); } // eslint-disable-line no-await-in-loop
    catch (err) { console.error('cycle error:', err.message); } // eslint-disable-line no-console
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, config.intervalSec * 1000));
  }
}

main();
