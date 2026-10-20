import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPcDays, readHeartbeat } from './pc.mjs';

async function fixture(files) {
  const dir = await mkdtemp(join(tmpdir(), 'pc-'));
  for (const [name, body] of Object.entries(files)) await writeFile(join(dir, name), body);
  return dir;
}

test('totals, chrome share, friendly names, lastSampleAt', async () => {
  const dir = await fixture({
    '2026-10-20.log': '09:00:00\tchrome\n09:00:15\tChrome\n09:00:30\tclaude\n09:00:45\tCode\n09:01:00\tWindowsTerminal\n09:01:15\tmystery\n',
  });
  const { days, lastSampleAt } = await loadPcDays({ pcDir: dir, sinceDay: '2026-10-01' });
  const d = days['2026-10-20'];
  assert.equal(d.totalMs, 6 * 15000);
  assert.equal(d.chromeMs, 2 * 15000);
  assert.deepEqual(d.apps, { Chrome: 30000, Claude: 15000, 'VS Code': 15000, Terminal: 15000, mystery: 15000 });
  assert.equal(lastSampleAt, new Date(2026, 9, 20, 9, 1, 15).getTime());
});

test('sinceDay filters older files; custom sampleMs', async () => {
  const dir = await fixture({
    '2026-10-18.log': '10:00:00\tchrome\n',
    '2026-10-19.log': '10:00:00\tchrome\n',
    '2026-10-20.log': '08:00:00\tclaude\n',
    'notes.txt': '10:00:00\tchrome\n',
  });
  const { days, lastSampleAt } = await loadPcDays({ pcDir: dir, sinceDay: '2026-10-19', sampleMs: 1000 });
  assert.deepEqual(Object.keys(days).sort(), ['2026-10-19', '2026-10-20']);
  assert.equal(days['2026-10-19'].totalMs, 1000);
  assert.equal(lastSampleAt, new Date(2026, 9, 20, 8, 0, 0).getTime());
});

test('malformed lines and CRLF are handled; partial trailing line skipped', async () => {
  const dir = await fixture({
    '2026-10-20.log': 'garbage\r\n09:00:00\tchrome\r\n9:00:15\tchrome\r\n09:00:30\t\r\n09:00:45 claude\r\n09:01:00\texplorer\r\n09:01:15\tchro',
  });
  const { days } = await loadPcDays({ pcDir: dir, sinceDay: '2026-10-20' });
  assert.deepEqual(days['2026-10-20'], { totalMs: 30000, chromeMs: 15000, apps: { Chrome: 15000, 'File Explorer': 15000 } });
});

test('missing dir or empty folder', async () => {
  assert.deepEqual(await loadPcDays({ pcDir: join(tmpdir(), 'nope-pc-xyz'), sinceDay: '2026-01-01' }), { days: {}, lastSampleAt: null });
  const dir = await mkdtemp(join(tmpdir(), 'pc-'));
  await mkdir(join(dir, 'sub'));
  assert.deepEqual(await loadPcDays({ pcDir: dir, sinceDay: '2026-01-01' }), { days: {}, lastSampleAt: null });
});

test('readHeartbeat parses .NET ISO, null on missing/garbage', async () => {
  const dir = await fixture({ hb: '2026-10-20T00:39:31.0068150-04:00\r\n', bad: 'not a date' });
  assert.equal(await readHeartbeat(join(dir, 'hb')), Date.UTC(2026, 9, 20, 4, 39, 31, 6));
  assert.equal(await readHeartbeat(join(dir, 'bad')), null);
  assert.equal(await readHeartbeat(join(dir, 'missing')), null);
});
