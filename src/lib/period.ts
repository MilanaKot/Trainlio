/**
 * The periods statistics and attendance are read in (handoff v3.5,
 * decision 47): a calendar month, or a season — 1 August to 31 July, the way
 * a hockey club counts its year.
 *
 * Both are wall-clock spans in the workspace's timezone (Europe/Prague in the
 * MVP), turned into instants once: `start` inclusive, `end` exclusive. A
 * training belongs to the period its start falls in, so a 23:30 UTC start on
 * 31 July is August's in Prague.
 */

export type PeriodKind = 'month' | 'season'

export type Period = {
  kind: PeriodKind
  /** The first instant of the period. */
  start: Date
  /** The first instant after it. */
  end: Date
  /** The calendar year of the start: `2026` for November 2026 and for 2026/27. */
  year: number
  /** 1–12 for a month; 8 for a season, whose first month is August. */
  month: number
}

export const SEASON_FIRST_MONTH = 8

const MONTHS = [
  'Leden',
  'Únor',
  'Březen',
  'Duben',
  'Květen',
  'Červen',
  'Červenec',
  'Srpen',
  'Září',
  'Říjen',
  'Listopad',
  'Prosinec',
]

/** The local calendar year and month of an instant. */
export function localYearMonth(at: Date, timeZone: string): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(at)
  return {
    year: Number(parts.find((p) => p.type === 'year')?.value),
    month: Number(parts.find((p) => p.type === 'month')?.value),
  }
}

/**
 * The instant at local midnight starting the 1st of a month. The offset is
 * read from the zone at that moment, so it is right on either side of a
 * daylight-saving change (none falls on the 1st at midnight in Prague, but the
 * offset still differs between winter and summer months).
 */
function firstOfMonth(year: number, month: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, 1)
  const offset = (at: number) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(at))
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
    const local = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour'),
      get('minute'),
      get('second'),
    )
    return local - at
  }
  const first = guess - offset(guess)
  // Once more from the corrected instant, in case the guess sat on the other
  // side of an offset change.
  return new Date(guess - offset(first))
}

export function monthPeriod(year: number, month: number, timeZone: string): Period {
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  return {
    kind: 'month',
    start: firstOfMonth(year, month, timeZone),
    end: firstOfMonth(nextYear, nextMonth, timeZone),
    year,
    month,
  }
}

/** The season starting on 1 August of `year`. */
export function seasonPeriod(year: number, timeZone: string): Period {
  return {
    kind: 'season',
    start: firstOfMonth(year, SEASON_FIRST_MONTH, timeZone),
    end: firstOfMonth(year + 1, SEASON_FIRST_MONTH, timeZone),
    year,
    month: SEASON_FIRST_MONTH,
  }
}

/** The month or season an instant falls in. */
export function periodContaining(kind: PeriodKind, at: Date, timeZone: string): Period {
  const { year, month } = localYearMonth(at, timeZone)
  if (kind === 'month') return monthPeriod(year, month, timeZone)
  return seasonPeriod(month >= SEASON_FIRST_MONTH ? year : year - 1, timeZone)
}

export function shiftPeriod(period: Period, by: 1 | -1, timeZone: string): Period {
  if (period.kind === 'season') return seasonPeriod(period.year + by, timeZone)
  const index = period.year * 12 + (period.month - 1) + by
  return monthPeriod(Math.floor(index / 12), (index % 12) + 1, timeZone)
}

/**
 * The other kind, around the same moment: a month switches to its season,
 * a season to its first month, or to the current month when it contains today.
 */
export function switchKind(period: Period, kind: PeriodKind, now: Date, timeZone: string): Period {
  if (kind === period.kind) return period
  if (kind === 'season') return periodContaining('season', period.start, timeZone)
  return inPeriod(now, period)
    ? periodContaining('month', now, timeZone)
    : monthPeriod(period.year, period.month, timeZone)
}

export function inPeriod(at: Date, period: Period): boolean {
  return at >= period.start && at < period.end
}

/** `Listopad 2026` / `Sezóna 2026/27`. */
export function periodLabel(period: Period): string {
  return period.kind === 'season'
    ? `Sezóna ${period.year}/${String((period.year + 1) % 100).padStart(2, '0')}`
    : `${MONTHS[period.month - 1]} ${period.year}`
}

/** `LISTOPAD` / `SEZÓNA 2026/27` — a list's caption. */
export function periodCaption(period: Period): string {
  return (
    period.kind === 'season' ? periodLabel(period) : (MONTHS[period.month - 1] ?? '')
  ).toLocaleUpperCase('cs')
}

/** `2026-11` or `sezona-2026` — the `?obdobi=` value. */
export function periodKey(period: Period): string {
  return period.kind === 'season'
    ? `sezona-${period.year}`
    : `${period.year}-${String(period.month).padStart(2, '0')}`
}

/**
 * Reads `?obdobi=`. Anything it does not recognise is the period of
 * `fallback` kind that contains today.
 */
export function parsePeriod(
  value: string | undefined,
  fallback: PeriodKind,
  now: Date,
  timeZone: string,
): Period {
  const season = value?.match(/^sezona-(\d{4})$/)
  if (season) return seasonPeriod(Number(season[1]), timeZone)
  const month = value?.match(/^(\d{4})-(\d{2})$/)
  if (month) {
    const m = Number(month[2])
    if (m >= 1 && m <= 12) return monthPeriod(Number(month[1]), m, timeZone)
  }
  return periodContaining(fallback, now, timeZone)
}
