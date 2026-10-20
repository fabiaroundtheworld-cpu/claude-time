// Claude Code active-time intervals from transcript .jsonl files, cached per file (path + mtime + size).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import os from 'node:os';

const CACHE_VERSION = 7;

// Workspace folders that hold projects; a path below one counts toward its first folder there
// (Desktop/MyApp/android -> Desktop/MyApp). Longest first so Claude Projects wins over Desktop.
const HOME = os.homedir();
export const WORKSPACES = [path.join(HOME, 'Desktop', 'Claude Projects'), path.join(HOME, 'Desktop')];
export function fold(p, roots = WORKSPACES) {
  for (const r of roots) {
    if (p.toLowerCase().startsWith(r.toLowerCase() + path.sep)) return r + path.sep + p.slice(r.length + 1).split(path.sep)[0];
  }
  return p;
}
const MARKERS = ['package.json', '.git', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'app.json', 'index.html', 'settings.gradle', 'settings.gradle.kts'];
const SKIP_CHILD = /^(\.|node_modules$|scratchpad$|graphify-out$)/i;
const CONCURRENCY = 4;
const SEP = '\\';
const MACHINE_GAP_MS = 3600000; // Claude generating / waiting on a tool: counted up to 60 min, longer = abandoned

// Per-run memo tables (filesystem facts don't change within one run).
const realMemo = new Map(), containerMemo = new Map(), decodeMemo = new Map(), topMemo = new Map();

/** Windows-style absolute path: git-bash /c/ -> C:\, forward slashes -> \, no trailing \, upper-case drive. */
export function normalizePath(p) {
  let s = String(p).replace(/^\/([a-zA-Z])(?=\/|$)/, '$1:').replace(/\//g, '\\');
  s = s.replace(/^([a-z]):/, (_, d) => d.toUpperCase() + ':');
  if (s.length > 3) s = s.replace(/\\+$/, '');
  return s;
}

/** `<repo>\.claude\worktrees\<name>[\...]` -> `<repo>`. */
export const stripWorktree = (p) => p.replace(/\\\.claude\\worktrees\\[^\\]+.*$/i, '');

// Claude Code names the transcript folder after the session's start dir with every non-alphanumeric char -> '-'.
const encode = (p) => p.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();

/** Ancestor of cwd (itself included) whose encoded form equals the transcript folder name, or null. */
function ancestorMatching(cwd, encodedDir) {
  for (let p = cwd; ; ) {
    if (encode(p) === encodedDir) return p;
    const cut = p.lastIndexOf(SEP);
    if (cut <= 0) return null;
    p = p.slice(0, cut);
  }
}

/** Real folder a transcript folder name encodes, found by walking the disk (the encoding is lossy), or null. */
function decodeDir(encodedDir) {
  if (decodeMemo.has(encodedDir)) return decodeMemo.get(encodedDir);
  const walk = (cur) => {
    const e = encode(cur);
    if (e === encodedDir) return cur;
    if (!encodedDir.startsWith(e + '-')) return null;
    let kids = [];
    try { kids = fs.readdirSync(cur + SEP, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch {}
    for (const d of kids) { const hit = walk(cur + SEP + d.name); if (hit) return hit; }
    return null;
  };
  const res = /^[a-z]-/.test(encodedDir) ? walk(encodedDir[0].toUpperCase() + ':') : null;
  decodeMemo.set(encodedDir, res);
  return res;
}

const hasMarker = (dir) => MARKERS.some((m) => fs.existsSync(path.join(dir, m)));

/** Outermost ancestor of p (itself included, drive root excluded) that has a project marker, or p. */
function topProject(p) {
  let r = topMemo.get(p);
  if (r === undefined) {
    r = p;
    for (let q = p; q.lastIndexOf(SEP) > 2; q = q.slice(0, q.lastIndexOf(SEP))) if (hasMarker(q)) r = q;
    topMemo.set(p, r);
  }
  return r;
}

/** True on-disk spelling (case) of a path, falling back to the normalised input when it no longer exists. */
function canonical(p) {
  let c = realMemo.get(p);
  if (c === undefined) {
    try { c = normalizePath(fs.realpathSync.native(p)); } catch { c = p; }
    realMemo.set(p, c);
  }
  return c;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Longest names first so "Atlas C1" wins over "Atlas"; (?![\w-]) stops "atlas-v1" matching "Atlas".
const alt = (names) => [...names.values()].map((p) => path.basename(p)).sort((a, b) => b.length - a.length).map(esc).join('|');

/**
 * null if dir is not a container, else { re, kids, sibs } where kids/sibs map lower-case name -> full path.
 * kids: real child dirs. sibs: marker-bearing siblings (sessions started in the container often work on
 * Desktop\<project> without changing cwd).
 */
function containerInfo(dir) {
  if (containerMemo.has(dir)) return containerMemo.get(dir);
  let info = null;
  try {
    if (fs.statSync(dir).isDirectory() && !hasMarker(dir)) {
      const kids = new Map(), sibs = new Map();
      for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
        if (d.isDirectory() && !SKIP_CHILD.test(d.name)) kids.set(d.name.toLowerCase(), dir + SEP + d.name);
      }
      const parent = path.dirname(dir);
      if (parent.lastIndexOf(SEP) > 2) {
        for (const d of fs.readdirSync(parent, { withFileTypes: true })) {
          const p = parent + SEP + d.name;
          if (d.isDirectory() && !SKIP_CHILD.test(d.name) && p.toLowerCase() !== dir.toLowerCase() && hasMarker(p)) sibs.set(d.name.toLowerCase(), p);
        }
      }
      const parts = [];
      if (kids.size) parts.push(`${esc(path.basename(dir))}[\\\\/]+(${alt(kids)})`);
      if (sibs.size) parts.push(`${esc(path.basename(parent))}[\\\\/]+(${alt(sibs)})`);
      const re = parts.length ? new RegExp(`(?:${parts.join('|')})(?![\\w-])`, 'gi') : null;
      info = { re, kids, sibs, hasKids: kids.size > 0 };
    }
  } catch { info = null; }
  containerMemo.set(dir, info);
  return info;
}

/** Full path of the most frequently referenced child/sibling in the raw line (ties -> last occurrence), or null. */
function findRef(info, line) {
  if (!info.re) return null;
  const counts = new Map();
  let best = null, bestN = 0;
  for (const m of line.matchAll(info.re)) {
    const kid = info.hasKids ? m[1] : undefined;
    const name = kid !== undefined ? info.kids.get(kid.toLowerCase()) : info.sibs.get(m[info.hasKids ? 2 : 1].toLowerCase());
    const n = (counts.get(name) || 0) + 1;
    counts.set(name, n);
    if (n >= bestN) { best = name; bestN = n; }
  }
  return best;
}

const isInside = (p, dir) => p.length > dir.length && p.toLowerCase().startsWith(dir.toLowerCase() + SEP);
const isTemp = (p) => /\\AppData\\Local\\Temp(\\|$)/i.test(p);

/**
 * Project of one event. The cwd drifts (tools cd into src\, the scratchpad, ...) but stays the session's project
 * while it is inside the session folder or in Temp; a cwd elsewhere (e.g. after change_directory) is its own project.
 * Returns { root, ref } where ref is the full path of a container child/sibling named by the cwd or the raw line.
 */
function resolve(cwd, sessionDir, line) {
  let base;
  if (sessionDir && (cwd.toLowerCase() === sessionDir.toLowerCase() || isInside(cwd, sessionDir) || isTemp(cwd))) base = sessionDir;
  else base = topProject(stripWorktree(cwd));
  const root = canonical(stripWorktree(base));
  const info = containerInfo(root);
  if (!info) return { root, ref: null };
  const child = isInside(cwd, base) ? cwd.slice(base.length + 1).split(SEP)[0].toLowerCase() : null;
  return { root, ref: (child && info.kids.get(child)) || findRef(info, line) };
}

/**
 * The paths a line's tool calls actually worked in: file_path / notebook_path / path inputs and the targets of
 * cd / Set-Location / pushd in shell commands. Prose, tool output and listings never count, so naming a project
 * (a folder listing, an instruction to a subagent) does not move time to it.
 */
const CD_RE = /(?:^|&&|;|\|\||\n)\s*(?:cd|Set-Location|pushd)\s+("[^"]+"|'[^']+'|[^\s;&|]+)/gi;
export function workText(o) {
  const c = o.type === 'assistant' ? o.message?.content : null;
  if (!Array.isArray(c)) return '';
  const out = [];
  for (const b of c) {
    if (b?.type !== 'tool_use' || !b.input || typeof b.input !== 'object') continue;
    for (const k of ['file_path', 'notebook_path', 'path']) if (typeof b.input[k] === 'string') out.push(b.input[k]);
    if (typeof b.input.command === 'string') for (const m of b.input.command.matchAll(CD_RE)) out.push(m[1]);
  }
  return out.join('\n');
}

/** Real human prompt: a user line that is neither meta nor a tool_result (assistant lines / tool results = Claude busy). */
function isHumanPrompt(o) {
  if (o.type !== 'user' || o.isMeta) return false;
  const c = o.message?.content;
  return !(Array.isArray(c) && c.some((x) => x?.type === 'tool_result'));
}

async function parseFile(file, gapMs, encodedDir) {
  const events = []; // { t, root, ref } or, until the session folder is known, { t, cwd, line } (rare)
  let sessionDir = decodeDir(encodedDir);
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.includes('"type":"user"') && !line.includes('"type":"assistant"')) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (!o || (o.type !== 'user' && o.type !== 'assistant') || typeof o.timestamp !== 'string') continue;
    const t = Date.parse(o.timestamp);
    if (!Number.isFinite(t) || typeof o.cwd !== 'string' || !o.cwd) continue;
    const cwd = normalizePath(o.cwd);
    const human = isHumanPrompt(o);
    sessionDir ??= ancestorMatching(cwd, encodedDir); // folder deleted: learn it from a cwd instead
    if (sessionDir || !isTemp(cwd)) events.push({ t, human, ...resolve(cwd, sessionDir, workText(o)) });
    else events.push({ t, human, cwd, line: workText(o) });
  }
  for (const e of events) if (e.line !== undefined) { Object.assign(e, resolve(e.cwd, sessionDir, e.line)); e.line = undefined; }
  events.sort((a, b) => a.t - b.t);

  // Container events stick to the most recent reference; before the first one, backfill with the first one.
  const cur = new Map(); // container root -> referenced project path
  for (const e of events) if (e.ref && !cur.has(e.root)) cur.set(e.root, e.ref);
  const projects = [], idx = new Map(), iv = [];
  let prev = null;
  for (const e of events) {
    if (e.ref) cur.set(e.root, e.ref);
    const project = fold(cur.has(e.root) ? canonical(cur.get(e.root)) : e.root);
    if (prev !== null) {
      const gap = e.t - prev;
      // The idle cap applies only when the human was idle (gap ends on their prompt); other gaps are Claude working.
      if (gap > 0 && gap <= (e.human ? gapMs : MACHINE_GAP_MS)) {
        let pi = idx.get(project);
        if (pi === undefined) { pi = projects.length; projects.push(project); idx.set(project, pi); }
        const last = iv[iv.length - 1];
        if (last && last[2] === pi && last[1] === prev) last[1] = e.t;
        else iv.push([prev, e.t, pi]);
      }
    }
    prev = e.t;
  }
  return { projects, iv };
}

async function listJsonl(dir) {
  const out = [];
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }
  const subdirs = [];
  for (const d of entries) {
    const p = path.join(dir, d.name);
    // tool-results holds thousands of non-transcript files; skipping it keeps the warm run fast.
    if (d.isDirectory()) { if (d.name !== 'tool-results') subdirs.push(listJsonl(p)); }
    else if (d.isFile() && d.name.endsWith('.jsonl')) out.push(p);
  }
  for (const sub of await Promise.all(subdirs)) out.push(...sub);
  return out;
}

async function readCache(cachePath, gapMs) {
  try {
    const c = JSON.parse(await fsp.readFile(cachePath, 'utf8'));
    if (c.version === CACHE_VERSION && c.gapMs === gapMs && c.files) return c.files;
  } catch {}
  return {};
}

export async function loadClaudeIntervals({ projectsDir, cachePath, gapMs = 300000 }) {
  const old = cachePath ? await readCache(cachePath, gapMs) : {};
  const files = (await listJsonl(projectsDir)).sort();
  const next = {};
  let dirty = Object.keys(old).length !== files.length;
  let i = 0;
  async function worker() {
    while (i < files.length) {
      const f = files[i++];
      let st;
      try { st = await fsp.stat(f); } catch { dirty = true; continue; }
      const prev = old[f];
      if (prev && prev.mtimeMs === st.mtimeMs && prev.size === st.size) { next[f] = prev; continue; }
      dirty = true;
      // <encodedDir>\<sessionId>.jsonl, or <encodedDir>\<sessionId>\subagents\... for subagent transcripts.
      const parts = path.relative(projectsDir, f).split(path.sep);
      if (parts.length < 2) continue;
      try {
        const { projects, iv } = await parseFile(f, gapMs, parts[0].toLowerCase());
        next[f] = { mtimeMs: st.mtimeMs, size: st.size, session: parts[1].replace(/\.jsonl$/, ''), projects, iv };
      } catch { /* unreadable file: skip, retried next run */ }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  if (dirty && cachePath) {
    try {
      const tmp = `${cachePath}.${process.pid}.tmp`;
      await fsp.mkdir(path.dirname(cachePath), { recursive: true });
      await fsp.writeFile(tmp, JSON.stringify({ version: CACHE_VERSION, gapMs, files: next }));
      await fsp.rename(tmp, cachePath);
    } catch { /* cache is an optimisation; results are still valid */ }
  }

  // Same folder spelled differently across files (e.g. a deleted folder realpath can't fix) -> one key.
  const byLower = new Map();
  const intervals = [];
  for (const f of files) {
    const e = next[f];
    if (!e) continue;
    const keys = e.projects.map((p) => {
      const low = p.toLowerCase();
      if (!byLower.has(low)) byLower.set(low, p);
      return byLower.get(low);
    });
    for (const [start, end, pi] of e.iv) intervals.push({ start, end, project: keys[pi], session: e.session });
  }
  intervals.sort((a, b) => a.start - b.start);
  return { intervals };
}
