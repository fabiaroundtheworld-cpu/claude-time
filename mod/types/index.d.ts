// The Summary that `node report.mjs --json` prints (see ~/.claude/timetrack/CONTRACT.md). Durations in ms.
export type TimetrackTotals = { today: number; week: number; month: number }

export type TimetrackProject = {
  key: string
  name: string
  today: number
  week: number
  month: number
  allTime: number
  last30: number[]
  sessionsMonth: number
  lastActiveAt: number
}

export type TimetrackInsight = { level: 'good' | 'info' | 'warn'; text: string }

export type TimetrackSummary = {
  generatedAt: number
  goalHours: number
  claude: {
    totals: TimetrackTotals & { allTime: number }
    goalProgress: number
    streakDays: number
    sessionsToday: number
    longestBlockTodayMs: number
    projects: TimetrackProject[]
    daily: Array<{ day: string; totalMs: number; byProject: Record<string, number> }>
    hourly: number[]
  }
  computer: {
    totals: TimetrackTotals
    chrome: TimetrackTotals
    topAppsToday: Array<{ app: string; ms: number }>
    topAppsWeek: Array<{ app: string; ms: number }>
    daily: Array<{ day: string; totalMs: number; chromeMs: number }>
    trackerAlive: boolean
    heartbeatAt: number | null
    trackingSince?: string | null
  }
  insights: TimetrackInsight[]
}

declare module 'claude-code' {
  interface PluginState {
    timetrack: {
      summary: TimetrackSummary | null
      isLoading: boolean
      error: string | null
    }
  }
}
