import type { BookingStatus, SessionStatus } from '@/types/database'

/**
 * Půjde / Nepůjde (handoff v3.7, decisions 52–55; guardian/SPEC.md G6f–G6i).
 *
 * A confirmed booking is `Nepotvrzeno` until a guardian answers `Půjde`.
 * `Nepůjde` is the guardian's cancellation, which always has a reason and is
 * possible until the training starts; after the workspace's deadline it is
 * still allowed and reaches the coach as `Pozdě`. The same rules are enforced
 * by `confirm_attendance_as_guardian` and `cancel_booking_as_guardian`
 * (migration 49); these are for what the screen offers.
 */

export type GuardianResponse = 'GOING' | null

/** `Důvod *`, 1–200 characters after trimming (G6g). */
export const ABSENCE_REASON_LIMIT = 200

/** G6g's quick chips. A chip writes `{chip} – ` into the field. */
export const ABSENCE_REASON_CHIPS = ['Nemoc', 'Zranění', 'Škola', 'Rodinné důvody'] as const

export function chipPrefix(chip: string): string {
  return `${chip} – `
}

export function validAbsenceReason(reason: string): boolean {
  const length = reason.trim().length
  return length > 0 && length <= ABSENCE_REASON_LIMIT
}

/**
 * Whether the family can still answer: a confirmed booking, a training that
 * was not called off and has not started. Both answers share it — `Nepůjde`
 * is no longer bound by the cancellation deadline (decision 53).
 */
export function canRespond(
  booking: { status: BookingStatus },
  session: { startAt: string; status: SessionStatus },
  now: Date,
): boolean {
  if (booking.status !== 'CONFIRMED') return false
  if (session.status === 'CANCELLED') return false
  return now.getTime() < new Date(session.startAt).getTime()
}

/** The instant after which a withdrawal is late (D-02: at it is still on time). */
export function cancellationDeadline(startAt: string, deadlineHours: number): Date {
  return new Date(new Date(startAt).getTime() - deadlineHours * 60 * 60 * 1000)
}

export function isLate(startAt: string, deadlineHours: number, now: Date): boolean {
  return now.getTime() > cancellationDeadline(startAt, deadlineHours).getTime()
}

/**
 * The withdrawals a coach is shown for one athlete (K13): one per training,
 * the latest, and none for a training the athlete was booked on again or that
 * was called off — the same ones attendance counts as Nebyl.
 */
export function currentWithdrawals<
  T extends {
    sessionId: string
    status: SessionStatus
    bookingStatus: BookingStatus
    cancelledAt: string | null
  },
>(bookings: T[]): T[] {
  const booked = new Set(
    bookings.filter((b) => b.bookingStatus === 'CONFIRMED').map((b) => b.sessionId),
  )
  const latest = new Map<string, T>()
  for (const booking of bookings) {
    if (booking.bookingStatus !== 'CANCELLED_BY_USER') continue
    if (booking.status === 'CANCELLED' || booked.has(booking.sessionId)) continue
    const seen = latest.get(booking.sessionId)
    if (!seen || (booking.cancelledAt ?? '') > (seen.cancelledAt ?? '')) {
      latest.set(booking.sessionId, booking)
    }
  }
  return [...latest.values()]
}
