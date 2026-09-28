import Link from 'next/link'
import { getCancellationDeadlineHours, listMyBookings } from '@/server/bookings/queries'
import { listJoinableWorkspaces } from '@/server/athletes/queries'
import { BookingCard } from '@/components/booking/booking-card'
import { MyTrainingsTabs, type MyTrainingsTab } from '@/components/booking/my-trainings-tabs'
import { buttonVariants } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { DEFAULT_TIMEZONE } from '@/lib/time/workspace-time'
import { messages } from '@/lib/i18n'

const t = messages.myTrainings

/**
 * One card per booking — per child, not per training (§G4).
 *
 * D-04: Nadcházející and Minulé come from `end_at` against the current
 * instant, never from a COMPLETED status, so nothing depends on a scheduled
 * job having run. A cancelled future training stays in Nadcházející (AC-122):
 * the parent needs to see that it is off, and moving it to Minulé would hide
 * the one thing they have to act on.
 */
export default async function MyBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const [{ tab }, { upcoming, past }, workspaces, deadlineHours] = await Promise.all([
    searchParams,
    listMyBookings(),
    listJoinableWorkspaces(),
    getCancellationDeadlineHours(),
  ])

  const active: MyTrainingsTab = tab === 'minule' ? 'past' : 'upcoming'
  const bookings = active === 'past' ? past : upcoming
  const timezone = workspaces[0]?.timezone ?? DEFAULT_TIMEZONE
  const now = new Date()

  return (
    <main className="flex flex-col gap-5">
      <h1 className="font-display text-page font-bold text-ink">{t.title}</h1>

      <MyTrainingsTabs value={active} />

      {bookings.length === 0 ? (
        <EmptyState
          {...(active === 'upcoming'
            ? {
                action: (
                  <Link href="/treninky" className={buttonVariants({ size: 'md' })}>
                    {t.findTraining}
                  </Link>
                ),
              }
            : {})}
        >
          {active === 'upcoming' ? t.noneUpcoming : t.nonePast}
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {bookings.map((booking) => (
            <BookingCard
              key={booking.bookingId}
              booking={booking}
              timezone={timezone}
              deadlineHours={deadlineHours}
              now={now}
            />
          ))}
        </ul>
      )}
    </main>
  )
}
