'use strict';

// Log-ingest server. Runs on the always-on box; the pusher (src/pusher.js) on
// your PC POSTs Claude Code transcript files here, authenticated with a shared
// secret. Received files are mirrored under INGEST_DIR, which the display
// server then reads via CLAUDE_PROJECTS_DIR.

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { safeTarget } = require('./safepath');

const config = {
  port: Number(process.env.INGEST_PORT) || 2524,
  host: process.env.INGEST_HOST || '0.0.0.0',
  secret: process.env.INGEST_SECRET || '',
  dir: process.env.INGEST_DIR || path.join(os.homedir(), '.claude-usage', 'received'),
  maxBytes: Number(process.env.INGEST_MAX_BYTES) || 128 * 1024 * 1024, // 128 MB/file
};

if (!config.secret) {
  // eslint-disable-next-line no-console
  console.error('INGEST_SECRET is required. Generate one with: openssl rand -hex 32');
  process.exit(1);
}
const SECRET = Buffer.from(config.secret);
const BASE = path.resolve(config.dir);
fs.mkdirSync(BASE, { recursive: true });

// Constant-time key comparison.
function validKey(provided) {
  const a = Buffer.from(provided || '');
  if (a.length !== SECRET.length) return false;
  return crypto.timingSafeEqual(a, SECRET);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('too large'), { code: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  if (req.method !== 'POST' || url.pathname !== '/push') {
    json(res, 404, { error: 'not found' });
    return;
  }

  if (!validKey(req.headers['x-api-key'])) {
    json(res, 401, { error: 'unauthorized' });
    return;
  }

  const target = safeTarget(BASE, req.headers['x-rel-path']);
  if (!target) {
    json(res, 400, { error: 'bad or missing x-rel-path (must be a .jsonl path)' });
    return;
  }

  try {
    let body = await readBody(req, config.maxBytes);
    if ((req.headers['content-encoding'] || '').includes('gzip')) {
      body = zlib.gunzipSync(body);
    }
    // Atomic write: temp file in the same dir, then rename.
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp-${crypto.randomBytes(6).toString('hex')}`;
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, target);
    json(res, 200, { ok: true, bytes: body.length });
  } catch (err) {
    if (err.code === 413) { json(res, 413, { error: 'file too large' }); return; }
    // eslint-disable-next-line no-console
    console.error('ingest error:', err);
    json(res, 500, { error: 'internal error' });
  }
});

server.listen(config.port, config.host, () => {
  // eslint-disable-next-line no-console
  console.log(`Log-ingest server listening on http://${config.host}:${config.port}`);
  // eslint-disable-next-line no-console
  console.log(`  push endpoint -> POST /push  (header x-api-key, x-rel-path)`);
  // eslint-disable-next-line no-console
  console.log(`  writing to    -> ${BASE}`);
  // eslint-disable-next-line no-console
  console.log(`  point the display server's CLAUDE_PROJECTS_DIR at that path.`);
});
