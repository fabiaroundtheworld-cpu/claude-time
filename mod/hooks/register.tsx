import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TimetrackSummary } from '../types'

const PANE = 'timetrack'
const TITLE = 'Time tracker'
const STORE_KEY = 'summary'
const MARKERS = { good: '✓', info: '•', warn: '⚠' } as const

const summaryAtom = atom({ plugin: 'timetrack', key: 'summary' } as const, null)
const loadingAtom = atom({ plugin: 'timetrack', key: 'isLoading' } as const, false)
const errorAtom = atom({ plugin: 'timetrack', key: 'error' } as const, null)

export function fmt(ms: number): string {
  const total = Math.round(Math.max(0, ms) / 60000)
  const h = Math.floor(total / 60)
  const m = total % 60
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
}

function statusText(s: TimetrackSummary): string {
  return `⏱ ${fmt(s.claude.totals.today)} / ${s.goalHours}h (${Math.round(s.claude.goalProgress * 100)}%)`
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|')
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : fmt(s * 1000)
}

// Sections in display order; whole sections are dropped from the end when the pane is short.
export function paneMarkdown(
  s: TimetrackSummary | null,
  isLoading: boolean,
  error: string | null,
  now: number,
  rows: number,
): string {
  const state = isLoading ? 'loading...' : s ? `updated ${ago(now - s.generatedAt)} ago` : 'no data yet'
  const head = [`_${state}_`]
  if (error) head.push(`**Error:** ${cell(error.split('\n')[0] ?? '')}`)
  if (!s) return head.join('\n\n')
  if (!s.computer.trackerAlive) head.push('⚠ **The background computer logger stopped**: computer and Chrome time is not being recorded.')

  const c = s.claude.totals
  const pc = s.computer.totals
  const ch = s.computer.chrome
  const ts = s.computer.trackingSince
  const gen = new Date(s.generatedAt)
  const partial = ts != null && ts > `${gen.getFullYear()}-${String(gen.getMonth() + 1).padStart(2, '0')}-01`
  const sinceNote = partial ? `

_Computer and Chrome tracked since ${ts}._` : ''
  const table = [
    '| | Today | Week | Month |',
    '|---|---:|---:|---:|',
    `| Claude Code | ${fmt(c.today)} | ${fmt(c.week)} | ${fmt(c.month)} |`,
    `| Computer | ${fmt(pc.today)} | ${fmt(pc.week)} | ${fmt(pc.month)} |`,
    `| Chrome | ${fmt(ch.today)} | ${fmt(ch.week)} | ${fmt(ch.month)} |`,
  ]

  const width = 20
  const filled = Math.min(width, Math.round(s.claude.goalProgress * width))
  const goal = [
    `\`${'█'.repeat(filled)}${'░'.repeat(width - filled)}\` ${fmt(c.today)} / ${s.goalHours}h ` +
      `(${Math.round(s.claude.goalProgress * 100)}%) · streak ${s.claude.streakDays} day${s.claude.streakDays === 1 ? '' : 's'}`,
  ]

  const top = s.claude.projects.slice(0, 6)
  const projects = top.length
    ? [
        '| Project | Today | Week | Month |',
        '|---|---:|---:|---:|',
        ...top.map(p => `| ${cell(p.name)} | ${fmt(p.today)} | ${fmt(p.week)} | ${fmt(p.month)} |`),
      ]
    : []

  const insights = s.insights.slice(0, 4).map(i => `- ${MARKERS[i.level] ?? '•'} ${i.text}`)

  // shortcut: line counts approximate drawn rows (a table's frame may add a few), fine for a sidebar.
  let budget = rows - 3 // the button row and spacing
  const out: string[] = []
  for (const section of [head.join('\n\n'), table.join('\n') + sinceNote, goal.join('\n'), projects.join('\n'), insights.join('\n')]) {
    if (!section) continue
    const lines = section.split('\n').length + 1
    if (out.length > 0 && lines > budget) break
    out.push(section)
    budget -= lines
  }
  return out.join('\n\n')
}

// Never two refreshes at once: callers share the run in flight.
let inFlight: Promise<void> | null = null

async function reportPath($: EngineInterface): Promise<string> {
  const home = await $.env.get('USERPROFILE')
  if (!home) throw new Error('USERPROFILE is not set')
  return `${home}/.claude/timetrack/report.mjs` // node accepts forward slashes on Windows
}

function refresh($: EngineInterface): Promise<void> {
  if (inFlight) return inFlight
  inFlight = (async () => {
    await update($, loadingAtom, () => true)
    try {
      const run = await $.process.run(['node', await reportPath($), '--json'], { timeoutMs: 600000 })
      if (run.exitCode !== 0) throw new Error(run.stderr.trim() || `report.mjs exited with ${run.exitCode}`)
      const summary = JSON.parse(run.stdout) as TimetrackSummary
      await update($, summaryAtom, () => summary)
      await update($, errorAtom, () => null)
      $.ui.status(statusText(summary))
      await $.store.set(STORE_KEY, summary)
    } catch (err) {
      // keep the last good summary; only remember why this run failed
      await update($, errorAtom, () => (err instanceof Error ? err.message : String(err)))
    } finally {
      await update($, loadingAtom, () => false)
      inFlight = null
    }
  })()
  return inFlight
}

async function openDashboard($: EngineInterface): Promise<string> {
  const run = await $.process.run(['node', await reportPath($), '--html', '--open'], { timeoutMs: 600000 })
  if (run.exitCode !== 0) throw new Error(run.stderr.trim() || `report.mjs exited with ${run.exitCode}`)
  return run.stdout.trim()
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'cludetime',
      description: 'Time tracker: open the pane, or `report` (HTML dashboard) / `refresh`',
      argumentHint: '[report|refresh]',
    })
    const stored = (await $.store.get(STORE_KEY)) as TimetrackSummary | undefined
    if (stored) {
      await update($, summaryAtom, () => stored)
      $.ui.status(statusText(stored))
    }
    void $.ui.open({ id: PANE, title: TITLE })
    void refresh($)
    $.clock.every(60000, () => void refresh($))

    return next(e)
  })

  on('command.run', { command: 'cludetime' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    try {
      if (arg === '') {
        const opened = await $.ui.open({ id: PANE, title: TITLE })
        return { text: opened.isPlaced ? 'Time tracker pane opened.' : `Time tracker pane is waiting to open: ${opened.reason}.` }
      }
      if (arg === 'report') {
        const path = await openDashboard($)
        return { text: `Dashboard built and opened${path ? `: ${path}` : '.'}` }
      }
      if (arg === 'refresh') {
        await refresh($)
        const [summary, error] = await Promise.all([read($, summaryAtom), read($, errorAtom)])
        if (error) return { text: `Refresh failed: ${error}` }
        return { text: summary ? `Refreshed. Claude Code today: ${statusText(summary)}` : 'Refreshed.' }
      }
    } catch (err) {
      return { text: `timetrack: ${err instanceof Error ? err.message : String(err)}` }
    }
    return { text: 'Usage: /cludetime (open the pane), /cludetime report (HTML dashboard), /cludetime refresh' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Markdown, Text } = $.ui.resolve(e)
    const [summary, isLoading, error, now] = await Promise.all([
      read($, summaryAtom),
      read($, loadingAtom),
      read($, errorAtom),
      $.clock.now(),
    ])
    const rows = e.viewport?.rows ?? 40

    return (
      <Box flexDirection="column">
        <Markdown key="body" text={paneMarkdown(summary, isLoading, error, now, rows)} />
        <Box flexDirection="row" gap={1}>
          <Button
            key="dashboard"
            label="Open full dashboard"
            variant="primary"
            onPress={() =>
              openDashboard($).catch(err => update($, errorAtom, () => (err instanceof Error ? err.message : String(err))))
            }
          />
          <Button key="refresh" label={isLoading ? 'Refreshing...' : 'Refresh'} onPress={() => refresh($)} />
        </Box>
        {isLoading && summary === null && <Text dimColor>The first run parses every transcript and can take a few minutes.</Text>}
      </Box>
    )
  })
}
