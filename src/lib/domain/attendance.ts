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
  sessionId: string
  mark: AttendanceMark
  /** Cancelled trainings count for nothing (decision 40). */
  sessionCancelled: boolean
  /**
   * A guardian withdrew the athlete with a reason — `Nepůjde` (v3.7) — which
   * counts as Nebyl (decision 54). A coach's removal is not one: such a
   * booking is never an item at all.
   */
  withdrawn: boolean
}

export type AttendanceSummary = {
  present: number
  absent: number
  /** Byl / (Byl + Nebyl), rounded; null when there is nothing to divide. */
  percent: number | null
}

/**
 * K13 tiles and G8b. Only trainings that have ended count, like the club's
 * statistics (migration 48): one under way is not yet a result, marked or
 * not. An ended one nobody marked is `Nebyl`, and so is one the family
 * withdrew from (decision 54) — once per training, however often they
 * rebooked and withdrew again, and not at all when the athlete ended up
 * booked after all (migration 49 counts the same way).
 *
 * One entry per counted training, in the order given: G8b draws them as
 * squares.
 */
export function countedAttendance(items: AttendanceItem[], now: Date): ('present' | 'absent')[] {
  const booked = new Set(items.filter((i) => !i.withdrawn).map((i) => i.sessionId))
  const withdrawn = new Set<string>()
  const counted: ('present' | 'absent')[] = []
  for (const item of items) {
    if (item.sessionCancelled) continue
    if (new Date(item.endAt) > now) continue
    if (item.withdrawn) {
      if (booked.has(item.sessionId) || withdrawn.has(item.sessionId)) continue
      withdrawn.add(item.sessionId)
      counted.push('absent')
      continue
    }
    const view = attendanceView(item.mark, item, now)
    if (view === 'present' || view === 'absent') counted.push(view)
  }
  return counted
}

export function summarizeAttendance(items: AttendanceItem[], now: Date): AttendanceSummary {
  const counted = countedAttendance(items, now)
  const present = counted.filter((view) => view === 'present').length
  const absent = counted.length - present
  return {
    present,
    absent,
    percent: counted.length === 0 ? null : Math.round((present / counted.length) * 100),
  }
}
