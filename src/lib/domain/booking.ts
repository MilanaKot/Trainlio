import type { BookingStatus, SessionStatus } from '@/types/database'

/**
 * Guardian-facing booking rules, mirrored from the server for display only.
 *
 * Nothing here authorizes anything: the domain functions re-check all of it.
 * These exist so a parent sees a disabled button with a reason instead of
 * pressing it and being refused.
 */

export type SessionAvailability =
  | 'BOOKABLE'
  | 'FULL'
  | 'CLOSED'
  | 'CANCELLED'
  | 'STARTED'
  | 'DRAFT'

export function sessionAvailability(session: {
  status: SessionStatus
  capacity: number
  confirmedCount: number
  startAt: string
}, now: Date): SessionAvailability {
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
 * D-08 adds the per-booking case: an eligibility narrowing marks only the
 * bookings it actually affects.
 */
export function showsChangedBadge(
  booking: { bookingCreatedAt: string; eligibilityNarrowedAt: string | null },
  significantChangedAt: string | null,
): boolean {
  if (booking.eligibilityNarrowedAt !== null) return true
  if (significantChangedAt === null) return false
  return new Date(significantChangedAt).getTime() > new Date(booking.bookingCreatedAt).getTime()
}
