import { test, expect } from 'claude-code/testing'

import { bar, labelOf, pillSvg, tone, toLimits, untilReset } from './register'

test('keeps every usage window, account-wide ones first, no spend limit', async () => {
  const limits = toLimits([
    { kind: 'seven_day_fable', percentUsed: 30 },
    { kind: 'seven_day', percentUsed: 12 },
    { kind: 'spend_limit', percentUsed: 3 },
    { kind: 'five_hour', percentUsed: 42.5, resetsAt: '2026-10-08T15:00:00Z' },
  ])
  expect(limits.map(l => l.kind)).toEqual(['five_hour', 'seven_day', 'seven_day_fable'])
  expect(toLimits([]).length).toBe(0)
})

test('labels windows', async () => {
  expect(labelOf('five_hour')).toBe('5h')
  expect(labelOf('seven_day')).toBe('7d')
  expect(labelOf('seven_day_fable')).toBe('Fable')
})

test('bar fills proportionally and clamps', async () => {
  expect(bar(50)[0].length).toBe(6)
  expect(bar(150)[0].length).toBe(12)
  expect(bar(0)[1].length).toBe(12)
})

test('tone escalates with usage', async () => {
  expect(tone(10)).toBe('claude')
  expect(tone(80)).toBe('warning')
  expect(tone(95)).toBe('error')
})

test('reset countdown', async () => {
  const now = Date.parse('2026-10-08T12:00:00Z')
  expect(untilReset('2026-10-08T14:30:00Z', now)).toBe('resets in 2h 30m')
  expect(untilReset('2026-10-11T15:00:00Z', now)).toBe('resets in 3d 3h')
  expect(untilReset('2026-10-08T12:20:00Z', now)).toBe('resets in 20m')
  expect(untilReset(undefined, now)).toBe('')
})

test('pill svg uses the clay palette and scales the fill', async () => {
  expect(pillSvg(50)).toContain('#D97757')
  expect(pillSvg(50)).toContain('50%')
  expect(pillSvg(95)).toContain('#C6493A')
  expect(pillSvg(0)).not.toContain('url(#g)')
})
