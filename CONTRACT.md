# timetrack — shared contract (all agents build against this)

Folder: C:\Users\fabia\.claude\timetrack\  (Node 24 is installed; ESM `.mjs`; NO npm dependencies; tests use `node:test` + `node:assert`, run with `node --test`).
User settings: daily goal 6 h of Claude Code time, week starts Monday, idle gap 5 min. All dates are LOCAL time (UTC-4 machine); never use toISOString() for day keys.

## Data sources
- Claude Code transcripts: C:\Users\fabia\.claude\projects\<encoded-folder>\<sessionId>.jsonl (and subagent files in subfolders). 2.2 GB, 1271 files, so parsing MUST be cached by file path + mtime + size.
  Each line is JSON. Relevant lines have `type` "user" or "assistant", plus `timestamp` (ISO UTC string), `cwd` (absolute path), `sessionId`, `isSidechain`. Other types (queue-operation, attachment, system, ...) are ignored.
- Computer logger (already running, written by tracker.ps1): pc\YYYY-MM-DD.log, one line per 15-second sample while the user is active: `HH:mm:ss<TAB>processName` (e.g. `chrome`, `claude`, `Code`). File `heartbeat` holds an ISO timestamp rewritten every 15 s while the logger runs.

## Modules and signatures
claude.mjs   export async function loadClaudeIntervals({ projectsDir, cachePath, gapMs = 300000 })
               -> { intervals: Array<{ start: number, end: number, project: string, session: string }> }
               start/end epoch ms; project = absolute project root path; session = main session id (subagent files map to their parent session).
pc.mjs       export async function loadPcDays({ pcDir, sinceDay /* 'YYYY-MM-DD' */, sampleMs = 15000 })
               -> { days: Record<'YYYY-MM-DD', { totalMs: number, chromeMs: number, apps: Record<string, number> }>, lastSampleAt: number | null }
             export async function readHeartbeat(path) -> number | null   (epoch ms)
summary.mjs  export function buildSummary({ intervals, pcDays, heartbeatAt, now, goalHours = 6, weekStartsOn = 1 }) -> Summary
html.mjs     export function renderHtml(summary) -> string   (complete self-contained HTML document)
report.mjs   CLI wiring the above with real paths:
               node report.mjs --json          prints Summary JSON on stdout (nothing else on stdout)
               node report.mjs --html          writes dashboard.html beside report.mjs, prints its absolute path
               node report.mjs --html --open   same, then opens it in the default browser

## Summary (all durations in ms)
{
  generatedAt: number,
  goalHours: number,
  claude: {
    totals: { today, week, month, allTime },      // UNION across projects: concurrent sessions never double-count
    goalProgress: number,                          // totals.today / goal (can exceed 1)
    streakDays: number,                            // consecutive days meeting goal, ending today (or yesterday if today not met yet)
    sessionsToday: number,
    longestBlockTodayMs: number,                   // longest contiguous active stretch today
    projects: Array<{ key: string /*abs path*/, name: string /*unique display name*/, today, week, month, allTime,
                      last30: number[] /*30 values, oldest -> today*/, sessionsMonth: number, lastActiveAt: number }>,
                                                   // every project ever seen, sorted by week desc, then allTime desc
    daily: Array<{ day: 'YYYY-MM-DD', totalMs: number, byProject: Record<string /*name*/, number> }>,  // last 30 days, oldest -> today
    hourly: number[]                               // 24 values: ms per hour-of-day over the last 30 days (union)
  },
  computer: {
    totals: { today, week, month },
    chrome: { today, week, month },
    topAppsToday: Array<{ app: string, ms: number }>,   // top 8
    topAppsWeek:  Array<{ app: string, ms: number }>,   // top 8
    daily: Array<{ day, totalMs, chromeMs }>,           // last 30 days, oldest -> today
    trackerAlive: boolean,                              // heartbeat newer than 2 minutes
    heartbeatAt: number | null,
    trackingSince: string | null                        // first day with computer data ('YYYY-MM-DD')
  },
  insights: Array<{ level: 'good' | 'info' | 'warn', text: string }>   // short plain sentences, most important first
}
