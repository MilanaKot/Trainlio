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

function part(at: Date, timeZone: Timezone, options: Intl.DateTimeFormatOptions, type: Intl.DateTimeFormatPartTypes) {
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

/** Birth year from a full date of birth (PRD §9). */
export function birthYear(dateOfBirth: string): number {
  const year = Number(dateOfBirth.slice(0, 4))
  if (!Number.isInteger(year)) throw new Error(`Unparseable date of birth: ${dateOfBirth}`)
  return year
}

/**
 * Local weekday dates for a weekly recurrence, as `YYYY-MM-DD` strings.
 *
 * Pure date arithmetic with no time component, which is what makes a series
 * spanning a daylight-saving boundary keep its local start time. Each date is
 * converted to an absolute instant individually, on the server, by
 * `create_session_series`. Adding fixed 7×24h intervals to a timestamp instead
 * shifts six of the nine occurrences in the PRD's own example by an hour.
 *
 * @param isoWeekday 1 = Monday … 7 = Sunday
 */
export function weeklyOccurrenceDates(
  localDateFrom: string,
  localDateTo: string,
  isoWeekday: number,
): string[] {
  if (!Number.isInteger(isoWeekday) || isoWeekday < 1 || isoWeekday > 7) {
    throw new Error(`ISO weekday must be 1..7, received ${isoWeekday}`)
  }

  const from = Date.parse(`${localDateFrom}T00:00:00Z`)
  const to = Date.parse(`${localDateTo}T00:00:00Z`)
  if (Number.isNaN(from) || Number.isNaN(to)) {
    throw new Error(`Unparseable date range: ${localDateFrom}..${localDateTo}`)
  }
  if (to < from) return []

  const DAY = 86_400_000
  // UTC is used purely as a calendar here, never as a timezone: these are
  // wall-clock dates, and no time-of-day is attached until the server converts.
  const cursor = new Date(from)
  const currentIso = cursor.getUTCDay() === 0 ? 7 : cursor.getUTCDay()
  const offset = (isoWeekday - currentIso + 7) % 7
  let time = from + offset * DAY

  const dates: string[] = []
  while (time <= to) {
    dates.push(new Date(time).toISOString().slice(0, 10))
    time += 7 * DAY
  }
  return dates
}
