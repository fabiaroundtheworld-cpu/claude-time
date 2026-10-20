import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const HOUR = 3600000
const MIN = 60000
const NOW = Date.UTC(2026, 9, 20, 16, 0, 0)

const SUMMARY = {
  generatedAt: NOW - 5000,
  goalHours: 6,
  claude: {
    totals: { today: 3 * HOUR + 5 * MIN, week: 20 * HOUR, month: 80 * HOUR + 30 * MIN, allTime: 500 * HOUR },
    goalProgress: (3 * HOUR + 5 * MIN) / (6 * HOUR),
    streakDays: 4,
    sessionsToday: 3,
    longestBlockTodayMs: HOUR,
    projects: [
      { key: 'C:/p/atlas', name: 'Atlas App', today: 2 * HOUR, week: 10 * HOUR, month: 40 * HOUR, allTime: 200 * HOUR, last30: [], sessionsMonth: 9, lastActiveAt: NOW },
      { key: 'C:/p/desk', name: 'Tour Desk', today: 35 * MIN, week: 4 * HOUR + 12 * MIN, month: 9 * HOUR, allTime: 50 * HOUR, last30: [], sessionsMonth: 3, lastActiveAt: NOW },
    ],
    daily: [],
    hourly: [],
  },
  computer: {
    totals: { today: 7 * HOUR, week: 30 * HOUR, month: 120 * HOUR },
    chrome: { today: 90 * MIN, week: 8 * HOUR, month: 33 * HOUR },
    topAppsToday: [],
    topAppsWeek: [],
    daily: [],
    trackerAlive: false,
    heartbeatAt: null,
  },
  insights: [
    { level: 'good', text: 'Goal streak of 4 days.' },
    { level: 'warn', text: 'Late nights this week.' },
  ],
}

const PANE = {
  plugin: 'timetrack',
  component: 'Pane',
  requestId: 'timetrack',
  props: { title: 'Time tracker', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  viewport: { columns: 120, rows: 40 },
} as const

function cmd(args: string) {
  return { command: 'cludetime', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 120 } }
}

function stubEngine(on: On, runs: string[][]) {
  mock.clock(on, { now: NOW })
  mock.store(on)
  mock.env(on, { USERPROFILE: 'C:\\Users\\test' })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.status', () => ({ value: undefined }))
  on('process.run', ($, e) => {
    runs.push([...e.argv])
    const isJson = e.argv.includes('--json')
    return {
      value: {
        exitCode: 0,
        stdout: isJson ? JSON.stringify(SUMMARY) : 'C:\\Users\\test\\.claude\\timetrack\\dashboard.html\n',
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
}

test('the pane draws the summary numbers after the first refresh', async ($, on) => {
  const runs: string[][] = []
  stubEngine(on, runs)
  await $.session.start({ cwd: 'C:/p', surface: 'terminal', isInteractive: true })
  await $.command.run(cmd('refresh'))

  expect(runs[0]).toEqual(['node', 'C:\\Users\\test/.claude/timetrack/report.mjs', '--json'])
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const body = (await ui.find({ key: 'body' }))?.text ?? ''
    expect(body).toContain('| Claude Code | 3h 05m | 20h 00m | 80h 30m |')
    expect(body).toContain('| Computer | 7h 00m | 30h 00m | 120h 00m |')
    expect(body).toContain('| Chrome | 1h 30m | 8h 00m | 33h 00m |')
    expect(body).toContain('(51%) · streak 4 days')
    expect(body).toContain('| Tour Desk | 35m | 4h 12m | 9h 00m |')
    expect(body).toContain('✓ Goal streak of 4 days.')
    expect(body).toContain('⚠ Late nights this week.')
    expect(body).toContain('logger stopped')
    expect(body).toContain('updated 5s ago')
    expect(await ui.find({ key: 'dashboard' })).toBeDefined()
    expect(await ui.find({ key: 'refresh' })).toBeDefined()
    await ui.unmount()
  }
})

test('/cludetime opens the pane and says so; report runs the dashboard', async ($, on) => {
  const runs: string[][] = []
  stubEngine(on, runs)
  await $.session.start({ cwd: 'C:/p', surface: 'terminal', isInteractive: true })

  const opened = await $.command.run(cmd(''))
  expect(opened.text).toBe('Time tracker pane opened.')

  const report = await $.command.run(cmd('report'))
  expect(report.text).toContain('dashboard.html')
  expect(runs.some(argv => argv.includes('--html') && argv.includes('--open'))).toBe(true)
})

test('a failed refresh keeps the last good summary and shows the error', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on, { summary: SUMMARY })
  mock.env(on, { USERPROFILE: 'C:\\Users\\test' })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.status', () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: 'boom', isStdoutTruncated: false, isStderrTruncated: false } }))
  await $.session.start({ cwd: 'C:/p', surface: 'terminal', isInteractive: true })

  const res = await $.command.run(cmd('refresh'))
  expect(res.text).toBe('Refresh failed: boom')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const body = (await ui.find({ key: 'body' }))?.text ?? ''
  expect(body).toContain('**Error:** boom')
  expect(body).toContain('| Claude Code | 3h 05m |')
})
