import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSummary, fmt } from './summary.mjs';

const H = 3600000, M = 60000;
const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const iv = (start, end, project = 'C:\\p\\Alpha', session = 's1') => ({ start, end, project, session });
// Wednesday 2026-10-21 18:00 local
const NOW = at(2026, 10, 21, 18);

test('union across projects, per-project unions', () => {
  const s = buildSummary({
    now: NOW,
    intervals: [
      iv(at(2026, 10, 21, 9), at(2026, 10, 21, 11), 'C:\\p\\Alpha', 'a'),
      iv(at(2026, 10, 21, 10), at(2026, 10, 21, 12), 'C:\\p\\Beta', 'b'),
      iv(at(2026, 10, 21, 10), at(2026, 10, 21, 10, 30), 'C:\\p\\Alpha', 'a2'),
    ],
  });
  assert.equal(s.claude.totals.today, 3 * H);
  assert.equal(s.claude.projects.find((p) => p.name === 'Alpha').today, 2 * H);
  assert.equal(s.claude.projects.find((p) => p.name === 'Beta').today, 2 * H);
  assert.equal(s.claude.sessionsToday, 3);
  assert.equal(s.claude.longestBlockTodayMs, 3 * H);
  assert.equal(s.claude.goalProgress, 0.5);
  assert.equal(s.claude.hourly[9] + s.claude.hourly[10] + s.claude.hourly[11], 3 * H);
});

test('interval across midnight splits between days', () => {
  const s = buildSummary({ now: NOW, intervals: [iv(at(2026, 10, 20, 23), at(2026, 10, 21, 1, 30))] });
  assert.equal(s.claude.totals.today, 1.5 * H);
  assert.equal(s.claude.daily.at(-1).totalMs, 1.5 * H);
  assert.equal(s.claude.daily.at(-2).totalMs, 1 * H);
  assert.equal(s.claude.daily.at(-1).day, '2026-10-21');
  assert.equal(s.claude.daily.length, 30);
  assert.equal(s.claude.longestBlockTodayMs, 1.5 * H);
});

test('week starts Monday, month on the 1st', () => {
  const s = buildSummary({
    now: NOW,
    intervals: [
      iv(at(2026, 10, 18, 23), at(2026, 10, 19, 1)), // Sun 23:00 -> Mon 01:00
      iv(at(2026, 9, 30, 23), at(2026, 10, 1, 2)),   // Sep 30 -> Oct 1
    ],
  });
  assert.equal(s.claude.totals.week, 1 * H);
  assert.equal(s.claude.totals.month, 2 * H + 2 * H);
  assert.equal(s.claude.totals.allTime, 5 * H);
});

test('streak counts goal days ending today or yesterday', () => {
  const day = (d, hours) => iv(at(2026, 10, d, 8), at(2026, 10, d, 8) + hours * H);
  const base = [day(17, 2), day(18, 6), day(19, 7), day(20, 6.5)];
  assert.equal(buildSummary({ now: NOW, intervals: base }).claude.streakDays, 3);
  assert.equal(buildSummary({ now: NOW, intervals: [...base, day(21, 6)] }).claude.streakDays, 4);
  assert.equal(buildSummary({ now: NOW, intervals: [day(19, 7)] }).claude.streakDays, 0);
});

test('unique display names add parent folder on clash', () => {
  const s = buildSummary({
    now: NOW,
    intervals: [
      iv(at(2026, 10, 21, 9), at(2026, 10, 21, 10), 'C:\\Users\\f\\Desktop\\Claude Projects\\Atlas'),
      iv(at(2026, 10, 21, 10), at(2026, 10, 21, 11), 'C:\\Users\\f\\Desktop\\Atlas'),
      iv(at(2026, 10, 21, 11), at(2026, 10, 21, 12), 'C:\\Users\\f\\Desktop\\Tour Desk'),
    ],
  });
  const names = s.claude.projects.map((p) => p.name).sort();
  assert.deepEqual(names, ['Atlas (Claude Projects)', 'Atlas (Desktop)', 'Tour Desk']);
  assert.deepEqual(Object.keys(s.claude.daily.at(-1).byProject).sort(), names);
});

test('insights: present, ordered, concrete, skip missing data', () => {
  const intervals = [];
  for (let d = 14; d <= 21; d++) intervals.push(iv(at(2026, 10, d, 9), at(2026, 10, d, 16), 'C:\\p\\Alpha', `s${d}`));
  intervals.push(iv(at(2026, 10, 20, 23, 30), at(2026, 10, 21, 1), 'C:\\p\\Alpha', 'late'));
  for (const n of ['B', 'C', 'D']) intervals.push(iv(at(2026, 10, 21, 16), at(2026, 10, 21, 17), `C:\\p\\${n}`, n));
  intervals.push(iv(at(2026, 9, 10, 9), at(2026, 9, 10, 10), 'C:\\p\\Old', 'old'));
  const pcDays = { '2026-10-21': { totalMs: 10 * H, chromeMs: 2 * H, apps: { chrome: 2 * H, claude: 8 * H } } };
  const s = buildSummary({ now: NOW, intervals, pcDays, heartbeatAt: NOW - 30000 });
  const texts = s.insights.map((i) => i.text).join('\n');
  assert.ok(s.insights.length >= 5 && s.insights.length <= 14, texts);
  assert.match(s.insights[0].text, /Goal reached/);
  assert.match(texts, /streak/);
  assert.match(texts, /late-night/);
  assert.match(texts, /4 projects today/);
  assert.match(texts, /\d+h \d+m/);
  assert.ok(!texts.includes('logger'));
  assert.ok(s.computer.trackerAlive);
  assert.equal(s.computer.topAppsToday[0].app, 'claude');

  const empty = buildSummary({ now: NOW, intervals: [], pcDays: {}, heartbeatAt: null });
  assert.deepEqual(empty.insights.map((i) => i.level), ['warn']);
  assert.match(empty.insights[0].text, /logger is not running/);

  const stale = buildSummary({ now: NOW, intervals: [iv(at(2026, 9, 20, 9), at(2026, 9, 20, 10), 'C:\\p\\Old')], heartbeatAt: NOW });
  assert.match(stale.insights.map((i) => i.text).join('\n'), /Going stale.*Old/);
});

test('fmt', () => {
  assert.equal(fmt(4 * H + 12 * M), '4h 12m');
  assert.equal(fmt(12 * M), '12m');
});
