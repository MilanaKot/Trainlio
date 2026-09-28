import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TIMEZONE,
  birthYear,
  formatLocalDateKey,
  formatDateGroup,
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
    const dates = weeklyOccurrenceDates('2026-10-04', '2026-11-29', [7])
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
    const dates = weeklyOccurrenceDates('2026-10-18', '2026-11-01', [7])
    expect(dates).toEqual(['2026-10-18', '2026-10-25', '2026-11-01'])
  })

  it('advances to the first matching weekday', () => {
    // 2026-10-01 is a Thursday; the first Sunday on or after it is the 4th.
    expect(weeklyOccurrenceDates('2026-10-01', '2026-10-11', [7])).toEqual([
      '2026-10-04',
      '2026-10-11',
    ])
  })

  it('returns nothing when the range contains no matching weekday', () => {
    expect(weeklyOccurrenceDates('2026-10-05', '2026-10-09', [7])).toEqual([])
  })

  it('returns nothing for an inverted range', () => {
    expect(weeklyOccurrenceDates('2026-11-29', '2026-10-04', [7])).toEqual([])
  })

  it('rejects an out-of-range weekday', () => {
    expect(() => weeklyOccurrenceDates('2026-10-04', '2026-10-11', [0])).toThrow()
    expect(() => weeklyOccurrenceDates('2026-10-04', '2026-10-11', [8])).toThrow()
    expect(() => weeklyOccurrenceDates('2026-10-04', '2026-10-11', [7, 8])).toThrow()
  })

  // coach/SPEC.md §K4b: the panel repeats on several weekdays at once.
  it('interleaves several weekdays in date order', () => {
    // 2026-10-05 is a Monday.
    expect(weeklyOccurrenceDates('2026-10-05', '2026-10-18', [1, 3])).toEqual([
      '2026-10-05',
      '2026-10-07',
      '2026-10-12',
      '2026-10-14',
    ])
  })

  it('does not care about the order or the duplicates it is given', () => {
    expect(weeklyOccurrenceDates('2026-10-05', '2026-10-18', [3, 1, 1])).toEqual(
      weeklyOccurrenceDates('2026-10-05', '2026-10-18', [1, 3]),
    )
  })

  it('returns nothing for an empty weekday set', () => {
    expect(weeklyOccurrenceDates('2026-10-05', '2026-10-18', [])).toEqual([])
  })

  it('subtracts the dates the coach unchecked', () => {
    expect(
      weeklyOccurrenceDates('2026-10-05', '2026-10-18', [1, 3], ['2026-10-07', '2026-10-12']),
    ).toEqual(['2026-10-05', '2026-10-14'])
  })

  it('ignores an exclusion the pattern never produced', () => {
    expect(
      weeklyOccurrenceDates('2026-10-05', '2026-10-18', [1, 3], ['2026-10-06', '2026-12-25']),
    ).toEqual(['2026-10-05', '2026-10-07', '2026-10-12', '2026-10-14'])
  })

  // The preview and public.weekly_occurrence_dates must agree, because the
  // dates a coach approves are the dates that get created. The SQL side of the
  // same pattern is asserted in supabase/tests/validation_series.sql.
  it('matches the nine Sundays the generator produces, minus one unchecked', () => {
    expect(weeklyOccurrenceDates('2026-10-04', '2026-11-29', [7], ['2026-10-25'])).toHaveLength(8)
  })
})

describe('formatDateGroup', () => {
  it('puts the month in the genitive, as Czech does after a day number', () => {
    // Asking Intl for the month on its own returns `říjen`; a date heading
    // needs `října`. This is the case that was wrong on screen.
    expect(formatDateGroup(new Date('2026-10-11T10:00:00Z'), PRAGUE)).toBe('Neděle 11. října')
  })

  it('does it for every month, not only the ones that look inflected', () => {
    const headings = Array.from({ length: 12 }, (_, month) =>
      formatDateGroup(new Date(Date.UTC(2026, month, 11, 10)), PRAGUE),
    )
    expect(headings.map((h) => h.split(' ').slice(2).join(' '))).toEqual([
      'ledna',
      'února',
      'března',
      'dubna',
      'května',
      'června',
      'července',
      'srpna',
      'září',
      'října',
      'listopadu',
      'prosince',
    ])
  })

  it('formats in the workspace timezone and capitalises the weekday', () => {
    // 23:30 UTC is already the next day in Prague.
    expect(formatDateGroup(new Date('2026-10-10T23:30:00Z'), PRAGUE)).toBe('Neděle 11. října')
    expect(formatDateGroup(new Date('2026-10-10T23:30:00Z'), 'UTC')).toBe('Sobota 10. října')
  })
})

describe('formatLocalDateKey', () => {
  // A recurrence preview has no instant yet — an occurrence is a local calendar
  // date until the server converts it. Formatting it through a Date would risk
  // the very shift the series design avoids.
  it('renders the session-card heading from a calendar date', () => {
    expect(formatLocalDateKey('2026-10-04')).toBe('Neděle 4. 10.')
    expect(formatLocalDateKey('2026-09-27')).toBe('Neděle 27. 9.')
  })

  it('gives the same label regardless of the machine timezone', () => {
    // 1 November 2026 is a Sunday. Under a negative offset an instant-based
    // implementation would render Saturday.
    expect(formatLocalDateKey('2026-11-01')).toBe('Neděle 1. 11.')
  })

  it('renders every occurrence of the PRD series on the same weekday', () => {
    const labels = weeklyOccurrenceDates('2026-10-04', '2026-11-29', [7]).map(formatLocalDateKey)
    expect(labels).toHaveLength(9)
    expect(labels.every((label) => label.startsWith('Neděle'))).toBe(true)
  })

  it('rejects anything that is not a calendar date', () => {
    expect(() => formatLocalDateKey('2026-10-04T09:00:00Z')).toThrow()
    expect(() => formatLocalDateKey('4. 10. 2026')).toThrow()
  })
})
