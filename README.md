# claude-time

A Claude Code mod that tracks how much time you spend in Claude Code, per project and in total, plus your active computer time and Chrome time. It shows daily, weekly and monthly counters, a 6-hour daily goal with a streak, and written feedback.

- **In Claude Code:** a live pane, a status-line counter, and the `/cludetime` command.
- **In the browser:** `/cludetime report` builds a full HTML dashboard with charts, every project, top apps and your working hours.

Windows only for computer and Chrome tracking. Needs Node 20 or newer.

## Install

```bash
git clone https://github.com/fabiaroundtheworld-cpu/claude-time.git "%USERPROFILE%\.claude\timetrack"
node "%USERPROFILE%\.claude\timetrack\install.mjs"
```

The installer does two things, and running it again changes nothing:

1. It starts the background logger now and at every logon, through a hidden launcher in your Startup folder.
2. It adds the `mod` folder to `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json`, so every Claude Code session loads the mod.

Restart Claude Code, then run `/cludetime`.

## Commands

| Command | What it does |
|---|---|
| `/cludetime` | Opens the time tracker pane |
| `/cludetime report` | Builds and opens the HTML dashboard |
| `/cludetime refresh` | Recomputes the numbers now (the pane also refreshes every minute) |

From a terminal, `node report.mjs --json` prints the raw numbers and `node report.mjs --html --open` opens the dashboard.

## How time is counted

**Claude Code time** comes from the transcripts Claude Code already writes in `~/.claude/projects`, so past sessions count too.

- A pause that ends with your next prompt counts only if it is 5 minutes or shorter. A longer pause is idle time.
- A pause while Claude works or waits on a tool, such as a long build, counts in full up to 60 minutes.
- Sessions that overlap, including subagents, count once in the totals.
- Each project is the top-level folder on your Desktop or inside `Desktop\Claude Projects`. A session started in a folder that holds several projects is credited to the project whose files it actually reads, edits or changes into. Project names that only appear in text don't count.

**Computer time** comes from `tracker.ps1`. Every 15 seconds it records the app in front. It skips the sample when there has been no keyboard or mouse input for 5 minutes, or the screen is locked. **Chrome time** is the share of those samples where Chrome was in front. Computer and Chrome totals start from the day the logger was installed, and the dashboard says so.

## Privacy

Everything stays on your machine. The logger records only the app name and the time, never window titles, URLs or keystrokes. Logs, the cache and the generated dashboard are in `.gitignore`.

## Files

| File | Role |
|---|---|
| `tracker.ps1` | Background logger for computer and Chrome time |
| `claude.mjs` | Turns transcripts into per-project time, with a cache |
| `pc.mjs` | Reads the logger's daily files |
| `summary.mjs` | Counters, goal, streak and feedback |
| `html.mjs` | The HTML dashboard |
| `report.mjs` | Command-line entry point |
| `mod/` | The Claude Code mod: pane, status line and `/cludetime` |
| `CONTRACT.md` | The data format shared by the modules |

Run the tests with `node --test claude.test.mjs pc.test.mjs summary.test.mjs html.test.mjs`, and test the mod with `claude plugin test mod`.
