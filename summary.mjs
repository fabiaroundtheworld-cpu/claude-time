// Pure: turns intervals + pc days into the Summary shape from CONTRACT.md. No IO, no Date.now().
const MIN = 60000, HOUR = 60 * MIN;

const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
// Local-calendar day offset; Date constructor handles DST and month rollover.
const dayStart = (ms, offset = 0, hour = 0) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset, hour).getTime(); };

export function fmt(ms) {
  const m = Math.round(ms / MIN), h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}
const pct = (x) => `${Math.round(x * 100)}%`;

// Merge overlapping or touching intervals.
export function union(list) {
  const sorted = list.filter((i) => i.end > i.start).map((i) => [i.start, i.end]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e); else out.push([s, e]);
  }
  return out;
}
const clip = (merged, a, b) => merged.reduce((t, [s, e]) => t + Math.max(0, Math.min(e, b) - Math.max(s, a)), 0);

// ms per local day, splitting at midnight.
function byDay(merged) {
  const m = new Map();
  for (let [s, e] of merged) {
    while (s < e) {
      const next = Math.min(e, dayStart(s, 1));
      const k = dayKey(s);
      m.set(k, (m.get(k) || 0) + next - s);
      s = next;
    }
  }
  return m;
}
const sumDays = (map, fromKey, toKey) => { let t = 0; for (const [k, v] of map) if (k >= fromKey && k <= toKey) t += v; return t; };

const baseName = (p) => p.replace(/[\\/]+$/, '').split(/[\\/]/);
function uniqueNames(keys) {
  const parts = new Map(keys.map((k) => [k, baseName(k)]));
  const count = {};
  for (const p of parts.values()) count[p.at(-1)] = (count[p.at(-1)] || 0) + 1;
  const names = new Map();
  for (const [k, p] of parts) names.set(k, count[p.at(-1)] > 1 && p.length > 1 ? `${p.at(-1)} (${p.at(-2)})` : p.at(-1));
  const seen = {};
  for (const n of names.values()) seen[n] = (seen[n] || 0) + 1;
  for (const [k, n] of names) if (seen[n] > 1) names.set(k, k); // still clashing: fall back to the full path
  return names;
}

export function buildSummary({ intervals = [], pcDays = {}, heartbeatAt = null, now, goalHours = 6, weekStartsOn = 1 }) {
  const goalMs = goalHours * HOUR;
  const todayStart = dayStart(now);
  const nowDate = new Date(now);
  const weekStart = dayStart(now, -((nowDate.getDay() - weekStartsOn + 7) % 7));
  const monthStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1).getTime();
  const todayKey = dayKey(now), weekKey = dayKey(weekStart), monthKey = dayKey(monthStart);
  const last30Keys = Array.from({ length: 30 }, (_, i) => dayKey(dayStart(now, i - 29)));
  const start30 = dayStart(now, -29);

  // ---- Claude ----
  const all = union(intervals);
  const allDays = byDay(all);
  const totals = {
    today: allDays.get(todayKey) || 0,
    week: sumDays(allDays, weekKey, todayKey),
    month: sumDays(allDays, monthKey, todayKey),
    allTime: all.reduce((t, [s, e]) => t + e - s, 0),
  };

  let streakDays = 0;
  for (let i = (allDays.get(todayKey) || 0) >= goalMs ? 0 : 1; (allDays.get(dayKey(dayStart(now, -i))) || 0) >= goalMs; i++) streakDays++;

  const sessionsToday = new Set(intervals.filter((i) => i.end > todayStart && i.start < dayStart(now, 1)).map((i) => i.session)).size;
  const longestBlockTodayMs = all.reduce((m, [s, e]) => Math.max(m, Math.min(e, dayStart(now, 1)) - Math.max(s, todayStart)), 0);

  const groups = new Map();
  for (const i of intervals) (groups.get(i.project) || groups.set(i.project, []).get(i.project)).push(i);
  const names = uniqueNames([...groups.keys()]);
  const projects = [...groups].map(([key, list]) => {
    const merged = union(list), days = byDay(merged);
    return {
      key, name: names.get(key),
      today: days.get(todayKey) || 0,
      week: sumDays(days, weekKey, todayKey),
      month: sumDays(days, monthKey, todayKey),
      allTime: merged.reduce((t, [s, e]) => t + e - s, 0),
      last30: last30Keys.map((k) => days.get(k) || 0),
      sessionsMonth: new Set(list.filter((i) => i.end > monthStart).map((i) => i.session)).size,
      lastActiveAt: list.reduce((m, i) => Math.max(m, i.end), 0),
    };
  }).sort((a, b) => b.week - a.week || b.allTime - a.allTime);

  const daily = last30Keys.map((day, i) => {
    const byProject = {};
    for (const p of projects) if (p.last30[i]) byProject[p.name] = p.last30[i];
    return { day, totalMs: allDays.get(day) || 0, byProject };
  });

  const hourly = Array(24).fill(0);
  for (const [s0, e] of all) {
    for (let s = Math.max(s0, start30); s < e;) {
      const d = new Date(s), h = d.getHours();
      d.setHours(h + 1, 0, 0, 0);
      const next = Math.min(e, d.getTime());
      hourly[h] += next - s;
      s = next;
    }
  }

  // ---- Computer ----
  const pcIn = (from, to) => Object.entries(pcDays).filter(([k]) => k >= from && k <= to).map(([, v]) => v);
  const pcSum = (from, field) => pcIn(from, todayKey).reduce((t, d) => t + (d[field] || 0), 0);
  const topApps = (from) => {
    const acc = {};
    for (const d of pcIn(from, todayKey)) for (const [app, ms] of Object.entries(d.apps || {})) acc[app] = (acc[app] || 0) + ms;
    return Object.entries(acc).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([app, ms]) => ({ app, ms }));
  };
  const computer = {
    totals: { today: pcSum(todayKey, 'totalMs'), week: pcSum(weekKey, 'totalMs'), month: pcSum(monthKey, 'totalMs') },
    chrome: { today: pcSum(todayKey, 'chromeMs'), week: pcSum(weekKey, 'chromeMs'), month: pcSum(monthKey, 'chromeMs') },
    topAppsToday: topApps(todayKey),
    topAppsWeek: topApps(weekKey),
    daily: last30Keys.map((day) => ({ day, totalMs: pcDays[day]?.totalMs || 0, chromeMs: pcDays[day]?.chromeMs || 0 })),
    trackerAlive: heartbeatAt != null && now - heartbeatAt <= 2 * MIN,
    heartbeatAt,
    // first logged day: totals before it are unknown, not zero
    trackingSince: Object.keys(pcDays).filter((k) => pcDays[k]?.totalMs > 0).sort()[0] ?? null,
  };

  // ---- Insights (pushed in priority order, capped at 14) ----
  const insights = [];
  const add = (level, text) => insights.push({ level, text });
  const hasClaude = intervals.length > 0;

  if (!computer.trackerAlive) add('warn', heartbeatAt == null
    ? 'The computer logger is not running, so computer time is missing.'
    : `The computer logger stopped ${fmt(now - heartbeatAt)} ago, so computer time is incomplete.`);

  if (hasClaude) {
    if (totals.today >= goalMs) add('good', `Goal reached: ${fmt(totals.today)} today, ${fmt(totals.today - goalMs)} over the ${goalHours}h goal.`);
    else add('info', `${fmt(totals.today)} today, ${fmt(goalMs - totals.today)} left to reach the ${goalHours}h goal.`);

    const lastWeekStart = dayStart(weekStart, -7), lastWeekNow = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate() - 7, nowDate.getHours(), nowDate.getMinutes(), nowDate.getSeconds()).getTime();
    const prev = clip(all, lastWeekStart, lastWeekNow);
    if (prev > 0) {
      const delta = totals.week / prev - 1;
      add(delta >= 0 ? 'good' : 'info', `This week: ${fmt(totals.week)}, ${pct(Math.abs(delta))} ${delta >= 0 ? 'more' : 'less'} than at this point last week (${fmt(prev)}).`);
    }

    const recent7 = daily.slice(-7);
    const longDays = recent7.filter((d) => d.totalMs > 10 * HOUR).length;
    if (longDays) add('warn', `${longDays} day${longDays > 1 ? 's' : ''} over 10h in the last 7 days. Watch for burnout.`);

    let night = 0;
    for (let i = 0; i < 7; i++) night += clip(all, dayStart(now, -i), dayStart(now, -i, 5)) + clip(all, dayStart(now, -i, 23), dayStart(now, -i + 1));
    if (night > HOUR) add('warn', `${fmt(night)} of late-night work (23:00 to 05:00) in the last 7 days.`);

    if (streakDays > 0) add('good', `${streakDays}-day streak of ${goalHours}h+ days.`);

    const avg = totals.month / nowDate.getDate();
    add(avg >= goalMs ? 'good' : 'info', `This month you average ${fmt(avg)} a day, ${avg >= goalMs ? 'above' : 'below'} the ${goalHours}h goal.`);

    if (totals.week > 0 && projects[0]?.week > 0) add('info', `Top project this week: ${projects[0].name} with ${fmt(projects[0].week)} (${pct(projects[0].week / totals.week)} of your time).`);

    const touched = projects.filter((p) => p.today > 0).length;
    if (touched > 3) add('warn', `You touched ${touched} projects today. That much context switching costs focus.`);

    if (longestBlockTodayMs > 0) add(longestBlockTodayMs >= 2 * HOUR ? 'good' : 'info', `Longest focus block today: ${fmt(longestBlockTodayMs)}.`);

    let peak = -1, peakMs = 0;
    for (let h = 0; h < 24; h++) { const v = hourly[h] + hourly[(h + 1) % 24]; if (v > peakMs) { peak = h; peakMs = v; } }
    if (peak >= 0) add('info', `Your peak window is ${pad(peak)}:00 to ${pad((peak + 2) % 24)}:00 (${fmt(peakMs)} over the last 30 days).`);
  }

  if (computer.totals.week > 0) {
    const claudeApp = computer.topAppsWeek.find((a) => a.app === 'Claude')?.ms || 0;
    if (claudeApp > 0) add('info', `The Claude app was in front for ${pct(claudeApp / computer.totals.week)} of your computer time this week (${fmt(claudeApp)}).`);
    add('info', `Chrome took ${pct(computer.chrome.week / computer.totals.week)} of your computer time this week (${fmt(computer.chrome.week)}).`);
  }

  const stale = projects.filter((p) => p.lastActiveAt >= now - 60 * 24 * HOUR && p.lastActiveAt <= now - 14 * 24 * HOUR);
  if (stale.length) add('info', `Going stale (idle 14+ days): ${stale.slice(0, 3).map((p) => p.name).join(', ')}${stale.length > 3 ? ` and ${stale.length - 3} more` : ''}.`);

  return {
    generatedAt: now,
    goalHours,
    claude: { totals, goalProgress: totals.today / goalMs, streakDays, sessionsToday, longestBlockTodayMs, projects, daily, hourly },
    computer,
    insights: insights.slice(0, 14),
  };
}
