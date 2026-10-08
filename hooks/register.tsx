import { atom, read, update } from 'claude-code'
import type { Register, SessionRateLimit } from 'claude-code'

import type { Limits, Window } from '../types'

const limits = atom({ plugin: 'usage-band', key: 'limits' } as const, [] as Limits)
const now = atom({ plugin: 'usage-band', key: 'now' } as const, 0)

const BAR_CELLS = 12

// The account-wide windows first, then any other window the engine reports
// (a per-model one such as Fable's), in the order it reports them. A spend
// limit is a gateway's budget, not a usage window, so it stays out.
const ORDER = ['five_hour', 'seven_day']

export function toLimits(rateLimits: SessionRateLimit[]): Limits {
  return rateLimits
    .filter(r => r.kind !== 'spend_limit')
    .map(r => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt }))
    .sort((a, b) => rank(a.kind) - rank(b.kind))
}

function rank(kind: string): number {
  const i = ORDER.indexOf(kind)
  return i === -1 ? ORDER.length : i
}

// 'five_hour' → '5h', 'seven_day' → '7d', 'seven_day_fable' → 'Fable'.
export function labelOf(kind: string): string {
  if (kind === 'five_hour') return '5h'
  if (kind === 'seven_day') return '7d'
  const model = kind.replace(/^(five_hour|seven_day)_?/, '')
  return model ? model.charAt(0).toUpperCase() + model.slice(1).replace(/_/g, ' ') : kind
}

export function bar(percent: number): [string, string] {
  const filled = Math.max(0, Math.min(BAR_CELLS, Math.round((percent / 100) * BAR_CELLS)))
  return ['━'.repeat(filled), '━'.repeat(BAR_CELLS - filled)]
}

export function untilReset(resetsAt: string | undefined, nowMs: number): string {
  if (!resetsAt || !nowMs) return ''
  const mins = Math.max(0, Math.round((Date.parse(resetsAt) - nowMs) / 60000))
  if (Number.isNaN(mins)) return ''
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  if (d > 0) return `resets in ${d}d ${h}h`
  if (h > 0) return `resets in ${h}h ${m}m`
  return `resets in ${m}m`
}

// Claude's clay palette: a lighter-to-deeper gradient per severity.
const FILLS: Record<string, [string, string]> = {
  claude: ['#E8A07F', '#D97757'],
  warning: ['#EBC07A', '#D4943A'],
  error: ['#E88A7A', '#C6493A'],
}

// No viewBox: the pill stretches to whatever width its flex slot gives it,
// while rx stays in real pixels so the rounded ends never distort.
export function pillSvg(percent: number, height = 6): string {
  const [from, to] = FILLS[tone(percent)]
  const r = height / 2
  const p = Math.max(0, Math.min(100, percent))
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="${height}">` +
    `<defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>` +
    `<rect width="100%" height="${height}" rx="${r}" fill="#D97757" fill-opacity="0.16"/>` +
    (p > 0 ? `<rect width="${p}%" style="width:max(${height}px, ${p}%)" height="${height}" rx="${r}" fill="url(#g)"/>` : '') +
    `</svg>`
  )
}

export function tone(percent: number): string {
  if (percent >= 90) return 'error'
  if (percent >= 75) return 'warning'
  return 'claude'
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const usage = await $.session.usage()
    await update($, limits, () => toLimits(usage.rateLimits))
    const t0 = await $.clock.now()
    await update($, now, () => t0)
    $.clock.every(60_000, () => {
      void (async () => {
        const t = await $.clock.now()
        await update($, now, () => t)
      })()
    })
    return result
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      await update($, limits, () => toLimits(e.rateLimits))
      const t = await $.clock.now()
      await update($, now, () => t)
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const windows = await read($, limits)
    if (windows.length === 0) return next(e)

    const nowMs = await read($, now)
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    const Svg = 'Svg' in els ? els.Svg : null

    const meter = (w: Window) => {
      const label = labelOf(w.kind)
      const isGeneral = ORDER.includes(w.kind)
      const pct = Math.round(w.percentUsed)
      // The time left until the window resets stands in for its name.
      const left = untilReset(w.resetsAt, nowMs).replace('resets in ', '')
      // A model's own window keeps its name, so it is not mistaken for the 7d one.
      const lead = isGeneral ? left || label : left ? `${label} ${left}` : label
      let gauge
      if (Svg) {
        gauge = (
          <Box flexGrow={1} flexShrink={1} minWidth={8}>
            <Svg source={pillSvg(w.percentUsed)} alt={`${label} ${pct}% used`} height={6} />
          </Box>
        )
      } else {
        const [full, empty] = bar(w.percentUsed)
        gauge = (
          <Text>
            <Text color={tone(w.percentUsed)}>{full}</Text>
            <Text color="subtle">{empty}</Text>
          </Text>
        )
      }
      return (
        <Box key={w.kind} flexDirection="row" alignItems="center" gap={2} flexGrow={1} flexShrink={1}>
          <Box flexShrink={0}>
            <Text color="subtle" wrap="truncate">{lead}</Text>
          </Box>
          {gauge}
          <Box flexShrink={0}>
            <Text color={tone(w.percentUsed)} bold wrap="truncate">{`${pct}%`}</Text>
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="row" flexWrap="nowrap" alignItems="center" columnGap={3} width="100%">
        {windows.flatMap((w, i) => [
          ...(i > 0 ? [<Text key={`sep-${w.kind}`} color="subtle">│</Text>] : []),
          meter(w),
        ])}
      </Box>
    )
  })
}
