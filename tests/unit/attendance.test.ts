import { describe, expect, it } from 'vitest'
import {
  attendanceView,
  inPeriod,
  nextAttendance,
  parsePeriod,
  periodKey,
  periodLabel,
  shiftPeriod,
  summarizeAttendance,
} from '@/lib/domain/attendance'

const NOW = new Date('2026-11-12T12:00:00Z')
const PRAGUE = 'Europe/Prague'
const past = { startAt: '2026-11-04T16:00:00Z', endAt: '2026-11-04T17:00:00Z' }
const running = { startAt: '2026-11-12T11:30:00Z', endAt: '2026-11-12T12:30:00Z' }
const future = { startAt: '2026-11-20T16:00:00Z', endAt: '2026-11-20T17:00:00Z' }

describe('attendanceView (decision 40)', () => {
  it('cannot be marked before the start', () => {
    expect(attendanceView(null, future, NOW)).toBe('locked')
    expect(attendanceView('PRESENT', future, NOW)).toBe('locked')
  })

  it('is unmarked while the training runs', () => {
    expect(attendanceView(null, running, NOW)).toBe('unmarked')
  })

  it('reads an unmarked booking as Nebyl once the training is over', () => {
    expect(attendanceView(null, past, NOW)).toBe('absent')
  })

  it('shows what was marked', () => {
    expect(attendanceView('PRESENT', past, NOW)).toBe('present')
    expect(attendanceView('ABSENT', running, NOW)).toBe('absent')
  })
})

describe('nextAttendance (K2)', () => {
  it('cycles unmarked → Byl → Nebyl → Byl, never back to unmarked', () => {
    expect(nextAttendance(null)).toBe('PRESENT')
    expect(nextAttendance('PRESENT')).toBe('ABSENT')
    expect(nextAttendance('ABSENT')).toBe('PRESENT')
  })
})

describe('summarizeAttendance (K13, G8b)', () => {
  const item = (mark: 'PRESENT' | 'ABSENT' | null, at = past, sessionCancelled = false) => ({
    ...at,
    mark,
    sessionCancelled,
  })

  it('is Byl / (Byl + Nebyl), unmarked past ones counting as Nebyl', () => {
    const summary = summarizeAttendance(
      [item('PRESENT'), item('PRESENT'), item('ABSENT'), item(null)],
      NOW,
    )
    expect(summary).toEqual({ present: 2, absent: 2, percent: 50 })
  })

  it('leaves out cancelled trainings, future ones and one still unmarked under way', () => {
    const summary = summarizeAttendance(
      [item('PRESENT'), item('ABSENT', past, true), item(null, future), item(null, running)],
      NOW,
    )
    expect(summary).toEqual({ present: 1, absent: 0, percent: 100 })
  })

  it('has no percentage with nothing to count', () => {
    expect(summarizeAttendance([], NOW).percent).toBeNull()
  })

  it('rounds: 8 of 9 is 89 %', () => {
    const items = [...Array.from({ length: 8 }, () => item('PRESENT')), item('ABSENT')]
    expect(summarizeAttendance(items, NOW).percent).toBe(89)
  })
})

describe('periods (Měsíc / Rok)', () => {
  const november = { kind: 'month', year: 2026, month: 11 } as const

  it('labels a month and a year', () => {
    expect(periodLabel(november)).toBe('Listopad 2026')
    expect(periodLabel({ ...november, kind: 'year' })).toBe('Rok 2026')
  })

  it('steps across the turn of the year', () => {
    expect(shiftPeriod({ kind: 'month', year: 2026, month: 12 }, 1)).toEqual({
      kind: 'month',
      year: 2027,
      month: 1,
    })
    expect(shiftPeriod({ kind: 'month', year: 2026, month: 1 }, -1)).toEqual({
      kind: 'month',
      year: 2025,
      month: 12,
    })
  })

  it('round-trips through the query string', () => {
    expect(parsePeriod(periodKey(november), { ...november, month: 1 })).toEqual(november)
    expect(parsePeriod('2025', november)).toEqual({ kind: 'year', year: 2025, month: 11 })
    expect(parsePeriod('nonsense', november)).toEqual(november)
    expect(parsePeriod('2026-13', november)).toEqual(november)
  })

  it('places a training by its Prague date, not its UTC one', () => {
    // 23:30 UTC on 31 October is 00:30 on 1 November in Prague.
    const at = new Date('2026-10-31T23:30:00Z')
    expect(inPeriod(at, november, PRAGUE)).toBe(true)
    expect(inPeriod(at, { kind: 'month', year: 2026, month: 10 }, PRAGUE)).toBe(false)
  })
})
