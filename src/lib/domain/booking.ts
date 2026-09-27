import type { BookingStatus, SessionStatus } from '@/types/database'

/**
 * Guardian-facing booking rules, mirrored from the server for display only.
 *
 * Nothing here authorizes anything: the domain functions re-check all of it.
 * These exist so a parent sees a disabled button with a reason instead of
 * pressing it and being refused.
 */

export type SessionAvailability = 'BOOKABLE' | 'FULL' | 'CLOSED' | 'CANCELLED' | 'STARTED' | 'DRAFT'

export function sessionAvailability(
  session: {
    status: SessionStatus
    capacity: number
    confirmedCount: number
    startAt: string
  },
  now: Date,
): SessionAvailability {
  if (session.status === 'CANCELLED') return 'CANCELLED'
  if (session.status === 'DRAFT') return 'DRAFT'
  // PRD §10: bookable right up to the start, not to some earlier cutoff.
  if (new Date(session.startAt).getTime() <= now.getTime()) return 'STARTED'
  if (session.status !== 'OPEN') return 'CLOSED'
  if (session.confirmedCount >= session.capacity) return 'FULL'
  return 'BOOKABLE'
}

export function freePlaces(session: { capacity: number; confirmedCount: number }): number {
  return Math.max(session.capacity - session.confirmedCount, 0)
}

/**
 * D-02: cancellation is allowed up to and including the deadline.
 *
 *   12:00:01 before start -> allowed
 *   12:00:00 before start -> allowed
 *   11:59:59 before start -> blocked
 *
 * Display only. The server computes the same comparison on database time, and
 * a client clock that is wrong changes what the button looks like, never what
 * happens.
 */
export function canCancel(
  booking: { status: BookingStatus },
  session: { startAt: string; status: SessionStatus },
  deadlineHours: number,
  now: Date,
): boolean {
  if (booking.status !== 'CONFIRMED') return false
  if (session.status === 'CANCELLED') return false

  const deadline = new Date(session.startAt).getTime() - deadlineHours * 60 * 60 * 1000
  return now.getTime() <= deadline
}

/**
 * D-11: the `ZMĚNĚNO` badge is shown only when the change happened after this
 * booking was made, so a parent who booked afterwards is not told about a
 * change they never experienced.
 *
 * guardian/SPEC.md §G4 adds the other end of it: the badge stops once this
 * parent has opened the booking. Per booking, not per session — two children
 * in one training are two bookings, and a parent who opened one has not
 * thereby been told about the other.
 *
 * A later change outranks an earlier reading, which is why the two timestamps
 * are compared rather than a boolean being flipped.
 *
 * D-08 adds the per-booking case: an eligibility narrowing marks only the
 * bookings it actually affects. It is not cleared by opening the booking —
 * that one says the rule moved under a child who is still booked, and the
 * spec leaves whether it should fade as an open question (§4).
 */
export function showsChangedBadge(
  booking: {
    bookingCreatedAt: string
    eligibilityNarrowedAt: string | null
    changeSeenAt?: string | null
  },
  significantChangedAt: string | null,
): boolean {
  if (booking.eligibilityNarrowedAt !== null) return true
  if (significantChangedAt === null) return false

  const changedAt = new Date(significantChangedAt).getTime()
  if (changedAt <= new Date(booking.bookingCreatedAt).getTime()) return false

  const seenAt = booking.changeSeenAt
  return seenAt === undefined || seenAt === null || changedAt > new Date(seenAt).getTime()
}

/**
 * D-04: the Upcoming / Past split.
 *
 * Derived from `end_at` against the current instant, never from a `COMPLETED`
 * status. That is the whole point of the decision: no scheduled job has to run
 * for a parent to see the right list, so there is no window in which a training
 * that finished an hour ago is still listed as upcoming because a cron did not
 * fire (AC-123).
 *
 * A cancelled future session stays in Upcoming (AC-122). The parent needs to
 * see that the training is off, and moving it to Past would hide exactly the
 * thing they have to act on.
 */
export function splitByTime<T extends { session: { endAt: string; startAt: string } }>(
  bookings: T[],
  now: Date,
): { upcoming: T[]; past: T[] } {
  const instant = now.getTime()

  return {
    upcoming: bookings
      .filter((b) => new Date(b.session.endAt).getTime() >= instant)
      .sort((a, b) => a.session.startAt.localeCompare(b.session.startAt)),
    past: bookings
      .filter((b) => new Date(b.session.endAt).getTime() < instant)
      .sort((a, b) => b.session.startAt.localeCompare(a.session.startAt)),
  }
}
