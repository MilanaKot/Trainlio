'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { messages } from '@/lib/i18n'
import { canCancel, showsChangedBadge } from '@/lib/domain/booking'
import { bookingCardVariant, changeRows } from '@/lib/domain/booking-card'
import {
  formatDateGroup,
  formatDateTime,
  formatDeadline,
  formatTimeRange,
  relativeDayLabel,
} from '@/lib/time/workspace-time'
import { cancelBooking } from '@/server/bookings/actions'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import type { MyBooking } from '@/server/bookings/queries'

const t = messages.myTrainings
const c = messages.cancellation

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      className={cn('size-4 shrink-0', className)}
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4.75V8l2.25 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="size-4 shrink-0" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 7.25v4M8 4.75v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

/**
 * One booking — one child on one training (DESIGN_SYSTEM §6.6,
 * guardian/SPEC.md §G4, §G4b, §G5).
 *
 * Four appearances, decided by `bookingCardVariant`. A cancelled or withdrawn
 * booking is kept and shown rather than removed (principle 9, AC-122): a
 * parent needs to see that the training is off, and a row that disappears
 * looks like a bug.
 *
 * The whole card is a link to the detail, which is what silences the "Změněno"
 * badge. The footer button sits inside it, so its click must not navigate.
 */
export function BookingCard({
  booking,
  timezone,
  deadlineHours,
  now,
}: {
  booking: MyBooking
  timezone: string
  deadlineHours: number
  now: Date
}) {
  const router = useRouter()
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const { session } = booking
  const start = new Date(session.startAt)
  const end = new Date(session.endAt)

  const variant = bookingCardVariant(booking, session)
  const muted = variant !== 'normal'
  const struck = variant === 'cancelledSession'
  const changed = variant === 'normal' && showsChangedBadge(booking, session.significantChangedAt)
  const rows = changed ? changeRows(session.significantChange, session, timezone) : []

  const upcoming = end.getTime() >= now.getTime()
  const cancellable = canCancel(booking, session, deadlineHours, now)
  const deadlineAt = new Date(start.getTime() - deadlineHours * 60 * 60 * 1000)
  const relative = relativeDayLabel(start, now, timezone)

  const venue = [session.locationName, session.facilityCode, session.changingRoom]
    .filter(Boolean)
    .join(' · ')

  function onCancel() {
    setError(null)
    startTransition(async () => {
      const result = await cancelBooking(booking.bookingId)
      if (!result.ok) {
        const table = messages.booking.errors as Record<string, string>
        setError(table[result.code] ?? messages.booking.errors.generic)
        return
      }
      setConfirming(false)
      toast(c.done)
      router.refresh()
    })
  }

  return (
    <li
      className={cn(
        'flex flex-col gap-1.5 rounded-card p-4',
        muted
          ? 'bg-neutral-50 shadow-[inset_0_0_0_1px_var(--color-line)]'
          : 'bg-surface shadow-card',
      )}
    >
      <Link
        href={`/moje-treninky/${booking.bookingId}`}
        className="flex flex-col gap-1.5 rounded-control"
      >
        <span className="flex items-center gap-2">
          <Avatar
            firstName={booking.athleteFirstName}
            lastName={booking.athleteLastName}
            size={28}
            muted={muted}
          />
          <span className={cn('text-row font-bold', muted ? 'text-muted' : 'text-ink')}>
            {booking.athleteName}
          </span>
          {changed ? <Badge variant="warning">{t.badgeChanged}</Badge> : null}
          {variant === 'removedByCoach' ? <Badge variant="warning">{t.badgeRemoved}</Badge> : null}
          {variant === 'cancelledSession' ? (
            <Badge variant="danger">{t.badgeSessionCancelled}</Badge>
          ) : null}
          {variant === 'selfCancelled' ? <Badge>{t.badgeSelfCancelled}</Badge> : null}
          <span className="ml-auto text-subtle" aria-hidden="true">
            ›
          </span>
        </span>

        <span
          className={cn(
            'nums text-sheet-title font-bold',
            struck && 'line-through',
            muted ? 'text-muted' : 'text-ink',
            // What moved is highlighted, so a parent who already knows the
            // training sees at a glance which line is new (§G4). `self-start`
            // so the highlight hugs the value rather than painting the row.
            rows.some((r) => r.field === 'TIME') &&
              'self-start rounded bg-warning-soft px-1.5 text-warning',
          )}
        >
          {formatTimeRange(start, end, timezone)}
        </span>

        <span
          className={cn(
            'text-row font-semibold',
            struck && 'line-through',
            muted ? 'text-muted' : 'text-ink',
            rows.some((r) => r.field === 'DATE') &&
              'self-start rounded bg-warning-soft px-1.5 text-warning',
          )}
        >
          {formatDateGroup(start, timezone)}
          {relative === 'TODAY' ? ` · ${messages.session.today}` : ''}
        </span>

        <span className="text-meta text-muted">
          {/* What it used to be comes first, so the line reads as a correction
              rather than as a second training. */}
          {rows.length > 0
            ? `${t.previously.replace('{value}', rows.map((r) => r.previous).join(' · '))} · ${venue}`
            : variant === 'cancelledSession'
              ? t.sessionDidNotHappen.replace('{place}', venue)
              : variant === 'removedByCoach' || variant === 'selfCancelled'
                ? t.cancelledBy
                    .replace('{name}', booking.cancelledByName ?? '')
                    .replace(
                      '{when}',
                      booking.cancelledAt
                        ? formatDateTime(new Date(booking.cancelledAt), timezone)
                        : '',
                    )
                : venue}
        </span>
      </Link>

      {/* §G4b, D-06: no button. A guardian cannot put back an athlete the coach
          removed, so the footer names who can instead of offering an action
          that would always fail. */}
      {variant === 'removedByCoach' && upcoming ? (
        <p className="flex items-center gap-1.5 border-t border-line pt-3 text-hint text-muted">
          <InfoIcon />
          {t.rebookCoachOnly}
        </p>
      ) : null}

      {variant === 'normal' && upcoming ? (
        <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
          {cancellable ? (
            <p className="flex items-center gap-1.5 text-hint text-muted">
              <ClockIcon />
              {c.until.replace('{deadline}', formatDeadline(deadlineAt, timezone))}
            </p>
          ) : (
            <p className="flex items-center gap-1.5 text-hint font-semibold text-ink">
              <InfoIcon />
              {c.tooLate}
            </p>
          )}
          <Button
            size="card"
            variant="outline"
            disabled={!cancellable || pending}
            onClick={() => setConfirming(true)}
          >
            {c.cancel}
          </Button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-hint text-danger">
          {error}
        </p>
      ) : null}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={c.confirmTitle.replace('{name}', booking.athleteName)}
        description={`${formatDateGroup(start, timezone)} · ${formatTimeRange(start, end, timezone)}`}
        cancelLabel={c.keep}
        confirmLabel={c.cancel}
        onConfirm={onCancel}
        pending={pending}
      />
    </li>
  )
}
