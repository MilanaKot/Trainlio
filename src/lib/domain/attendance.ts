/**
 * Attendance (handoff v3.4, decisions 40–41).
 *
 * Two stored states, `Byl` and `Nebyl`, and none at all until a coach marks
 * one. What a screen shows is derived: before the start there is nothing to
 * mark, and once the training is over an unmarked booking reads as `Nebyl`.
 * That is a reading rule, never a write — a coach can still mark it later.
 */

export type AttendanceMark = 'PRESENT' | 'ABSENT' | null

/** What the toggle draws. `locked` is before the start (disabled, §6.36). */
export type AttendanceView = 'present' | 'absent' | 'unmarked' | 'locked'

type Timed = { startAt: string; endAt: string }

export function attendanceView(mark: AttendanceMark, session: Timed, now: Date): AttendanceView {
  if (new Date(session.startAt) > now) return 'locked'
  if (mark === 'PRESENT') return 'present'
  if (mark === 'ABSENT') return 'absent'
  return new Date(session.endAt) <= now ? 'absent' : 'unmarked'
}

/**
 * `unmarked → Byl → Nebyl → Byl …` (coach/SPEC.md K2). An unmarked booking of
 * a finished training is drawn as `Nebyl`, but nobody marked it so: the first
 * tap still says `Byl`.
 */
export function nextAttendance(mark: AttendanceMark): 'PRESENT' | 'ABSENT' {
  return mark === 'PRESENT' ? 'ABSENT' : 'PRESENT'
}

export type AttendanceItem = Timed & {
  mark: AttendanceMark
  /** Cancelled trainings count for nothing (decision 40). */
  sessionCancelled: boolean
}

export type AttendanceSummary = {
  present: number
  absent: number
  /** Byl / (Byl + Nebyl), rounded; null when there is nothing to divide. */
  percent: number | null
}

/**
 * K13 tiles and G8b. A training under way and not yet marked is neither: it
 * becomes `Nebyl` at its end, not at its start.
 */
export function summarizeAttendance(items: AttendanceItem[], now: Date): AttendanceSummary {
  let present = 0
  let absent = 0
  for (const item of items) {
    if (item.sessionCancelled) continue
    const view = attendanceView(item.mark, item, now)
    if (view === 'present') present += 1
    if (view === 'absent') absent += 1
  }
  const marked = present + absent
  return { present, absent, percent: marked === 0 ? null : Math.round((present / marked) * 100) }
}

export type PeriodKind = 'month' | 'year'

/** A month or a year in the workspace timezone, by its local start. */
export type Period = { kind: PeriodKind; year: number; month: number }

/** `2026-11` or `2026` — the `?obdobi=` value. */
export function periodKey(period: Period): string {
  return period.kind === 'year'
    ? String(period.year)
    : `${period.year}-${String(period.month).padStart(2, '0')}`
}

export function parsePeriod(value: string | undefined, fallback: Period): Period {
  const month = value?.match(/^(\d{4})-(\d{2})$/)
  if (month) {
    const m = Number(month[2])
    if (m >= 1 && m <= 12) return { kind: 'month', year: Number(month[1]), month: m }
  }
  const year = value?.match(/^(\d{4})$/)
  if (year) return { kind: 'year', year: Number(year[1]), month: fallback.month }
  return fallback
}

export function shiftPeriod(period: Period, by: 1 | -1): Period {
  if (period.kind === 'year') return { ...period, year: period.year + by }
  const index = period.year * 12 + (period.month - 1) + by
  return { kind: 'month', year: Math.floor(index / 12), month: (index % 12) + 1 }
}

/** The local calendar month or year of a moment. */
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

export function inPeriod(at: Date, period: Period, timeZone: string): boolean {
  const local = localYearMonth(at, timeZone)
  return period.kind === 'year'
    ? local.year === period.year
    : local.year === period.year && local.month === period.month
}

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

/** `Listopad 2026` / `Rok 2026`. */
export function periodLabel(period: Period): string {
  return period.kind === 'year'
    ? `Rok ${period.year}`
    : `${MONTHS[period.month - 1]} ${period.year}`
}

/** `LISTOPAD` / `2026` — the past list's caption in K13. */
export function periodCaption(period: Period): string {
  return period.kind === 'year' ? String(period.year) : (MONTHS[period.month - 1] ?? '')
}
