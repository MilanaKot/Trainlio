import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TIMEZONE,
  birthYear,
  formatSessionDay,
  formatTime,
  formatTimeRange,
  localDateKey,
  weeklyOccurrenceDates,
} from '@/lib/time/workspace-time'

const PRAGUE = DEFAULT_TIMEZONE

describe('workspace timezone formatting', () => {
  it('formats in the workspace timezone, not the device one', () => {
    // 07:00Z is 09:00 in Prague during summer time.
    const at = new Date('2026-10-04T07:00:00Z')
    expect(formatTime(at, PRAGUE)).toBe('09:00')
    // The same instant is 09:00 UTC-0 elsewhere; the workspace decides.
    expect(formatTime(at, 'UTC')).toBe('07:00')
  })

  it('formats the session card heading', () => {
    expect(formatSessionDay(new Date('2026-09-27T07:00:00Z'), PRAGUE)).toBe('Neděle 27. 9.')
  })

  it('formats a time range with an en dash', () => {
    expect(
      formatTimeRange(new Date('2026-10-04T07:00:00Z'), new Date('2026-10-04T08:00:00Z'), PRAGUE),
    ).toBe('09:00–10:00')
  })

  it('derives the local date key across a UTC day boundary', () => {
    // 22:30Z on 3 October is already 4 October in Prague.
    expect(localDateKey(new Date('2026-10-03T22:30:00Z'), PRAGUE)).toBe('2026-10-04')
    expect(localDateKey(new Date('2026-10-03T22:30:00Z'), 'UTC')).toBe('2026-10-03')
  })
})

describe('birth year (PRD §9)', () => {
  it('derives the year from a full date of birth', () => {
    expect(birthYear('2017-10-23')).toBe(2017)
  })
})

describe('weekly occurrence dates', () => {
  // The PRD's own example series, which crosses the end of Czech DST on
  // 25 October 2026 — itself an occurrence date. Generating local dates and
  // converting each one individually is what keeps every session at 09:00.
  it('generates the nine Sundays of the PRD example', () => {
    const dates = weeklyOccurrenceDates('2026-10-04', '2026-11-29', 7)
    expect(dates).toEqual([
      '2026-10-04',
      '2026-10-11',
      '2026-10-18',
      '2026-10-25',
      '2026-11-01',
      '2026-11-08',
      '2026-11-15',
      '2026-11-22',
      '2026-11-29',
    ])
  })

  it('steps whole calendar days, so the DST boundary changes nothing', () => {
    const dates = weeklyOccurrenceDates('2026-10-18', '2026-11-01', 7)
    expect(dates).toEqual(['2026-10-18', '2026-10-25', '2026-11-01'])
  })

  it('advances to the first matching weekday', () => {
    // 2026-10-01 is a Thursday; the first Sunday on or after it is the 4th.
    expect(weeklyOccurrenceDates('2026-10-01', '2026-10-11', 7)).toEqual([
      '2026-10-04',
      '2026-10-11',
    ])
  })

  it('returns nothing when the range contains no matching weekday', () => {
    expect(weeklyOccurrenceDates('2026-10-05', '2026-10-09', 7)).toEqual([])
  })

  it('returns nothing for an inverted range', () => {
    expect(weeklyOccurrenceDates('2026-11-29', '2026-10-04', 7)).toEqual([])
  })

  it('rejects an out-of-range weekday', () => {
    expect(() => weeklyOccurrenceDates('2026-10-04', '2026-10-11', 0)).toThrow()
    expect(() => weeklyOccurrenceDates('2026-10-04', '2026-10-11', 8)).toThrow()
  })
})
