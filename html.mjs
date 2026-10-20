// Renders the Summary (see CONTRACT.md) as one self-contained HTML document: inline CSS + inline SVG, no scripts.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const MIN = 60000, HOUR = 3600000, DAY = 86400000;
const PALETTE = 7; // top projects with their own colour; rest is "Other"

export function fmtDur(ms) {
  ms = Math.max(0, ms || 0);
  if (ms > 0 && ms < MIN) return '<1m';
  const total = Math.round(ms / MIN), h = Math.floor(total / 60), m = total % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

const dayDate = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); }; // local, not UTC
const dayShort = (key) => dayDate(key).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const dayLong = (key) => dayDate(key).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);

function relTime(t, now) {
  if (!t) return 'never';
  const d = now - t;
  if (d < 2 * MIN) return 'just now';
  if (d < HOUR) return `${Math.round(d / MIN)} min ago`;
  if (d < DAY) return `${Math.round(d / HOUR)} h ago`;
  const days = Math.round(d / DAY);
  if (days < 60) return days === 1 ? 'yesterday' : `${days} days ago`;
  return `${Math.round(days / 30)} months ago`;
}

// Axis top rounded to a friendly hour step, at most ~5 gridlines.
function niceAxis(maxMs) {
  const steps = [15 * MIN, 30 * MIN, HOUR, 2 * HOUR, 3 * HOUR, 4 * HOUR, 6 * HOUR, 12 * HOUR, 24 * HOUR, 48 * HOUR, 96 * HOUR];
  const step = steps.find((s) => maxMs / s <= 5) || Math.ceil(maxMs / 5 / HOUR) * HOUR;
  const top = Math.max(step, Math.ceil(maxMs / step) * step);
  const ticks = [];
  for (let v = 0; v <= top + 1; v += step) ticks.push(v);
  return { top, ticks };
}
const tickLabel = (v) => (v === 0 ? '0' : v % HOUR ? fmtDur(v) : `${v / HOUR}h`);

/**
 * Column chart. Bars are SVG in a stretched viewBox (crisp at any width);
 * axis labels, gridlines and the goal line are HTML so text never scales.
 * cols: [{ label, segs: [{ v, cls, title }], overlay?: { v, cls, title } }]
 */
function columnChart({ cols, goal = 0, height = 200, labelAt = () => true, ariaLabel }) {
  const n = cols.length, H = 1000;
  const max = Math.max(goal, ...cols.map((c) => c.segs.reduce((a, s) => a + s.v, 0)), MIN);
  const { top, ticks } = niceAxis(max * (goal ? 1.08 : 1));
  const y = (v) => (v / top) * H;
  let bars = '';
  cols.forEach((c, i) => {
    let base = 0;
    for (const s of c.segs) {
      if (s.v <= 0) continue;
      const h = y(s.v);
      bars += `<rect class="${s.cls}" x="${i + 0.14}" width="0.72" y="${(H - base - h).toFixed(2)}" height="${h.toFixed(2)}"><title>${esc(s.title)}</title></rect>`;
      base += h;
    }
    if (c.overlay && c.overlay.v > 0) {
      const h = y(c.overlay.v);
      bars += `<rect class="${c.overlay.cls}" x="${i + 0.3}" width="0.4" y="${(H - h).toFixed(2)}" height="${h.toFixed(2)}"><title>${esc(c.overlay.title)}</title></rect>`;
    }
  });
  const grid = ticks.map((t) => `<div class="gl" style="bottom:${(t / top) * 100}%"></div>`).join('');
  const ylab = ticks.map((t) => `<span style="bottom:${(t / top) * 100}%">${tickLabel(t)}</span>`).join('');
  const goalLine = goal ? `<div class="goal" style="bottom:${(goal / top) * 100}%"><span>goal ${tickLabel(goal)}</span></div>` : '';
  const xlab = cols.map((c, i) => `<span>${labelAt(i, n) ? esc(c.label) : ''}</span>`).join('');
  return `<div class="chart" style="--h:${height}px" role="img" aria-label="${esc(ariaLabel)}">
  <div class="yaxis">${ylab}</div>
  <div class="plot">${grid}${goalLine}<svg viewBox="0 0 ${n} ${H}" preserveAspectRatio="none">${bars}</svg></div>
  <div></div><div class="xaxis" style="grid-template-columns:repeat(${n},minmax(0,1fr))">${xlab}</div>
</div>`;
}

function sparkline(values, cls) {
  const v = values?.length ? values : [0];
  const max = Math.max(...v, 1), n = v.length;
  const pts = v.map((x, i) => `${n === 1 ? 0 : ((i / (n - 1)) * 100).toFixed(1)},${(28 - (x / max) * 26).toFixed(1)}`).join(' ');
  const total = v.reduce((a, b) => a + b, 0);
  return `<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none" role="img" aria-label="30-day trend, ${fmtDur(total)} total"><title>Last 30 days: ${fmtDur(total)}</title><polyline class="${cls}" points="${pts}" vector-effect="non-scaling-stroke"/></svg>`;
}

function ring(progress) {
  const r = 42, c = 2 * Math.PI * r, p = Math.min(1, Math.max(0, progress || 0));
  return `<svg class="ring" viewBox="0 0 100 100" aria-hidden="true">
  <circle cx="50" cy="50" r="${r}" class="ring-bg"/>
  <circle cx="50" cy="50" r="${r}" class="ring-fg${progress >= 1 ? ' met' : ''}" stroke-dasharray="${(p * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 50 50)"/>
  <text x="50" y="50" text-anchor="middle" dominant-baseline="central">${pct(progress, 1)}%</text>
</svg>`;
}

function hbars(items, emptyText) {
  if (!items?.length) return `<p class="empty">${esc(emptyText)}</p>`;
  const max = Math.max(...items.map((x) => x.ms), 1);
  return `<ul class="hbars">${items.map((x) => `<li><span class="hb-name" title="${esc(x.app)}">${esc(x.app)}</span><span class="hb-track"><span class="hb-fill${/^chrome$/i.test(x.app) ? ' chrome' : ''}" style="width:${((x.ms / max) * 100).toFixed(1)}%"></span></span><span class="hb-val">${fmtDur(x.ms)}</span></li>`).join('')}</ul>`;
}

const kpi = (label, value, sub = '') => `<div class="kpi"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div>${sub ? `<div class="kpi-sub">${sub}</div>` : ''}</div>`;

const ICON = { good: '&#10003;', info: 'i', warn: '!' };
const LEVEL_NAME = { good: 'Good', info: 'Info', warn: 'Warning' };

export function renderHtml(summary) {
  const s = summary || {};
  const now = s.generatedAt || Date.now();
  const goalH = s.goalHours || 6, goalMs = goalH * HOUR;
  const cl = s.claude || {}, ct = cl.totals || {};
  const pc = s.computer || {}, pt = pc.totals || {}, ch = pc.chrome || {};
  // logging started this month: month/week totals are partial, so say from when
  const ts = pc.trackingSince, gen = new Date(s.generatedAt || Date.now());
  const partial = ts && ts > `${gen.getFullYear()}-${String(gen.getMonth() + 1).padStart(2, '0')}-01`;
  const since = partial ? ` <small style="font-weight:400;opacity:.7">tracked since ${esc(new Date(ts + 'T00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))}</small>` : '';
  const projects = cl.projects || [];
  const daily = cl.daily || [];

  // Top projects by month get colour classes c0..c6, matched by display name in daily.byProject.
  const top = [...projects].filter((p) => p.month > 0).sort((a, b) => b.month - a.month).slice(0, PALETTE);
  const colorOf = new Map(top.map((p, i) => [p.name, `c${i}`]));
  let hasOther = false;

  const claudeCols = daily.map((d) => {
    const by = d.byProject || {};
    let other = 0;
    for (const [name, ms] of Object.entries(by)) if (!colorOf.has(name)) other += ms;
    if (other > 0) hasOther = true;
    const head = `${dayLong(d.day)} (total ${fmtDur(d.totalMs)})`;
    const segs = top.map((p) => ({ v: by[p.name] || 0, cls: colorOf.get(p.name), title: `${head}\n${p.name}: ${fmtDur(by[p.name] || 0)}` }));
    segs.push({ v: other, cls: 'cother', title: `${head}\nOther projects: ${fmtDur(other)}` });
    // Per-project times can sum past the union total when sessions overlap; scale so bar height equals totalMs.
    const sum = segs.reduce((a, x) => a + x.v, 0);
    const k = sum > 0 ? d.totalMs / sum : 0;
    segs.forEach((x) => (x.v *= k));
    return { label: dayShort(d.day), segs };
  });
  const daysMet = daily.filter((d) => d.totalMs >= goalMs).length;
  const activeDays = daily.filter((d) => d.totalMs > 0).length;

  const legend = [...top.map((p) => `<li><i class="sw ${colorOf.get(p.name)}"></i>${esc(p.name)}</li>`),
    hasOther ? '<li><i class="sw cother"></i>Other</li>' : '',
    '<li><i class="sw goal-sw"></i>Daily goal</li>'].join('');

  const pcCols = (pc.daily || []).map((d) => ({
    label: dayShort(d.day),
    segs: [{ v: d.totalMs, cls: 'pc-total', title: `${dayLong(d.day)}\nComputer: ${fmtDur(d.totalMs)}` }],
    overlay: { v: d.chromeMs, cls: 'pc-chrome', title: `${dayLong(d.day)}\nChrome: ${fmtDur(d.chromeMs)} (${pct(d.chromeMs, d.totalMs)}%)` },
  }));

  const hourly = cl.hourly || [];
  const hh = (h) => String(h).padStart(2, '0');
  const hourCols = Array.from({ length: 24 }, (_, h) => ({
    label: hh(h),
    segs: [{ v: hourly[h] || 0, cls: 'hour', title: `${hh(h)}:00-${hh(h)}:59\n${fmtDur(hourly[h] || 0)} over the last 30 days` }],
  }));
  const peak = hourly.length ? hourly.indexOf(Math.max(...hourly)) : -1;

  const rows = projects.map((p) => {
    const cls = colorOf.get(p.name);
    const rowCls = cls ? ' class="emph"' : p.week === 0 && p.month === 0 ? ' class="dim"' : '';
    return `<tr${rowCls}><th scope="row"><span class="pname"><i class="sw ${cls || 'none'}" aria-hidden="true"></i><span title="${esc(p.key)}">${esc(p.name)}</span></span></th>
<td>${fmtDur(p.today)}</td><td>${fmtDur(p.week)}</td><td>${fmtDur(p.month)}</td><td>${fmtDur(p.allTime)}</td>
<td>${sparkline(p.last30, `line ${cls || 'cother'}`)}</td><td>${p.sessionsMonth ?? 0}</td><td title="${p.lastActiveAt ? esc(new Date(p.lastActiveAt).toLocaleString('en-US')) : ''}">${relTime(p.lastActiveAt, now)}</td></tr>`;
  }).join('\n');

  const insights = (s.insights || []).map((x) => {
    const lv = ICON[x.level] ? x.level : 'info';
    return `<li class="ins ${lv}"><span class="ins-icon" aria-hidden="true">${ICON[lv]}</span><span class="sr">${LEVEL_NAME[lv]}: </span><span>${esc(x.text)}</span></li>`;
  }).join('');

  const alive = !!pc.trackerAlive;
  const hb = pc.heartbeatAt ? `last heartbeat ${relTime(pc.heartbeatAt, now)}` : 'no heartbeat recorded';
  const status = alive
    ? `<span class="status ok"><span aria-hidden="true">&#9679;</span> Computer logger running</span><span>${esc(hb)}</span>`
    : `<span class="status bad"><span aria-hidden="true">&#9650;</span> Computer logger stopped</span>`;
  const banner = alive ? '' : `<div class="banner" role="alert"><strong>&#9650; The background logger is not running</strong> (${esc(hb)}). Computer and Chrome time stop at the last sample until it is restarted. Claude Code time comes from transcripts and is unaffected.</div>`;

  const generated = new Date(now).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const avgActive = activeDays ? daily.reduce((a, d) => a + d.totalMs, 0) / activeDays : 0;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Time tracker</title>
<style>
:root{
  --bg:#f6f7f9;--card:#fff;--ink:#1c2128;--muted:#5b6573;--line:#e3e6eb;--track:#eceff3;
  --accent:#0b6bcb;--good:#1a7f37;--warn:#b35900;--bad:#c62828;--goal:#1c2128;--on-badge:#fff;
  --c0:#0072b2;--c1:#e69f00;--c2:#009e73;--c3:#cc79a7;--c4:#56b4e9;--c5:#d55e00;--c6:#7b5ea7;--cother:#a7adb6;
  --pc:#c9ced6;--chrome:#0072b2;--hour:#009e73;
}
@media (prefers-color-scheme:dark){:root{
  --bg:#111418;--card:#1a1e24;--ink:#e6e9ee;--muted:#9aa4b1;--line:#2b313a;--track:#262c34;
  --accent:#5aa9f0;--good:#56c271;--warn:#f0a040;--bad:#ff6b6b;--goal:#e6e9ee;--on-badge:#111418;
  --c0:#4ba3e3;--c1:#f0b030;--c2:#2fc196;--c3:#e08fc0;--c4:#8fd0f5;--c5:#f07a3a;--c6:#a68ad6;--cother:#646c78;
  --pc:#3b434e;--chrome:#4ba3e3;--hour:#2fc196;
}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-variant-numeric:tabular-nums}
.wrap{max-width:1180px;margin:0 auto;padding:24px 16px 48px}
header{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:8px 16px;margin-bottom:16px}
h1{font-size:24px;margin:0;letter-spacing:-.01em}
h2{font-size:16px;margin:0 0 4px}
.meta{color:var(--muted);display:flex;flex-wrap:wrap;gap:4px 16px;align-items:center}
.status{font-weight:600}.status.ok{color:var(--good)}.status.bad{color:var(--bad)}
.banner{border:1px solid var(--bad);border-left-width:6px;background:color-mix(in srgb,var(--bad) 10%,var(--card));padding:12px 14px;border-radius:8px;margin-bottom:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px;margin-bottom:16px;min-width:0}
.grid>.card{margin-bottom:0}
.grid{display:grid;gap:16px;margin-bottom:16px}
.sub{color:var(--muted);margin:0 0 14px}
.top{grid-template-columns:minmax(0,3fr) minmax(0,1fr)}
.two{grid-template-columns:repeat(2,minmax(0,1fr))}
.kgroups{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
.kgroup h3{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:0 0 8px;display:flex;align-items:center;gap:6px}
.kgroup h3 i{width:10px;height:10px;border-radius:2px;display:inline-block}
.krow{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.kpi{background:var(--bg);border-radius:8px;padding:8px 10px;min-width:0}
.kpi-label{font-size:12px;color:var(--muted)}
.kpi-value{font-size:20px;font-weight:650;white-space:nowrap}
.kpi-sub{font-size:12px;color:var(--muted)}
.goalcard{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:6px}
.ring{width:120px;height:120px}
.ring circle{fill:none;stroke-width:10}
.ring-bg{stroke:var(--track)}.ring-fg{stroke:var(--accent);stroke-linecap:round}.ring-fg.met{stroke:var(--good)}
.ring text{fill:var(--ink);font-size:20px;font-weight:700}
.goalcard .big{font-size:18px;font-weight:650}
.streak{font-weight:600}
ul{list-style:none;margin:0;padding:0}
.ins{display:flex;gap:10px;align-items:flex-start;padding:9px 12px;border-left:4px solid;border-radius:6px;background:var(--bg);margin-bottom:8px}
.ins-icon{flex:none;width:20px;height:20px;border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:800;color:var(--on-badge);margin-top:1px}
.ins.good{border-color:var(--good)}.ins.good .ins-icon{background:var(--good)}
.ins.info{border-color:var(--accent)}.ins.info .ins-icon{background:var(--accent);font-family:Georgia,serif;font-style:italic}
.ins.warn{border-color:var(--warn)}.ins.warn .ins-icon{background:var(--warn)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.chart{display:grid;grid-template-columns:40px minmax(0,1fr);margin-top:8px}
.yaxis{position:relative;height:var(--h)}
.yaxis span{position:absolute;right:6px;transform:translateY(50%);font-size:11px;color:var(--muted);white-space:nowrap}
.plot{position:relative;height:var(--h);border-bottom:1px solid var(--muted)}
.plot svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.gl{position:absolute;left:0;right:0;border-top:1px solid var(--line)}
.goal{position:absolute;left:0;right:0;border-top:2px dashed var(--goal);z-index:1;pointer-events:none}
.goal span{position:absolute;right:0;bottom:2px;font-size:11px;font-weight:600;background:var(--card);padding:0 4px;border-radius:3px}
.xaxis{display:grid;font-size:11px;color:var(--muted);padding-top:4px}
.xaxis span{white-space:nowrap;display:flex;justify-content:center}
rect:hover{opacity:.75}
.c0{fill:var(--c0);background:var(--c0);stroke:var(--c0)}.c1{fill:var(--c1);background:var(--c1);stroke:var(--c1)}
.c2{fill:var(--c2);background:var(--c2);stroke:var(--c2)}.c3{fill:var(--c3);background:var(--c3);stroke:var(--c3)}
.c4{fill:var(--c4);background:var(--c4);stroke:var(--c4)}.c5{fill:var(--c5);background:var(--c5);stroke:var(--c5)}
.c6{fill:var(--c6);background:var(--c6);stroke:var(--c6)}.cother{fill:var(--cother);background:var(--cother);stroke:var(--cother)}
.pc-total{fill:var(--pc)}.pc-chrome{fill:var(--chrome)}.hour{fill:var(--hour)}
.legend{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:12px;font-size:12px}
.legend li{display:flex;align-items:center;gap:6px;min-width:0;overflow-wrap:anywhere}
.sw{display:inline-block;width:12px;height:12px;border-radius:3px;flex:none}
.sw.none{background:transparent;border:1px solid var(--line)}
.goal-sw{width:16px;height:0;border-top:2px dashed var(--goal);border-radius:0}
.pc-sw{background:var(--pc)}.chrome-sw{background:var(--chrome)}
.tablewrap{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:0 -18px;padding:0 18px}
table{border-collapse:collapse;width:100%;min-width:780px}
th,td{padding:7px 10px;text-align:right;border-bottom:1px solid var(--line);white-space:nowrap}
thead th{font-size:12px;color:var(--muted);font-weight:600;background:var(--card)}
th:first-child,td:first-child{text-align:left}
tbody th{font-weight:500;max-width:280px}
.pname{display:flex;align-items:center;gap:8px;min-width:0}
.pname span{overflow:hidden;text-overflow:ellipsis}
tr.emph th{font-weight:700}
tr.emph{background:color-mix(in srgb,var(--accent) 6%,transparent)}
tr.dim{color:var(--muted)}
.spark{width:96px;height:26px;display:block;margin-left:auto}
.spark polyline{fill:none;stroke-width:1.6;stroke-linejoin:round;background:none}
.hbars li{display:grid;grid-template-columns:minmax(0,9em) minmax(0,1fr) 5.5em;gap:10px;align-items:center;padding:4px 0}
.hb-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hb-track{height:12px;background:var(--track);border-radius:6px;overflow:hidden}
.hb-fill{display:block;height:100%;background:var(--cother);border-radius:6px}
.hb-fill.chrome{background:var(--chrome)}
.hb-val{text-align:right;font-weight:600}
h3.small{font-size:13px;margin:18px 0 6px;color:var(--muted)}
.empty{color:var(--muted);font-style:italic}
.facts{display:flex;flex-wrap:wrap;gap:4px 18px;color:var(--muted);font-size:13px;margin-top:10px}
.facts b{color:var(--ink)}
@media (max-width:900px){.top,.two,.kgroups{grid-template-columns:minmax(0,1fr)}}
@media (max-width:420px){.kpi-value{font-size:16px}.kpi{padding:6px 8px}.card{padding:14px}.tablewrap{margin:0 -14px;padding:0 14px}.hbars li{grid-template-columns:minmax(0,7em) minmax(0,1fr) 5em}}
</style>
</head>
<body>
<div class="wrap">
<header>
  <h1>Time tracker</h1>
  <div class="meta"><span>Generated ${esc(generated)}</span>${status}</div>
</header>
${banner}
<div class="grid top">
  <section class="card" aria-labelledby="kpi-h">
    <h2 id="kpi-h">At a glance</h2>
    <p class="sub">Claude Code time counts overlapping sessions once.</p>
    <div class="kgroups">
      <div class="kgroup"><h3><i style="background:var(--hour)"></i>Claude Code</h3><div class="krow">
        ${kpi('Today', fmtDur(ct.today), `${cl.sessionsToday ?? 0} session${cl.sessionsToday === 1 ? '' : 's'}`)}${kpi('This week', fmtDur(ct.week))}${kpi('This month', fmtDur(ct.month), `${fmtDur(ct.allTime)} all time`)}
      </div></div>
      <div class="kgroup"><h3><i style="background:var(--pc)"></i>Computer${since}</h3><div class="krow">
        ${kpi('Today', fmtDur(pt.today))}${kpi('This week', fmtDur(pt.week))}${kpi('This month', fmtDur(pt.month))}
      </div></div>
      <div class="kgroup"><h3><i style="background:var(--chrome)"></i>Chrome${since}</h3><div class="krow">
        ${kpi('Today', fmtDur(ch.today), `${pct(ch.today, pt.today)}% of computer`)}${kpi('This week', fmtDur(ch.week), `${pct(ch.week, pt.week)}% of computer`)}${kpi('This month', fmtDur(ch.month), `${pct(ch.month, pt.month)}% of computer`)}
      </div></div>
    </div>
  </section>
  <section class="card goalcard" aria-labelledby="goal-h">
    <h2 id="goal-h">Today's goal</h2>
    ${ring(cl.goalProgress)}
    <div class="big">${fmtDur(ct.today)} <span class="kpi-sub">of ${goalH}h</span></div>
    <div class="kpi-sub">${(cl.goalProgress || 0) >= 1 ? 'Goal met' : `${fmtDur(Math.max(0, goalMs - (ct.today || 0)))} to go`} &middot; longest block ${fmtDur(cl.longestBlockTodayMs)}</div>
    <div class="streak">${cl.streakDays > 0 ? `<span aria-hidden="true">&#9733;</span> ${cl.streakDays}-day streak` : 'No streak yet'}</div>
  </section>
</div>

<section class="card" aria-labelledby="fb-h">
  <h2 id="fb-h">Feedback</h2>
  ${insights ? `<ul>${insights}</ul>` : '<p class="empty">Nothing to report yet.</p>'}
</section>

<section class="card" aria-labelledby="d30-h">
  <h2 id="d30-h">Claude Code, last 30 days</h2>
  <p class="sub">Stacked by project; the top ${PALETTE} projects this month have their own colour. Hover a bar for details.</p>
  ${daily.some((d) => d.totalMs > 0) ? columnChart({ cols: claudeCols, goal: goalMs, height: 240, labelAt: (i, n) => (n - 1 - i) % 5 === 0, ariaLabel: 'Daily Claude Code time for the last 30 days, stacked by project' }) : '<p class="empty">No Claude Code activity in the last 30 days.</p>'}
  <ul class="legend">${legend}</ul>
  <div class="facts"><span>Active days <b>${activeDays}/${daily.length || 30}</b></span><span>Goal met on <b>${daysMet}</b> days</span><span>Average per active day <b>${fmtDur(avgActive)}</b></span></div>
</section>

<section class="card" aria-labelledby="proj-h">
  <h2 id="proj-h">Projects</h2>
  <p class="sub">${projects.length} project${projects.length === 1 ? '' : 's'}, sorted by time this week. Highlighted rows are this month's top projects (colours match the chart).</p>
  ${projects.length ? `<div class="tablewrap"><table>
<thead><tr><th scope="col">Project</th><th scope="col">Today</th><th scope="col">This week</th><th scope="col">This month</th><th scope="col">All time</th><th scope="col">Last 30 days</th><th scope="col">Sessions (month)</th><th scope="col">Last active</th></tr></thead>
<tbody>
${rows}
</tbody></table></div>` : '<p class="empty">No projects seen yet.</p>'}
</section>

<div class="grid two">
<section class="card" aria-labelledby="pc-h">
  <h2 id="pc-h">Computer time, last 30 days</h2>
  <p class="sub">Active time at the computer, with the Chrome share overlaid.</p>
  ${pcCols.some((c) => c.segs[0].v > 0) ? columnChart({ cols: pcCols, height: 180, labelAt: (i, n) => (n - 1 - i) % 7 === 0, ariaLabel: 'Daily computer time with Chrome portion, last 30 days' }) : '<p class="empty">No computer activity logged in the last 30 days.</p>'}
  <ul class="legend"><li><i class="sw pc-sw"></i>Computer</li><li><i class="sw chrome-sw"></i>Chrome</li></ul>
  <h3 class="small">Top apps today</h3>
  ${hbars(pc.topAppsToday, 'No apps logged today.')}
  <h3 class="small">Top apps this week</h3>
  ${hbars(pc.topAppsWeek, 'No apps logged this week.')}
</section>

<section class="card" aria-labelledby="hr-h">
  <h2 id="hr-h">When you work with Claude</h2>
  <p class="sub">Claude Code time by hour of day, summed over the last 30 days.${peak >= 0 && hourly[peak] > 0 ? ` Busiest hour: <b>${hh(peak)}:00</b>.` : ''}</p>
  ${hourly.some((v) => v > 0) ? columnChart({ cols: hourCols, height: 180, labelAt: (i) => i % 3 === 0, ariaLabel: 'Claude Code time by hour of day' }) : '<p class="empty">No hourly data yet.</p>'}
</section>
</div>
</div>
</body>
</html>
`;
}
