import {
  getCancellationDeadlineHours,
  listMyBookings,
  type MyBooking,
} from '@/server/bookings/queries'
import { listJoinableWorkspaces } from '@/server/athletes/queries'
import { CancelBooking } from '@/components/booking/cancel-booking'
import { canCancel, showsChangedBadge } from '@/lib/domain/booking'
import { DEFAULT_TIMEZONE, formatSessionDay, formatTimeRange } from '@/lib/time/workspace-time'
import { messages } from '@/lib/i18n'

function BookingRow({
  booking,
  timezone,
  deadlineHours,
  now,
  showCancel,
}: {
  booking: MyBooking
  timezone: string
  deadlineHours: number
  now: Date
  showCancel: boolean
}) {
  const { session } = booking
  const start = new Date(session.startAt)
  const end = new Date(session.endAt)

  const venue = [session.locationName, session.facilityCode, session.changingRoom]
    .filter(Boolean)
    .join(' · ')

  const cancelled = session.status === 'CANCELLED'
  const changed = showsChangedBadge(booking, session.significantChangedAt)

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-black/10 p-4 dark:border-white/15">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{formatSessionDay(start, timezone)}</span>
        {/* BR-070: a cancelled session stays visible here — the parent needs to
            know the training is off, not find it missing. */}
        {cancelled ? (
          <span className="rounded bg-black/10 px-2 py-0.5 text-[11px] uppercase dark:bg-white/15">
            {messages.session.cancelled}
          </span>
        ) : null}
        {changed && !cancelled ? (
          <span className="rounded bg-black/10 px-2 py-0.5 text-[11px] uppercase dark:bg-white/15">
            {messages.session.changed}
          </span>
        ) : null}
      </div>

      <span className="text-sm">{formatTimeRange(start, end, timezone)}</span>
      <span className="text-sm opacity-70">{venue}</span>
      <span className="text-sm">
        {messages.myBookingsPage.athlete}: {booking.athleteName}
      </span>

      {session.publicNotes ? (
        <p className="whitespace-pre-line text-sm opacity-80">{session.publicNotes}</p>
      ) : null}

      {booking.status === 'CANCELLED_BY_COACH' ? (
        <p className="text-sm opacity-70">{messages.booking.removedByCoach}</p>
      ) : null}

      {showCancel && booking.status === 'CONFIRMED' && !cancelled ? (
        <CancelBooking
          bookingId={booking.bookingId}
          allowed={canCancel(booking, session, deadlineHours, now)}
        />
      ) : null}
    </li>
  )
}

export default async function MyBookingsPage() {
  const [{ upcoming, past }, workspaces, deadlineHours] = await Promise.all([
    listMyBookings(),
    listJoinableWorkspaces(),
    getCancellationDeadlineHours(),
  ])

  const timezone = workspaces[0]?.timezone ?? DEFAULT_TIMEZONE
  const now = new Date()
  const t = messages.myBookingsPage

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t.title}</h1>

      {upcoming.length === 0 && past.length === 0 ? (
        <div className="flex flex-col gap-2 rounded-xl border border-dashed border-black/15 p-6 text-center dark:border-white/20">
          <p className="font-medium">{t.none}</p>
          <p className="text-sm opacity-70">{t.noneHint}</p>
        </div>
      ) : null}

      {/* D-04: Upcoming and Past come from end_at, so nothing depends on a
          scheduled job moving a session to COMPLETED. */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide opacity-60">
          {messages.myBookings.upcoming}
        </h2>
        {upcoming.length === 0 ? (
          <p className="text-sm opacity-70">{t.none}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {upcoming.map((booking) => (
              <BookingRow
                key={booking.bookingId}
                booking={booking}
                timezone={timezone}
                deadlineHours={deadlineHours}
                now={now}
                showCancel
              />
            ))}
          </ul>
        )}
      </section>

      {past.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide opacity-60">
            {messages.myBookings.past}
          </h2>
          <ul className="flex flex-col gap-3">
            {past.map((booking) => (
              <BookingRow
                key={booking.bookingId}
                booking={booking}
                timezone={timezone}
                deadlineHours={deadlineHours}
                now={now}
                showCancel={false}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  )
}
