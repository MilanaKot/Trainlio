import { messages } from '@/lib/i18n'
import { eligibilityLabel } from '@/lib/domain/session'
import { sessionAvailability, freePlaces } from '@/lib/domain/booking'
import { formatSessionDay, formatTimeRange } from '@/lib/time/workspace-time'
import { OccupancyLive } from '@/components/booking/occupancy-live'
import { BookingPicker } from '@/components/booking/booking-picker'
import type { GuardianSession, PickerAthlete } from '@/server/bookings/queries'

/**
 * A session as a parent sees it (UI_SPEC).
 *
 * Shows the venue with its changing room (D-12) and the public notes (D-13),
 * the eligibility range, and occupancy as a count — never who is booked.
 */
export function SessionCard({
  session,
  timezone,
  athletes,
  now,
}: {
  session: GuardianSession
  timezone: string
  athletes: PickerAthlete[]
  now: Date
}) {
  const start = new Date(session.startAt)
  const end = new Date(session.endAt)
  const availability = sessionAvailability(session, now)

  const venue = [session.locationName, session.facilityCode, session.changingRoom]
    .filter(Boolean)
    .join(' · ')

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-black/10 p-4 dark:border-white/15">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="font-medium">{formatSessionDay(start, timezone)}</span>
          <span className="text-sm">{formatTimeRange(start, end, timezone)}</span>
          <span className="text-sm opacity-70">{venue}</span>
          <span className="text-sm opacity-70">
            {eligibilityLabel(
              session.eligibilityMode,
              session.birthYearFrom,
              session.birthYearTo,
              messages.session.allAthletes,
            )}
          </span>
        </div>
        <OccupancyLive
          sessionId={session.id}
          capacity={session.capacity}
          initialCount={session.confirmedCount}
        />
      </div>

      {session.publicNotes ? (
        <p className="whitespace-pre-line text-sm opacity-80">{session.publicNotes}</p>
      ) : null}

      {availability === 'BOOKABLE' ? (
        <BookingPicker
          sessionId={session.id}
          athletes={athletes}
          freePlaces={freePlaces(session)}
        />
      ) : (
        <p className="text-sm opacity-70">
          {availability === 'FULL'
            ? messages.session.full
            : availability === 'CLOSED'
              ? messages.session.bookingClosed
              : availability === 'CANCELLED'
                ? messages.session.cancelled
                : messages.session.started}
        </p>
      )}
    </li>
  )
}
