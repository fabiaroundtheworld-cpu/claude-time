import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadClaudeIntervals } from './claude.mjs';

const MIN = 60000;
const T0 = Date.parse('2026-10-01T10:00:00.000Z');
const encode = (p) => p.replace(/[^a-zA-Z0-9]/g, '-');

// Real folders, because project detection looks at markers and child dirs on disk.
const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'tt-claude-')));
const ws = path.join(tmp, 'ws');
const repo = path.join(ws, 'Repo');
const box = path.join(ws, 'Box'); // container: no markers
for (const d of [repo, path.join(box, 'alpha'), path.join(box, 'beta')]) fs.mkdirSync(d, { recursive: true });
for (const d of [repo, path.join(box, 'alpha'), path.join(box, 'beta')]) fs.writeFileSync(path.join(d, 'package.json'), '{}');

const human = (min, cwd, text = 'do it') => ({ type: 'user', timestamp: new Date(T0 + min * MIN).toISOString(), cwd, message: { role: 'user', content: text } });
const asst = (min, cwd, text = 'ok') => ({ type: 'assistant', timestamp: new Date(T0 + min * MIN).toISOString(), cwd, message: { role: 'assistant', content: [{ type: 'text', text }] } });
const use = (min, cwd, input) => ({ type: 'assistant', timestamp: new Date(T0 + min * MIN).toISOString(), cwd, message: { role: 'assistant', content: [{ type: 'tool_use', name: 'X', input }] } });
const tool = (min, cwd, text = 'done') => ({ type: 'user', timestamp: new Date(T0 + min * MIN).toISOString(), cwd, message: { role: 'user', content: [{ type: 'tool_result', content: text }] } });

let n = 0;
function fresh() {
  const projectsDir = path.join(tmp, `projects${++n}`);
  fs.mkdirSync(projectsDir);
  return { projectsDir, cachePath: path.join(tmp, `cache${n}.json`) };
}
function write(projectsDir, sessionDir, rel, events, extra = '') {
  const file = path.join(projectsDir, encode(sessionDir), rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, events.map((e) => JSON.stringify(e)).join('\n') + '\n' + extra);
  return file;
}
const spans = (r) => r.intervals.map((i) => [(i.start - T0) / MIN, (i.end - T0) / MIN, path.basename(i.project)]);

test('human idle gaps over 5 min split; malformed and irrelevant lines are skipped', async () => {
  const o = fresh();
  write(o.projectsDir, repo, 's1.jsonl', [human(0, repo), asst(1, repo), human(11, repo), asst(13, repo), human(14, repo)],
    '{not json\n{"type":"queue-operation","timestamp":"2026-10-01T10:30:00.000Z"}\n');
  const r = await loadClaudeIntervals(o);
  assert.deepEqual(spans(r), [[0, 1, 'Repo'], [11, 14, 'Repo']]);
  assert.equal(r.intervals[0].project, repo);
  assert.equal(r.intervals[0].session, 's1');
});

test('gaps ending on Claude activity count up to 60 min; gaps before a human prompt only up to 5 min', async () => {
  const o = fresh();
  write(o.projectsDir, repo, 's2.jsonl', [
    human(0, repo), tool(25, repo), // 25-min tool run: counts
    human(50, repo), // 25-min pause before a human prompt: 0
    asst(51, repo), tool(141, repo), // 90-min tool gap: abandoned, 0
    { ...human(143, repo), isMeta: true }, // meta user line is not a human prompt: counts
  ]);
  const r = await loadClaudeIntervals(o);
  assert.deepEqual(spans(r), [[0, 25, 'Repo'], [50, 51, 'Repo'], [141, 143, 'Repo']]);
});

test('worktree cwd and subfolder drift map to the repo root; subagent files map to the parent session', async () => {
  const o = fresh();
  const wt = path.join(repo, '.claude', 'worktrees', 'brave-fox');
  write(o.projectsDir, wt, 'w1.jsonl', [human(0, path.join(wt, 'src')), asst(2, wt)]);
  write(o.projectsDir, repo, path.join('main-sess', 'subagents', 'agent-a1.jsonl'), [asst(10, path.join(repo, 'src')), asst(12, repo.replace(/\\/g, '/'))]);
  const r = await loadClaudeIntervals(o);
  assert.deepEqual(r.intervals.map((i) => [i.project, i.session]), [[repo, 'w1'], [repo, 'main-sess']]);
});

test('container sessions: sticky child attribution with backfill; no reference stays on the container', async () => {
  const o = fresh();
  write(o.projectsDir, box, 'c1.jsonl', [
    human(0, box), asst(1, box), // before first reference -> backfilled to beta
    use(2, box, { file_path: path.join(box, 'beta', 'src', 'x.ts') }), asst(3, box),
    use(4, box, { command: `cd "${box.replace(/\\/g, '/')}/alpha" && npm test` }), asst(5, box), // sticky alpha from here
    tool(6, box, `ls: ${path.join(box, 'beta')}`), asst(7, box, `now ${path.join(box, 'beta', 'x')}`), // prose and output never move time
  ]);
  write(o.projectsDir, box, 'c2.jsonl', [human(20, box), asst(21, box)]);
  const r = await loadClaudeIntervals(o);
  assert.deepEqual(spans(r), [[0, 3, 'beta'], [3, 7, 'alpha'], [20, 21, 'Box']]);
  assert.equal(r.intervals[0].project, path.join(box, 'beta'));
});

test('container sessions can reference a sibling project of the container', async () => {
  const o = fresh();
  write(o.projectsDir, box, 'c3.jsonl', [human(0, box, `fix ${repo}\\src\\a.ts`), use(2, box, { file_path: path.join(repo, 'src', 'a.ts') })]);
  const r = await loadClaudeIntervals(o);
  assert.deepEqual(spans(r), [[0, 2, 'Repo']]);
});

test('cache: unchanged files are reused, changed files reparsed, deleted files dropped', async () => {
  const o = fresh();
  const f1 = write(o.projectsDir, repo, 'k1.jsonl', [human(0, repo), asst(2, repo)]);
  const f2 = write(o.projectsDir, repo, 'k2.jsonl', [human(30, repo), asst(31, repo)]);
  assert.equal((await loadClaudeIntervals(o)).intervals.length, 2);

  // Tamper with the cached intervals of f1: a reused entry returns the tampered value.
  const c = JSON.parse(fs.readFileSync(o.cachePath, 'utf8'));
  c.files[f1].iv = [[T0, T0 + 99 * MIN, 0]];
  fs.writeFileSync(o.cachePath, JSON.stringify(c));
  assert.deepEqual(spans(await loadClaudeIntervals(o))[0], [0, 99, 'Repo']);

  // Changing f1 (size differs) forces a reparse; deleting f2 removes it from output and cache.
  fs.appendFileSync(f1, JSON.stringify(asst(4, repo)) + '\n');
  fs.rmSync(f2);
  assert.deepEqual(spans(await loadClaudeIntervals(o)), [[0, 4, 'Repo']]);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(o.cachePath, 'utf8')).files), [f1]);
});

test('missing projects dir and corrupt cache do not throw', async () => {
  const o = fresh();
  fs.writeFileSync(o.cachePath, '{broken');
  assert.deepEqual(await loadClaudeIntervals({ projectsDir: path.join(tmp, 'nope'), cachePath: o.cachePath }), { intervals: [] });
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('fold: subfolders of a workspace count toward its top-level project', async () => {
  const { fold } = await import('./claude.mjs');
  const p = (...xs) => path.join('C:\\', ...xs);
  const roots = [p('W', 'Desktop', 'Claude Projects'), p('W', 'Desktop')];
  assert.equal(fold(p('W', 'Desktop', 'MyApp', 'android'), roots), p('W', 'Desktop', 'MyApp'));
  assert.equal(fold(p('W', 'Desktop', 'Claude Projects', 'shop', 'src'), roots), p('W', 'Desktop', 'Claude Projects', 'shop'));
  assert.equal(fold(p('W', 'Desktop', 'Claude Projects'), roots), p('W', 'Desktop', 'Claude Projects'));
  assert.equal(fold(p('Other', 'x'), roots), p('Other', 'x'));
});
