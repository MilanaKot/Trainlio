import { describe, expect, it } from 'vitest'
import {
  inPeriod,
  monthPeriod,
  parsePeriod,
  periodCaption,
  periodContaining,
  periodKey,
  periodLabel,
  seasonPeriod,
  shiftPeriod,
  switchKind,
} from '@/lib/period'

const PRAGUE = 'Europe/Prague'

describe('a season runs 1 August – 31 July (decision 47)', () => {
  it('starts at midnight on 1 August in Prague, summer time', () => {
    const season = seasonPeriod(2026, PRAGUE)
    expect(season.start.toISOString()).toBe('2026-07-31T22:00:00.000Z')
    expect(season.end.toISOString()).toBe('2027-07-31T22:00:00.000Z')
  })

  it('puts 31 July in the old season and 1 August in the new one', () => {
    const lastEvening = new Date('2026-07-31T21:30:00Z') // 23:30 on 31 July
    const firstMorning = new Date('2026-07-31T22:30:00Z') // 00:30 on 1 August
    expect(periodContaining('season', lastEvening, PRAGUE).year).toBe(2025)
    expect(periodContaining('season', firstMorning, PRAGUE).year).toBe(2026)
  })

  it('is labelled by both years', () => {
    expect(periodLabel(seasonPeriod(2026, PRAGUE))).toBe('Sezóna 2026/27')
    expect(periodLabel(seasonPeriod(2099, PRAGUE))).toBe('Sezóna 2099/00')
    expect(periodCaption(seasonPeriod(2026, PRAGUE))).toBe('SEZÓNA 2026/27')
  })

  it('steps a season at a time', () => {
    const season = seasonPeriod(2026, PRAGUE)
    expect(periodLabel(shiftPeriod(season, -1, PRAGUE))).toBe('Sezóna 2025/26')
    expect(periodLabel(shiftPeriod(season, 1, PRAGUE))).toBe('Sezóna 2027/28')
  })
})

describe('a month', () => {
  it('has its Czech name', () => {
    expect(periodLabel(monthPeriod(2026, 11, PRAGUE))).toBe('Listopad 2026')
    expect(periodLabel(monthPeriod(2027, 1, PRAGUE))).toBe('Leden 2027')
    expect(periodCaption(monthPeriod(2026, 3, PRAGUE))).toBe('BŘEZEN')
  })

  it('follows the clock change: March starts in winter time, April in summer time', () => {
    const march = monthPeriod(2026, 3, PRAGUE)
    expect(march.start.toISOString()).toBe('2026-02-28T23:00:00.000Z')
    expect(march.end.toISOString()).toBe('2026-03-31T22:00:00.000Z')
    const october = monthPeriod(2026, 10, PRAGUE)
    expect(october.end.toISOString()).toBe('2026-10-31T23:00:00.000Z')
  })

  it('places a training by its Prague date, not its UTC one', () => {
    const at = new Date('2026-10-31T23:30:00Z') // 00:30 on 1 November
    expect(inPeriod(at, monthPeriod(2026, 11, PRAGUE))).toBe(true)
    expect(inPeriod(at, monthPeriod(2026, 10, PRAGUE))).toBe(false)
  })

  it('steps across the turn of the year', () => {
    expect(periodLabel(shiftPeriod(monthPeriod(2026, 12, PRAGUE), 1, PRAGUE))).toBe('Leden 2027')
    expect(periodLabel(shiftPeriod(monthPeriod(2026, 1, PRAGUE), -1, PRAGUE))).toBe('Prosinec 2025')
  })
})

describe('switching and the URL', () => {
  const now = new Date('2026-11-12T12:00:00Z')

  it('defaults to the period that contains today', () => {
    expect(periodLabel(parsePeriod(undefined, 'month', now, PRAGUE))).toBe('Listopad 2026')
    expect(periodLabel(parsePeriod('nonsense', 'season', now, PRAGUE))).toBe('Sezóna 2026/27')
    expect(periodLabel(parsePeriod('2026-13', 'month', now, PRAGUE))).toBe('Listopad 2026')
  })

  it('round-trips both kinds through ?obdobi=', () => {
    for (const period of [monthPeriod(2026, 11, PRAGUE), seasonPeriod(2025, PRAGUE)]) {
      expect(parsePeriod(periodKey(period), 'month', now, PRAGUE)).toEqual(period)
    }
    expect(periodKey(seasonPeriod(2026, PRAGUE))).toBe('sezona-2026')
  })

  it('switches a month to its season, and a season back to today’s month', () => {
    const march = monthPeriod(2027, 3, PRAGUE)
    expect(periodLabel(switchKind(march, 'season', now, PRAGUE))).toBe('Sezóna 2026/27')
    const current = seasonPeriod(2026, PRAGUE)
    expect(periodLabel(switchKind(current, 'month', now, PRAGUE))).toBe('Listopad 2026')
    const old = seasonPeriod(2024, PRAGUE)
    expect(periodLabel(switchKind(old, 'month', now, PRAGUE))).toBe('Srpen 2024')
  })
})
