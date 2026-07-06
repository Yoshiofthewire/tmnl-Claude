'use strict';

const fmt = require('./format');
const { buildGauges, gaugeText } = require('./gauge');

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

function statTile(value, label) {
  return `<div class="tile"><div class="tval">${esc(value)}</div><div class="tlabel">${esc(label)}</div></div>`;
}

// A "usage remaining" gauge: label + reset/context meta, a used/remaining bar,
// and a remaining figure + percent line.
function gaugeCard(title, meta, g) {
  const txt = gaugeText(g, fmt);
  return `<div class="gauge">
      <div class="ghead"><span class="glabel">${esc(title)}</span><span class="gmeta">${esc(meta)}</span></div>
      <div class="gbar"><div class="gfill" style="width:${g.pctUsed}%"></div></div>
      <div class="gfoot"><span class="gremain">${esc(txt.remaining)}</span><span class="gpct">${esc(txt.pct)}</span></div>
    </div>`;
}

function modelBar(models) {
  const fills = ['#111111', '#7d7d7d', '#c4c4c4', '#e0e0e0'];
  const total = models.reduce((s, m) => s + m.tokens, 0) || 1;
  let segs = '';
  let legend = '';
  models.slice(0, 4).forEach((m, i) => {
    const pct = (m.tokens / total) * 100;
    const fill = fills[i] || fills[fills.length - 1];
    const dark = i === 0;
    segs += `<div class="seg" style="width:${pct.toFixed(2)}%;background:${fill};${dark ? 'color:#fff' : 'color:#111'}">${pct >= 9 ? Math.round(pct) + '%' : ''}</div>`;
    legend += `<div class="legitem">
        <span class="swatch" style="background:${fill};${i > 0 ? 'box-shadow:inset 0 0 0 1px #999' : ''}"></span>
        <span class="legname">${esc(m.label)}</span>
        <span class="legval">${fmt.tokens(m.tokens)}</span>
      </div>`;
  });
  if (!models.length) {
    segs = '<div class="seg" style="width:100%;background:#e0e0e0;color:#111">no activity</div>';
  }
  return `<div class="models">
      <div class="mhead"><span class="mtitle">Model usage</span><span class="mspan">last 7 days</span></div>
      <div class="bar">${segs}</div>
      <div class="legend">${legend}</div>
    </div>`;
}

function render(data, opts = {}) {
  const tz = opts.timezone || process.env.TZ || 'UTC';
  const plan = opts.plan || 'Claude';
  const gen = new Date(data.generatedAt);
  const t = data.today;
  const w = data.week;
  const s = data.session || {};
  const g = buildGauges(data, opts);

  const sessionMeta = s.active ? `resets in ${fmt.durationShort(s.remainingMs)}` : 'no active session';
  const weekMeta = w.anchored ? `resets in ${fmt.durationLong(w.remainingMs)}` : 'rolling 7 days';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=800, height=480">
<title>Claude Code Usage</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:800px; height:480px; background:#fff; color:#111;
    font-family:"Helvetica Neue", Helvetica, Arial, "Segoe UI", sans-serif;
    -webkit-font-smoothing:none; }
  .screen { width:800px; height:480px; display:flex; flex-direction:column;
    padding:15px 22px 0; }

  .header { display:flex; align-items:baseline; justify-content:space-between;
    border-bottom:2px solid #111; padding-bottom:8px; }
  .htitle { font-size:21px; font-weight:800; letter-spacing:.5px; }
  .plan { border:2px solid #111; border-radius:20px; padding:3px 13px;
    font-size:13px; font-weight:800; letter-spacing:.4px; text-transform:uppercase; }

  /* Remaining gauges */
  .col-today .gauge { margin-top:auto; padding-top:12px; }
  .wgwrap { padding:2px 0 2px; }
  .ghead { display:flex; align-items:baseline; justify-content:space-between; margin-bottom:5px; }
  .glabel { font-size:13px; font-weight:800; letter-spacing:1px; text-transform:uppercase; }
  .gmeta { font-size:12.5px; font-weight:600; color:#666; }
  .gbar { height:16px; background:#e2e2e2; border:1px solid #111; border-radius:4px; overflow:hidden; }
  .gfill { height:100%; background:#111; }
  .gfoot { display:flex; justify-content:space-between; margin-top:4px; }
  .gremain { font-size:16px; font-weight:800; font-variant-numeric:tabular-nums; }
  .gpct { font-size:13px; font-weight:600; color:#666; }

  .main { flex:1; display:flex; padding:8px 0 4px; gap:22px; }
  .col-today { flex:1.55; display:flex; flex-direction:column; }
  .col-week { flex:1; border-left:2px solid #ddd; padding-left:22px;
    display:flex; flex-direction:column; }
  .coltitle { font-size:12px; font-weight:800; letter-spacing:2px;
    text-transform:uppercase; margin-bottom:9px; }

  .grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px 16px; }
  .stack { display:flex; flex-direction:column; gap:9px; }
  .tval { font-size:26px; font-weight:800; line-height:1;
    font-variant-numeric:tabular-nums; letter-spacing:-.5px; }
  .tlabel { font-size:11px; font-weight:600; color:#666; margin-top:3px;
    text-transform:uppercase; letter-spacing:.5px; }
  .col-week .tile .tval { font-size:28px; }
  .col-week .tile.streak { background:#111; color:#fff; padding:7px 11px; border-radius:8px; }
  .col-week .tile.streak .tval { color:#fff; font-size:26px; }
  .col-week .tile.streak .tlabel { color:#cfcfcf; }

  .models { padding:2px 0 8px; }
  .mhead { display:flex; align-items:baseline; justify-content:space-between; margin-bottom:5px; }
  .mtitle { font-size:12px; font-weight:800; letter-spacing:2px; text-transform:uppercase; }
  .mspan { font-size:11px; color:#888; font-weight:600; }
  .bar { display:flex; height:20px; width:100%; border:1px solid #111; border-radius:4px; overflow:hidden; }
  .seg { display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:800; min-width:0; }
  .legend { display:flex; gap:20px; margin-top:6px; flex-wrap:wrap; }
  .legitem { display:flex; align-items:center; gap:6px; font-size:12.5px; }
  .swatch { width:11px; height:11px; border-radius:2px; display:inline-block; }
  .legname { font-weight:700; }
  .legval { color:#666; font-variant-numeric:tabular-nums; }

  .footer { display:flex; align-items:center; justify-content:space-between;
    border-top:2px solid #111; padding:8px 0 10px; margin-top:auto; }
  .brand { display:flex; align-items:center; gap:9px; }
  .brand .name { font-size:15px; font-weight:800; letter-spacing:.3px; }
  .updated { font-size:13px; color:#555; font-weight:600; font-variant-numeric:tabular-nums; }
  .updated b { color:#111; }
</style>
</head>
<body>
  <div class="screen">
    <div class="header">
      <div class="htitle">${esc(fmt.longDate(gen, tz))}</div>
      <div class="plan">${esc(plan)}</div>
    </div>

    <div class="main">
      <div class="col-today">
        <div class="coltitle">Today</div>
        <div class="grid">
          ${statTile(fmt.tokens(t.totalTokens), 'Total tokens')}
          ${statTile(fmt.usd(t.cost), 'API-equiv. cost')}
          ${statTile(fmt.count(t.sessions), 'Sessions')}
          ${statTile(fmt.tokens(t.input), 'Input tokens')}
          ${statTile(fmt.tokens(t.output), 'Output tokens')}
          ${statTile(fmt.count(t.messages), 'Messages')}
        </div>
        ${gaugeCard('Session remaining', sessionMeta, g.session)}
      </div>

      <div class="col-week">
        <div class="coltitle">This week</div>
        <div class="stack">
          <div class="tile"><div class="tval">${esc(fmt.tokens(w.totalTokens))}</div><div class="tlabel">Total tokens</div></div>
          <div class="tile"><div class="tval">${esc(fmt.usd(w.cost))}</div><div class="tlabel">Approx. API cost</div></div>
          <div class="tile"><div class="tval">${esc(fmt.count(w.sessions))}</div><div class="tlabel">Total sessions</div></div>
          <div class="tile streak"><div class="tval">${esc(String(w.daysInARow) + (w.daysInARow === 1 ? ' day' : ' days'))}</div><div class="tlabel">Used in a row</div></div>
        </div>
      </div>
    </div>

    ${modelBar(w.models)}

    <div class="wgwrap">${gaugeCard('Week remaining', weekMeta, g.week)}</div>

    <div class="footer">
      <div class="brand">${burst(22, '#111')}<span class="name">Claude Code Usage</span></div>
      <div class="updated">Updated <b>${esc(fmt.timeLabel(gen, tz))}</b> · ${esc(fmt.dateLabel(gen, tz))}</div>
    </div>
  </div>
</body>
</html>`;
}

module.exports = { render };
