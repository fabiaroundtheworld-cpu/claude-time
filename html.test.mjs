import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderHtml, fmtDur } from './html.mjs';

const MIN = 60000, HOUR = 3600000, DAY = 86400000;

// Deterministic PRNG so the fixture (and preview.html) is stable between runs.
function rng(seed) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const localKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function makeFixture({ trackerAlive = true } = {}) {
  const r = rng(42);
  const now = new Date(2026, 9, 20, 15, 30).getTime(); // Tue Oct 20 2026, 15:30 local
  const days = Array.from({ length: 30 }, (_, i) => { const d = new Date(now); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - 29 + i); return localKey(d); });
  const emptyDays = new Set([3, 4, 11, 17, 18, 25]);
  const names = ['Atlas App', 'Sound Rental', 'Music School', 'Mind Map', 'Tour Desk', 'Bar Tool', 'Hostel Ops',
    'Studio Site', 'cash-register', 'spice-shop', '<script>alert("x")</script>', 'R&D "notes"', 'Habit App', 'agent-pack'];
  const weights = [5, 3, 2.4, 1.8, 1.4, 1.1, 0.9, 0.7, 0.5, 0.4, 0.3, 0.2, 0.1, 0];

  const projects = names.map((name, pi) => {
    const last30 = days.map((_, di) => (emptyDays.has(di) || r() < 0.45 ? 0 : Math.round(r() * weights[pi] * HOUR * 0.6 / MIN) * MIN));
    if (pi === 0) last30[29] = 3 * HOUR + 12 * MIN;
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    const lastIdx = last30.findLastIndex((v) => v > 0);
    return {
      key: `C:\\Users\\fabia\\Desktop\\${name}`, name,
      today: last30[29], week: sum(last30.slice(28)), month: sum(last30.slice(10)), allTime: sum(last30) + Math.round(r() * 80) * HOUR,
      last30, sessionsMonth: last30.slice(10).filter(Boolean).length + Math.round(r() * 4),
      lastActiveAt: lastIdx >= 0 ? now - (29 - lastIdx) * DAY - Math.round(r() * 5) * HOUR : now - 75 * DAY,
    };
  }).sort((a, b) => b.week - a.week || b.allTime - a.allTime);

  const daily = days.map((day, di) => {
    const byProject = {};
    for (const p of projects) if (p.last30[di]) byProject[p.name] = p.last30[di];
    const raw = Object.values(byProject).reduce((a, b) => a + b, 0);
    return { day, totalMs: Math.round(raw * 0.9), byProject }; // union < sum: some overlap
  });
  const t = (n) => daily.slice(-n).reduce((a, d) => a + d.totalMs, 0);

  const pcDaily = days.map((day, di) => {
    const totalMs = di === 25 ? 0 : Math.round((3 + r() * 7) * HOUR);
    return { day, totalMs, chromeMs: Math.round(totalMs * (0.2 + r() * 0.4)) };
  });
  const pt = (n) => pcDaily.slice(-n).reduce((a, d) => a + d.totalMs, 0);
  const pcc = (n) => pcDaily.slice(-n).reduce((a, d) => a + d.chromeMs, 0);
  const apps = ['chrome', 'claude', 'Code', 'WindowsTerminal', 'explorer', 'Spotify', 'Figma', 'a-very-long-process-name-without-spaces.exe'];

  return {
    generatedAt: now,
    goalHours: 6,
    claude: {
      totals: { today: daily[29].totalMs, week: t(2), month: t(20), allTime: projects.reduce((a, p) => a + p.allTime, 0) },
      goalProgress: daily[29].totalMs / (6 * HOUR),
      streakDays: 3,
      sessionsToday: 4,
      longestBlockTodayMs: 2 * HOUR + 5 * MIN,
      projects,
      daily,
      hourly: Array.from({ length: 24 }, (_, h) => (h < 8 ? (h < 2 ? 2 * HOUR : 0) : Math.round(Math.sin(((h - 8) / 16) * Math.PI) * 14 * HOUR))),
    },
    computer: {
      totals: { today: pt(1), week: pt(2), month: pt(20) },
      chrome: { today: pcc(1), week: pcc(2), month: pcc(20) },
      topAppsToday: apps.map((app, i) => ({ app, ms: Math.round((8 - i) * 25 * MIN) })),
      topAppsWeek: apps.map((app, i) => ({ app, ms: Math.round((8 - i) * 70 * MIN) })),
      daily: pcDaily,
      trackerAlive,
      heartbeatAt: trackerAlive ? now - 10000 : now - 3 * HOUR,
    },
    insights: [
      { level: 'warn', text: 'You are 2h 31m short of today\'s 6h goal.' },
      { level: 'good', text: '3-day streak of meeting the goal. Keep it going!' },
      { level: 'info', text: 'Atlas App took 41% of this week\'s Claude Code time.' },
      { level: 'info', text: 'Chrome was 38% of computer time this week <b>not bold</b>.' },
    ],
  };
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

test('fmtDur', () => {
  assert.equal(fmtDur(4 * HOUR + 12 * MIN), '4h 12m');
  assert.equal(fmtDur(35 * MIN), '35m');
  assert.equal(fmtDur(0), '0m');
  assert.equal(fmtDur(20000), '<1m');
});

test('renders a full document with every project, escaped', () => {
  const s = makeFixture();
  const html = renderHtml(s);
  assert.match(html, /^<!doctype html>/i);
  assert.match(html.trimEnd(), /<\/html>$/);
  assert.match(html, /<title>Time tracker<\/title>/);
  assert.ok(!/<script/i.test(html), 'no script tags at all (raw or injected)');
  assert.ok(html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'));
  assert.ok(!html.includes('<b>not bold</b>'), 'insight text is escaped');
  assert.ok(!/https?:\/\//.test(html), 'no external resources');
  for (const p of s.claude.projects) assert.ok(html.includes(esc(p.name)), `missing ${p.name}`);
  assert.ok(!html.includes('role="alert"'), 'no banner when tracker alive');
  assert.ok(html.includes('3h 12m') || html.includes('3h 13m'));
});

test('warns when the tracker is dead', () => {
  const html = renderHtml(makeFixture({ trackerAlive: false }));
  assert.ok(html.includes('role="alert"'));
  assert.ok(html.includes('background logger is not running'));
});

test('survives an empty summary', () => {
  const html = renderHtml({ generatedAt: Date.now(), goalHours: 6, claude: {}, computer: {}, insights: [] });
  assert.match(html, /No Claude Code activity/);
});

test('writes preview.html', () => {
  writeFileSync(fileURLToPath(new URL('./preview.html', import.meta.url)), renderHtml(makeFixture()));
});
