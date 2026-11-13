import { describe, expect, it } from 'vitest'
import { attendanceView, nextAttendance, summarizeAttendance } from '@/lib/domain/attendance'

const NOW = new Date('2026-11-12T12:00:00Z')
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
  let next = 0
  const item = (
    mark: 'PRESENT' | 'ABSENT' | null,
    at = past,
    sessionCancelled = false,
    withdrawn = false,
    sessionId = `s${(next += 1)}`,
  ) => ({ ...at, sessionId, mark, sessionCancelled, withdrawn })

  it('is Byl / (Byl + Nebyl), unmarked past ones counting as Nebyl', () => {
    const summary = summarizeAttendance(
      [item('PRESENT'), item('PRESENT'), item('ABSENT'), item(null)],
      NOW,
    )
    expect(summary).toEqual({ present: 2, absent: 2, percent: 50 })
  })

  it('counts only trainings that have ended: not cancelled ones, future ones or one under way', () => {
    const summary = summarizeAttendance(
      [
        item('PRESENT'),
        item('ABSENT', past, true),
        item(null, future),
        item(null, running),
        item('PRESENT', running),
      ],
      NOW,
    )
    expect(summary).toEqual({ present: 1, absent: 0, percent: 100 })
  })

  it('counts a withdrawal (Nepůjde) as Nebyl once it is over (decision 54)', () => {
    const summary = summarizeAttendance(
      [
        item('PRESENT'),
        item(null, past, false, true),
        // Under way, or on a training called off: nothing yet, nothing at all.
        item(null, running, false, true),
        item(null, past, true, true),
      ],
      NOW,
    )
    expect(summary).toEqual({ present: 1, absent: 1, percent: 50 })
  })

  it('counts a training withdrawn twice once, and not at all when rebooked after', () => {
    const summary = summarizeAttendance(
      [
        item(null, past, false, true, 'a'),
        item(null, past, false, true, 'a'),
        item(null, past, false, true, 'b'),
        item('PRESENT', past, false, false, 'b'),
      ],
      NOW,
    )
    expect(summary).toEqual({ present: 1, absent: 1, percent: 50 })
  })

  it('has no percentage with nothing to count', () => {
    expect(summarizeAttendance([], NOW).percent).toBeNull()
  })

  it('rounds: 8 of 9 is 89 %', () => {
    const items = [...Array.from({ length: 8 }, () => item('PRESENT')), item('ABSENT')]
    expect(summarizeAttendance(items, NOW).percent).toBe(89)
  })
})
