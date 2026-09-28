/**
 * Workspace-timezone formatting and arithmetic.
 *
 * Every date and time shown to any user is rendered in the workspace timezone,
 * never the device's. A guardian travelling abroad must see the same training
 * time as the coach standing on the ice.
 *
 * This module is the only place allowed to call locale formatting directly; a
 * lint rule blocks it everywhere else.
 */

export type Timezone = string

/** IANA zone of the MVP workspace. Real values come from `workspaces.timezone`. */
export const DEFAULT_TIMEZONE: Timezone = 'Europe/Prague'

const CZECH_LOCALE = 'cs-CZ'

function parts(at: Date, timeZone: Timezone, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(CZECH_LOCALE, { ...options, timeZone }).formatToParts(at)
}

function part(
  at: Date,
  timeZone: Timezone,
  options: Intl.DateTimeFormatOptions,
  type: Intl.DateTimeFormatPartTypes,
) {
  return parts(at, timeZone, options).find((p) => p.type === type)?.value ?? ''
}

/** `2026-10-04` — the local calendar date in the workspace timezone. */
export function localDateKey(at: Date, timeZone: Timezone): string {
  const p = parts(at, timeZone, { year: 'numeric', month: '2-digit', day: '2-digit' })
  const get = (type: Intl.DateTimeFormatPartTypes) => p.find((x) => x.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** `09:00` */
export function formatTime(at: Date, timeZone: Timezone): string {
  return new Intl.DateTimeFormat(CZECH_LOCALE, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(at)
}

/** `09:00–10:00`, with an en dash as the UI specification shows. */
export function formatTimeRange(start: Date, end: Date, timeZone: Timezone): string {
  return `${formatTime(start, timeZone)}–${formatTime(end, timeZone)}`
}

/** `Neděle 27. 9.` — the session card heading. */
export function formatSessionDay(at: Date, timeZone: Timezone): string {
  const weekday = part(at, timeZone, { weekday: 'long' }, 'weekday')
  const day = part(at, timeZone, { day: 'numeric' }, 'day')
  const month = part(at, timeZone, { month: 'numeric' }, 'month')
  const capitalised = weekday.charAt(0).toLocaleUpperCase(CZECH_LOCALE) + weekday.slice(1)
  return `${capitalised} ${day}. ${month}.`
}

/** `4. 10. 2026` */
export function formatDate(at: Date, timeZone: Timezone): string {
  const day = part(at, timeZone, { day: 'numeric' }, 'day')
  const month = part(at, timeZone, { month: 'numeric' }, 'month')
  const year = part(at, timeZone, { year: 'numeric' }, 'year')
  return `${day}. ${month}. ${year}`
}

/**
 * `Neděle 4. 10.` from a `YYYY-MM-DD` calendar date.
 *
 * Takes a date key rather than an instant, because a recurrence preview has no
 * instant yet — the occurrence is a local calendar date until the server
 * converts it. Formatting it through a Date would invite exactly the timezone
 * shift the whole series design avoids, so the weekday is computed
 * arithmetically and only the label comes from the locale.
 */
export function formatLocalDateKey(dateKey: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
  if (!match) throw new Error(`Not a calendar date: ${dateKey}`)

  const [, year, month, day] = match
  // UTC noon is used purely as a calendar: it carries no timezone meaning and
  // cannot land on a different day under any offset.
  const at = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12))
  const weekday = part(at, 'UTC', { weekday: 'long' }, 'weekday')
  const capitalised = weekday.charAt(0).toLocaleUpperCase(CZECH_LOCALE) + weekday.slice(1)

  return `${capitalised} ${Number(day)}. ${Number(month)}.`
}

/** Birth year from a full date of birth (PRD §9). */
export function birthYear(dateOfBirth: string): number {
  const year = Number(dateOfBirth.slice(0, 4))
  if (!Number.isInteger(year)) throw new Error(`Unparseable date of birth: ${dateOfBirth}`)
  return year
}

/**
 * Local calendar dates matching a weekly multi-weekday pattern, minus the
 * dates the coach unchecked (coach/SPEC.md §K4b, §K11).
 *
 * Mirrors public.weekly_occurrence_dates so the coach's preview and the
 * generator cannot drift: the dates a coach approves are the dates that get
 * created. It stays a preview all the same — the client submits the pattern
 * and the exclusions, never the list, so it cannot decide what exists.
 */
export function weeklyOccurrenceDates(
  localDateFrom: string,
  localDateTo: string,
  isoWeekdays: readonly number[],
  excludedDates: readonly string[] = [],
): string[] {
  for (const day of isoWeekdays) {
    if (!Number.isInteger(day) || day < 1 || day > 7) {
      throw new Error(`ISO weekday must be 1..7, received ${day}`)
    }
  }
  const wanted = new Set(isoWeekdays)
  if (wanted.size === 0) return []

  const from = Date.parse(`${localDateFrom}T00:00:00Z`)
  const to = Date.parse(`${localDateTo}T00:00:00Z`)
  if (Number.isNaN(from) || Number.isNaN(to)) {
    throw new Error(`Unparseable date range: ${localDateFrom}..${localDateTo}`)
  }
  if (to < from) return []

  const DAY = 86_400_000
  const excluded = new Set(excludedDates)
  const dates: string[] = []
  // UTC is used purely as a calendar here, never as a timezone: these are
  // wall-clock dates, and no time-of-day is attached until the server converts.
  // A day-by-day walk rather than a seven-day step, because with several
  // weekdays the gaps between occurrences are uneven.
  for (let time = from; time <= to; time += DAY) {
    const day = new Date(time)
    const iso = day.getUTCDay() === 0 ? 7 : day.getUTCDay()
    if (!wanted.has(iso)) continue
    const key = day.toISOString().slice(0, 10)
    if (excluded.has(key)) continue
    dates.push(key)
  }
  return dates
}

/*
 * DESIGN_SYSTEM §7. The specification calls this module `lib/format.ts`; it
 * lives here instead, because every function below needs the workspace
 * timezone and splitting them from the ones above would put two halves of the
 * same rule in two files.
 *
 * Weekday abbreviations come from a table rather than from Intl. `weekday:
 * "short"` in Czech is an ICU detail that has changed between versions, and
 * the design pins the exact two letters: Po Út St Čt Pá So Ne.
 */
const WEEKDAY_SHORT = ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'] as const

function weekdayIndex(at: Date, timeZone: Timezone): number {
  // Formatting to an ISO-ish key and reading the day back is the only way to
  // ask "which weekday is it *there*" without reimplementing the zone rules.
  const key = localDateKey(at, timeZone)
  const [year, month, day] = key.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay()
}

function shortWeekday(at: Date, timeZone: Timezone): string {
  const index = weekdayIndex(at, timeZone)
  return WEEKDAY_SHORT[index] ?? ''
}

/** `Neděle 27. září` — the date heading a list groups by. */
export function formatDateGroup(at: Date, timeZone: Timezone): string {
  const weekday = part(at, timeZone, { weekday: 'long' }, 'weekday')
  const day = part(at, timeZone, { day: 'numeric' }, 'day')
  const month = part(at, timeZone, { month: 'long' }, 'month')
  const capitalised = weekday.charAt(0).toLocaleUpperCase(CZECH_LOCALE) + weekday.slice(1)
  return `${capitalised} ${day}. ${month}`
}

/** `Ne 27. 9.` — the compact form used inside sheets and summaries. */
export function formatDateShort(at: Date, timeZone: Timezone): string {
  const day = part(at, timeZone, { day: 'numeric' }, 'day')
  const month = part(at, timeZone, { month: 'numeric' }, 'month')
  return `${shortWeekday(at, timeZone)} ${day}. ${month}.`
}

/**
 * `so 3. 10. 21:00` — a deadline inside running text, so the weekday is
 * lowercase and the time is part of the same phrase.
 */
export function formatDeadline(at: Date, timeZone: Timezone): string {
  const weekday = shortWeekday(at, timeZone).toLocaleLowerCase(CZECH_LOCALE)
  const day = part(at, timeZone, { day: 'numeric' }, 'day')
  const month = part(at, timeZone, { month: 'numeric' }, 'month')
  return `${weekday} ${day}. ${month}. ${formatTime(at, timeZone)}`
}

/** `27. 9. 18:42` — when a booking was made, on a roster row. */
export function formatDateTime(at: Date, timeZone: Timezone): string {
  const day = part(at, timeZone, { day: 'numeric' }, 'day')
  const month = part(at, timeZone, { month: 'numeric' }, 'month')
  return `${day}. ${month}. ${formatTime(at, timeZone)}`
}

/**
 * `Dnes`, `Zítra`, or nothing — what the chip on a date heading says.
 *
 * Tomorrow is the next calendar date in the workspace timezone, not "now plus
 * 24 hours": on the night the clocks go back those are different days, and the
 * one a parent means is the calendar one.
 */
export function relativeDayLabel(
  at: Date,
  now: Date,
  timeZone: Timezone,
): 'TODAY' | 'TOMORROW' | null {
  const target = localDateKey(at, timeZone)
  const today = localDateKey(now, timeZone)
  if (target === today) return 'TODAY'

  const [year, month, day] = today.split('-').map(Number) as [number, number, number]
  const next = new Date(Date.UTC(year, month - 1, day + 1, 12))
  const tomorrow = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`

  return target === tomorrow ? 'TOMORROW' : null
}
