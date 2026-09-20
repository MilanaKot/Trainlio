import { describe, expect, it } from 'vitest'
import {
  canCancel,
  freePlaces,
  sessionAvailability,
  showsChangedBadge,
  splitByTime,
} from '@/lib/domain/booking'

const NOW = new Date('2026-10-04T06:00:00Z')

function session(overrides: Partial<Parameters<typeof sessionAvailability>[0]> = {}) {
  return {
    status: 'OPEN' as const,
    capacity: 10,
    confirmedCount: 3,
    startAt: '2026-10-04T07:00:00Z',
    ...overrides,
  }
}

describe('session availability', () => {
  it('is bookable while open, not started and not full', () => {
    expect(sessionAvailability(session(), NOW)).toBe('BOOKABLE')
  })

  it('is full at capacity, and stays full beyond it', () => {
    expect(sessionAvailability(session({ confirmedCount: 10 }), NOW)).toBe('FULL')
    // A coach may exceed capacity manually; a parent must still see it as full.
    expect(sessionAvailability(session({ confirmedCount: 11 }), NOW)).toBe('FULL')
  })

  it('reports a closed session even when places remain (BR-024)', () => {
    expect(sessionAvailability(session({ status: 'CLOSED', confirmedCount: 0 }), NOW)).toBe(
      'CLOSED',
    )
  })

  it('reports a cancelled session ahead of everything else', () => {
    expect(sessionAvailability(session({ status: 'CANCELLED', confirmedCount: 10 }), NOW)).toBe(
      'CANCELLED',
    )
  })

  // PRD §10: bookable right up to the start.
  it('is bookable one second before the start and started at it', () => {
    const start = '2026-10-04T07:00:00Z'
    expect(sessionAvailability(session({ startAt: start }), new Date('2026-10-04T06:59:59Z'))).toBe(
      'BOOKABLE',
    )
    expect(sessionAvailability(session({ startAt: start }), new Date('2026-10-04T07:00:00Z'))).toBe(
      'STARTED',
    )
  })
})

describe('free places', () => {
  it('never reports a negative number when a coach has overridden capacity', () => {
    expect(freePlaces({ capacity: 10, confirmedCount: 11 })).toBe(0)
    expect(freePlaces({ capacity: 10, confirmedCount: 3 })).toBe(7)
  })
})

describe('cancellation deadline (D-02)', () => {
  const start = '2026-10-04T20:00:00Z'
  const s = { startAt: start, status: 'OPEN' as const }
  const booking = { status: 'CONFIRMED' as const }

  it('allows cancellation at exactly the deadline', () => {
    expect(canCancel(booking, s, 12, new Date('2026-10-04T08:00:00Z'))).toBe(true)
  })

  it('allows it a second earlier', () => {
    expect(canCancel(booking, s, 12, new Date('2026-10-04T07:59:59Z'))).toBe(true)
  })

  it('blocks it a second later', () => {
    expect(canCancel(booking, s, 12, new Date('2026-10-04T08:00:01Z'))).toBe(false)
  })

  it('reads the deadline rather than assuming twelve hours', () => {
    expect(canCancel(booking, s, 24, new Date('2026-10-03T20:00:00Z'))).toBe(true)
    expect(canCancel(booking, s, 24, new Date('2026-10-03T20:00:01Z'))).toBe(false)
  })

  it('offers nothing to cancel on an already-cancelled booking or session', () => {
    const early = new Date('2026-10-04T00:00:00Z')
    expect(canCancel({ status: 'CANCELLED_BY_USER' }, s, 12, early)).toBe(false)
    expect(canCancel({ status: 'CANCELLED_BY_COACH' }, s, 12, early)).toBe(false)
    expect(canCancel(booking, { ...s, status: 'CANCELLED' }, 12, early)).toBe(false)
  })
})

describe('the ZMĚNĚNO badge (D-11, D-08, AC-060)', () => {
  const bookedAt = '2026-09-01T10:00:00Z'
  const booking = { bookingCreatedAt: bookedAt, eligibilityNarrowedAt: null }

  it('is shown when the change came after the booking (AC-193)', () => {
    expect(showsChangedBadge(booking, '2026-09-02T10:00:00Z')).toBe(true)
  })

  // The whole reason this is a timestamp and not a boolean: a parent who booked
  // after the change never experienced it.
  it('is hidden when the parent booked after the change (AC-192)', () => {
    expect(showsChangedBadge(booking, '2026-08-30T10:00:00Z')).toBe(false)
  })

  it('is hidden when nothing significant changed', () => {
    expect(showsChangedBadge(booking, null)).toBe(false)
  })

  // D-08: an eligibility narrowing marks only the bookings it affects, so this
  // one shows regardless of the session-level timestamp.
  it('is shown on a booking an eligibility narrowing affected', () => {
    const affected = { bookingCreatedAt: bookedAt, eligibilityNarrowedAt: '2026-09-03T10:00:00Z' }
    expect(showsChangedBadge(affected, null)).toBe(true)
    expect(showsChangedBadge(affected, '2026-08-30T10:00:00Z')).toBe(true)
  })
})

/**
 * D-04. Upcoming and Past are derived from `end_at` against the current
 * instant, and from nothing else.
 */
describe('the Upcoming / Past split (AC-120 to AC-123)', () => {
  const NOW_SPLIT = new Date('2026-10-04T12:00:00Z')

  function booking(startAt: string, endAt: string, status = 'OPEN') {
    return { session: { startAt, endAt, status } }
  }

  it('puts a session whose end is in the future into Upcoming (AC-120)', () => {
    const b = booking('2026-10-05T09:00:00Z', '2026-10-05T10:00:00Z')
    const { upcoming, past } = splitByTime([b], NOW_SPLIT)
    expect(upcoming).toEqual([b])
    expect(past).toEqual([])
  })

  it('puts a session whose end is in the past into Past (AC-121)', () => {
    const b = booking('2026-10-03T09:00:00Z', '2026-10-03T10:00:00Z')
    const { upcoming, past } = splitByTime([b], NOW_SPLIT)
    expect(upcoming).toEqual([])
    expect(past).toEqual([b])
  })

  // A training in progress is not over. A parent standing at the rink must not
  // find it filed under Minulé.
  it('keeps a session that has started but not ended in Upcoming (AC-120)', () => {
    const b = booking('2026-10-04T11:00:00Z', '2026-10-04T13:00:00Z')
    expect(splitByTime([b], NOW_SPLIT).upcoming).toEqual([b])
  })

  it('treats the exact end instant as not yet past', () => {
    const b = booking('2026-10-04T11:00:00Z', '2026-10-04T12:00:00Z')
    expect(splitByTime([b], NOW_SPLIT).upcoming).toEqual([b])
  })

  // AC-122: the parent needs to see that the training is off. Filing it under
  // Past would hide the one thing they have to act on.
  it('keeps a cancelled future session in Upcoming (AC-122)', () => {
    const b = booking('2026-10-06T09:00:00Z', '2026-10-06T10:00:00Z', 'CANCELLED')
    expect(splitByTime([b], NOW_SPLIT).upcoming).toEqual([b])
  })

  /**
   * AC-123: no scheduled job is required.
   *
   * The proof is that the same input, read at a later instant, moves on its
   * own — nothing wrote a COMPLETED status in between, and there was no window
   * in which a finished training was still listed as upcoming because a cron
   * had not fired.
   */
  it('moves a session to Past with the clock alone (AC-123)', () => {
    const b = booking('2026-10-04T13:00:00Z', '2026-10-04T14:00:00Z')
    expect(splitByTime([b], NOW_SPLIT).upcoming).toEqual([b])
    expect(splitByTime([b], new Date('2026-10-04T14:00:01Z')).past).toEqual([b])
  })

  it('orders Upcoming soonest first and Past most recent first', () => {
    const soon = booking('2026-10-05T09:00:00Z', '2026-10-05T10:00:00Z')
    const later = booking('2026-10-09T09:00:00Z', '2026-10-09T10:00:00Z')
    const recent = booking('2026-10-03T09:00:00Z', '2026-10-03T10:00:00Z')
    const older = booking('2026-09-20T09:00:00Z', '2026-09-20T10:00:00Z')

    const { upcoming, past } = splitByTime([later, older, soon, recent], NOW_SPLIT)
    expect(upcoming).toEqual([soon, later])
    expect(past).toEqual([recent, older])
  })
})
