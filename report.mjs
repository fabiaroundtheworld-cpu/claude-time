// CLI: node report.mjs --json | --html [--open]
import os from 'node:os';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadClaudeIntervals } from './claude.mjs';
import { loadPcDays, readHeartbeat } from './pc.mjs';
import { buildSummary, dayKey } from './summary.mjs';
import { renderHtml } from './html.mjs';

const args = new Set(process.argv.slice(2));
const home = os.homedir();
const base = path.join(home, '.claude', 'timetrack');

async function main() {
  if (!args.has('--json') && !args.has('--html')) throw new Error('usage: node report.mjs --json | --html [--open]');
  const now = Date.now();
  const d = new Date(now);
  const sinceDay = dayKey(new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime());
  const [{ intervals }, { days }, heartbeatAt] = await Promise.all([
    loadClaudeIntervals({ projectsDir: path.join(home, '.claude', 'projects'), cachePath: path.join(base, 'cache', 'claude-intervals.json') }),
    loadPcDays({ pcDir: path.join(base, 'pc'), sinceDay }),
    readHeartbeat(path.join(base, 'heartbeat')),
  ]);
  const summary = buildSummary({ intervals, pcDays: days, heartbeatAt, now });

  if (args.has('--json')) return void process.stdout.write(JSON.stringify(summary) + '\n');

  const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dashboard.html');
  await writeFile(out, renderHtml(summary), 'utf8');
  process.stdout.write(out + '\n');
  if (args.has('--open')) {
    const child = process.platform === 'win32'
      ? spawn('cmd', ['/c', 'start', '""', `"${out}"`], { windowsVerbatimArguments: true, detached: true, stdio: 'ignore' })
      : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [out], { detached: true, stdio: 'ignore' });
    child.on('error', (e) => { console.error(`could not open browser: ${e.message}`); process.exitCode = 1; });
    child.unref();
  }
}

main().catch((e) => { console.error(e?.stack || String(e)); process.exit(1); });
