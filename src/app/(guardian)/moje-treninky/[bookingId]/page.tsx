import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getCancellationDeadlineHours, getMyBooking } from '@/server/bookings/queries'
import { getSessionCoaches } from '@/server/sessions/queries'
import { listJoinableWorkspaces } from '@/server/athletes/queries'
import { BookingActions } from '@/components/booking/booking-actions'
import { MarkSeen } from '@/components/booking/mark-seen'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { CapacityMeter } from '@/components/ui/capacity-meter'
import { DetailList } from '@/components/ui/detail-list'
import { Notice } from '@/components/ui/notice'
import { bookingCardVariant, changeRows } from '@/lib/domain/booking-card'
import { eligibilityLabel } from '@/lib/domain/session'
import {
  DEFAULT_TIMEZONE,
  formatDateGroup,
  formatDateTime,
  formatTimeRange,
} from '@/lib/time/workspace-time'
import { messages } from '@/lib/i18n'
import { cn } from '@/lib/utils'

const t = messages.myTrainings

export default async function BookingDetailPage({
  params,
}: {
  params: Promise<{ bookingId: string }>
}) {
  const { bookingId } = await params

  const [booking, workspaces, deadlineHours] = await Promise.all([
    getMyBooking(bookingId),
    listJoinableWorkspaces(),
    getCancellationDeadlineHours(),
  ])

  // Not found rather than forbidden: the row policy already limits the read to
  // this family, so "someone else's booking" and "no such booking" are the
  // same answer, and the honest one does not confirm that it exists.
  if (!booking) notFound()

  const { session } = booking
  const timezone = workspaces[0]?.timezone ?? DEFAULT_TIMEZONE
  const coaches = await getSessionCoaches(session.id)

  const start = new Date(session.startAt)
  const end = new Date(session.endAt)
  const variant = bookingCardVariant(booking, session)
  const rows = changeRows(session.significantChange, session, timezone)
  const assistants = coaches.filter((c) => c.role === 'ASSISTANT')
  const struck = variant === 'cancelledSession'
  const now = new Date()

  const years = eligibilityLabel(
    session.eligibilityMode,
    session.birthYearFrom,
    session.birthYearTo,
    messages.session.allAthletes,
  )

  return (
    <main className={cn('flex flex-col gap-5', struck ? '' : 'pb-40')}>
      {/* The badge is silenced by opening the booking, not by rendering it. */}
      <MarkSeen bookingId={booking.bookingId} />

      <Link href="/moje-treninky" className="flex min-h-11 items-center gap-1 text-row text-muted">
        <span aria-hidden="true">‹</span> {t.back}
      </Link>

      <header className="flex flex-col gap-2">
        <span className="flex items-center gap-2">
          <Avatar
            firstName={booking.athleteFirstName}
            lastName={booking.athleteLastName}
            size={36}
          />
          <span className="text-row font-bold text-ink">{booking.athleteName}</span>
          {variant === 'removedByCoach' ? <Badge variant="warning">{t.badgeRemoved}</Badge> : null}
          {variant === 'cancelledSession' ? (
            <Badge variant="danger">{t.badgeSessionCancelled}</Badge>
          ) : null}
          {variant === 'selfCancelled' ? <Badge>{t.badgeSelfCancelled}</Badge> : null}
        </span>
        <p
          className={cn(
            'nums font-display text-hero font-bold',
            struck ? 'text-muted line-through' : 'text-ink',
          )}
        >
          {formatTimeRange(start, end, timezone)}
        </p>
        <p
          className={cn(
            'text-sheet-title font-bold',
            struck ? 'text-muted line-through' : 'text-ink',
          )}
        >
          {formatDateGroup(start, timezone)}
        </p>
      </header>

      {/* §G6: the training is off. Said as a sentence, not only as the badge
          beside the name, because this is the screen a parent opens to find
          out what is happening. */}
      {struck ? <Notice variant="danger">{t.sessionCancelledNotice}</Notice> : null}

      {/* §G6d: the training happens, this child is not on it. */}
      {variant === 'removedByCoach' ? (
        <Notice variant="warning" title={t.removedTitle}>
          <div className="flex flex-col gap-1">
            <p>{t.removedBody.replace('{athlete}', booking.athleteName)}</p>
            {booking.cancelledByName && booking.cancelledAt ? (
              <p className="text-hint text-muted">
                {t.removedMeta
                  .replace('{name}', booking.cancelledByName)
                  .replace('{when}', formatDateTime(new Date(booking.cancelledAt), timezone))}
              </p>
            ) : null}
          </div>
        </Notice>
      ) : null}

      {/* §G6: shown whether or not the parent has seen it, until the training
          starts. The badge on the card is the "new" signal; this is the fact. */}
      {rows.length > 0 ? (
        <Notice variant="warning" title={changeTitle(rows.map((r) => r.field))}>
          <div className="flex flex-col gap-1">
            {rows.map((row) => (
              <p key={row.field}>
                {t.changeLine.replace('{previous}', row.previous).replace('{current}', row.current)}
              </p>
            ))}
            {session.significantChange ? (
              <p className="text-hint text-muted">
                {t.changedOn.replace(
                  '{when}',
                  formatDateTime(new Date(session.significantChange.changed_at), timezone),
                )}
              </p>
            ) : null}
          </div>
        </Notice>
      ) : null}

      {/* §G6d: the coach's own words to this family, if they wrote any. */}
      {variant === 'removedByCoach' && booking.coachMessage ? (
        <Notice variant="warning" title={t.coachMessage}>
          {booking.coachMessage}
        </Notice>
      ) : null}

      <DetailList
        items={[
          {
            term: t.place,
            value: session.facilityName
              ? `${session.locationName} · ${session.facilityName} (${session.facilityCode})`
              : `${session.locationName} · ${session.facilityCode}`,
          },
          { term: t.changingRoom, value: session.changingRoom },
          { term: t.years, value: years },
          {
            term: t.mainCoach,
            value: coaches.find((c) => c.role === 'MAIN')?.displayName ?? t.none,
          },
          {
            term: t.assistants,
            // The row is always there: an empty one says "nobody assists",
            // where a missing row says nothing at all.
            value:
              assistants.length > 0 ? (
                <span className="flex flex-col">
                  {assistants.map((coach) => (
                    <span key={coach.profileId}>{coach.displayName}</span>
                  ))}
                </span>
              ) : null,
          },
          {
            term: t.occupancy,
            value: (
              <CapacityMeter
                booked={session.confirmedCount}
                capacity={session.capacity}
                registrationOpen={session.status === 'OPEN'}
                size="sm"
              />
            ),
          },
        ]}
      />

      {session.publicNotes ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-caption font-bold uppercase tracking-[0.05em] text-muted">
            {t.athleteInfo}
          </h2>
          <p className="whitespace-pre-line text-body text-ink">{session.publicNotes}</p>
        </section>
      ) : null}

      <BookingActions
        booking={booking}
        timezone={timezone}
        deadlineHours={deadlineHours}
        now={now}
      />
    </main>
  )
}

/** One field names itself; several get the general sentence (§G6). */
function changeTitle(fields: string[]): string {
  const table = t.coachChanged as Record<string, string>
  return fields.length === 1
    ? (table[fields[0] ?? ''] ?? t.coachChanged.SEVERAL)
    : t.coachChanged.SEVERAL
}
