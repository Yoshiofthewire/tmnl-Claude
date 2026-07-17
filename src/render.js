'use strict';

const { displayModel } = require('./view');

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// The Claude "sunburst" mark, drawn as radiating tapered rays. Monochrome so it
// renders crisply on 1-bit / grayscale e-ink.
function burst(size, color) {
  const c = size / 2;
  const rays = 12;
  const inner = size * 0.13;
  let paths = '';
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2 - Math.PI / 2;
    const len = size * (i % 2 === 0 ? 0.5 : 0.42);
    const w = size * 0.052;
    const x1 = c + Math.cos(a) * inner;
    const y1 = c + Math.sin(a) * inner;
    const x2 = c + Math.cos(a) * len;
    const y2 = c + Math.sin(a) * len;
    paths += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${color}" stroke-width="${w.toFixed(1)}" stroke-linecap="round"/>`;
  }
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${paths}</svg>`;
}

const STYLE = `
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:800px; height:480px; background:#fff; color:#111;
    font-family:"Helvetica Neue", Helvetica, Arial, "Segoe UI", sans-serif;
    -webkit-font-smoothing:none; }
  .screen { width:800px; height:480px; display:flex; flex-direction:column; padding:16px 24px 0; }

  .header { display:flex; align-items:baseline; justify-content:space-between;
    border-bottom:2px solid #111; padding-bottom:9px; }
  .htitle { font-size:22px; font-weight:800; letter-spacing:.5px; }
  .plan { border:2px solid #111; border-radius:20px; padding:3px 14px;
    font-size:13px; font-weight:800; letter-spacing:.4px; text-transform:uppercase; }

  .gauges { padding:16px 0 6px; display:flex; flex-direction:column; gap:15px; }
  .gauge .ghead { display:flex; align-items:baseline; justify-content:space-between; margin-bottom:5px; }
  .glabel { font-size:15px; font-weight:800; letter-spacing:1.5px; text-transform:uppercase; }
  .gmeta { font-size:13px; font-weight:600; color:#666; }
  .gbar { height:20px; background:#e2e2e2; border:1px solid #111; border-radius:4px; overflow:hidden; }
  .gfill { height:100%; background:#111; }
  .gfoot { display:flex; justify-content:space-between; margin-top:5px; align-items:baseline; }
  .gused { font-size:22px; font-weight:800; font-variant-numeric:tabular-nums; letter-spacing:-.5px; }
  .gleft { font-size:14px; font-weight:600; color:#666; }

  .mid { flex:1; display:flex; gap:24px; padding:8px 0 4px; }
  .models { flex:1.5; }
  .sess { flex:1; border-left:2px solid #ddd; padding-left:22px; }
  .subtitle { font-size:12px; font-weight:800; letter-spacing:2px; text-transform:uppercase; color:#111; margin-bottom:10px; }
  .mrow { display:flex; align-items:center; gap:10px; margin-bottom:9px; }
  .mname { font-size:13px; font-weight:700; width:88px; }
  .mbar { flex:1; height:12px; background:#e2e2e2; border:1px solid #111; border-radius:3px; overflow:hidden; }
  .mfill { height:100%; background:#111; }
  .mpct { font-size:13px; font-weight:700; font-variant-numeric:tabular-nums; width:36px; text-align:right; }
  .mempty { font-size:13px; color:#888; }
  .srow { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:8px; }
  .sk { font-size:12px; font-weight:600; color:#666; text-transform:uppercase; letter-spacing:.5px; }
  .sv { font-size:20px; font-weight:800; font-variant-numeric:tabular-nums; }

  .insight { display:flex; align-items:baseline; gap:8px; font-size:13px; color:#333;
    border-top:1px solid #ddd; padding-top:8px; margin-bottom:4px; }
  .ipct { font-weight:800; font-size:14px; }

  .footer { display:flex; align-items:center; justify-content:space-between;
    border-top:2px solid #111; padding:9px 0 12px; margin-top:auto; }
  .brand { display:flex; align-items:center; gap:9px; }
  .brand .name { font-size:15px; font-weight:800; letter-spacing:.3px; }
  .updated { font-size:13px; color:#555; font-weight:600; font-variant-numeric:tabular-nums; }
  .updated b { color:#111; }
  .stale { color:#111; font-weight:800; }

  .notice { flex:1; display:flex; flex-direction:column; justify-content:center; gap:12px; }
  .ntitle { font-size:30px; font-weight:800; letter-spacing:-.5px; }
  .nsub { font-size:16px; color:#555; font-weight:600; }
  .nurl { font-size:18px; font-weight:800; font-family:"SF Mono", Menlo, monospace; }
`;

function page(bodyInner) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=800, height=480">
<title>Claude Code Usage</title>
<style>${STYLE}</style>
</head>
<body><div class="screen">${bodyInner}</div></body>
</html>`;
}

function header(d) {
  return `<div class="header">
      <div class="htitle">${esc(d.long_date)}</div>
      <div class="plan">${esc(d.plan)}</div>
    </div>`;
}

function footer(d) {
  const stale = d.stale ? ' · <span class="stale">stale</span>' : '';
  return `<div class="footer">
      <div class="brand">${burst(22, '#111')}<span class="name">Claude Code Usage</span></div>
      <div class="updated">Updated <b>${esc(d.updated_time)}</b>${d.updated_date ? ' · ' + esc(d.updated_date) : ''}${stale}</div>
    </div>`;
}

function gauge(label, g) {
  const meta = g.resets || '—';
  return `<div class="gauge">
      <div class="ghead"><span class="glabel">${esc(label)}</span><span class="gmeta">${esc(meta)}</span></div>
      <div class="gbar"><div class="gfill" style="width:${g.pct_used}%"></div></div>
      <div class="gfoot"><span class="gused">${esc(g.used_text)}</span><span class="gleft">${esc(g.left_text)}</span></div>
    </div>`;
}

function modelsCol(d) {
  let rows;
  if (d.has_models) {
    rows = d.models.map((m) => `<div class="mrow">
        <span class="mname">${esc(m.label)}</span>
        <div class="mbar"><div class="mfill" style="width:${m.width}%"></div></div>
        <span class="mpct">${esc(m.pct_text)}</span>
      </div>`).join('');
  } else {
    rows = '<div class="mempty">No per-model breakdown available.</div>';
  }
  return `<div class="models"><div class="subtitle">Per-model · this week</div>${rows}</div>`;
}

function sessionCol(d) {
  return `<div class="sess"><div class="subtitle">Session</div>
      <div class="srow"><span class="sk">Cost</span><span class="sv">${esc(d.session_cost)}</span></div>
      <div class="srow"><span class="sk">API time</span><span class="sv">${esc(d.api_duration)}</span></div>
      <div class="srow"><span class="sk">Wall time</span><span class="sv">${esc(d.wall_duration)}</span></div>
    </div>`;
}

function insightRow(d) {
  if (!d.insight) return '';
  const p = d.insight.pct ? `<span class="ipct">${esc(d.insight.pct)}</span>` : '';
  return `<div class="insight">${p}<span>${esc(d.insight.summary)}</span></div>`;
}

function render(api, opts = {}) {
  const d = displayModel(api, opts);

  if (!d.authenticated) {
    const unreachable = d.error && d.error !== 'not authenticated';
    const title = unreachable ? "Can't reach the usage dashboard" : 'Usage dashboard not connected';
    const sub = unreachable ? esc(d.error) : 'Log in on the dashboard to start showing data:';
    return page(`${header(d)}
      <div class="notice">
        <div class="ntitle">${esc(title)}</div>
        <div class="nsub">${sub}</div>
        ${d.api_url ? `<div class="nurl">${esc(d.api_url)}</div>` : ''}
      </div>
      ${footer(d)}`);
  }

  return page(`${header(d)}
      <div class="gauges">
        ${gauge('Session', d.session)}
        ${gauge('Week · all models', d.week)}
      </div>
      <div class="mid">
        ${modelsCol(d)}
        ${sessionCol(d)}
      </div>
      ${insightRow(d)}
      ${footer(d)}`);
}

module.exports = { render };
