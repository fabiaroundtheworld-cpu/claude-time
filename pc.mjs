import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const FRIENDLY = {
  claude: 'Claude', chrome: 'Chrome', code: 'VS Code', explorer: 'File Explorer',
  windowsterminal: 'Terminal', msedge: 'Edge', firefox: 'Firefox', powershell: 'PowerShell',
  pwsh: 'PowerShell', cmd: 'Command Prompt', slack: 'Slack', discord: 'Discord',
  spotify: 'Spotify', notepad: 'Notepad', 'notepad++': 'Notepad++', winword: 'Word',
  excel: 'Excel', powerpnt: 'PowerPoint', outlook: 'Outlook', teams: 'Teams', 'ms-teams': 'Teams',
  zoom: 'Zoom', obs64: 'OBS', vlc: 'VLC', figma: 'Figma', cursor: 'Cursor',
};

const LINE = /^(\d{2}):(\d{2}):(\d{2})\t(.+)$/;

export async function loadPcDays({ pcDir, sinceDay, sampleMs = 15000 }) {
  const days = {};
  let lastSampleAt = null;
  let files = [];
  try { files = await readdir(pcDir); } catch { return { days, lastSampleAt }; }
  for (const f of files) {
    const m = /^(\d{4})-(\d{2})-(\d{2})\.log$/.exec(f);
    if (!m || (sinceDay && f.slice(0, 10) < sinceDay)) continue;
    let text;
    try { text = await readFile(join(pcDir, f), 'utf8'); } catch { continue; }
    const day = { totalMs: 0, chromeMs: 0, apps: {} };
    const lines = text.split(/\r?\n/);
    lines.pop(); // tracker terminates every line; the last segment is empty or still being written
    for (const raw of lines) {
      const l = LINE.exec(raw);
      if (!l) continue;
      const proc = l[4].trim();
      if (!proc) continue;
      const app = FRIENDLY[proc.toLowerCase()] ?? proc;
      day.totalMs += sampleMs;
      if (proc.toLowerCase() === 'chrome') day.chromeMs += sampleMs;
      day.apps[app] = (day.apps[app] ?? 0) + sampleMs;
      const at = new Date(+m[1], +m[2] - 1, +m[3], +l[1], +l[2], +l[3]).getTime();
      if (lastSampleAt === null || at > lastSampleAt) lastSampleAt = at;
    }
    if (day.totalMs) days[f.slice(0, 10)] = day;
  }
  return { days, lastSampleAt };
}

export async function readHeartbeat(path) {
  try {
    // .NET writes 7 fractional digits; trim to ms so Date.parse is not engine-dependent
    const s = (await readFile(path, 'utf8')).trim().replace(/(\.\d{3})\d+/, '$1');
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : t;
  } catch { return null; }
}
