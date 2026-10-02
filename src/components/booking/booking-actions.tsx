'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { messages } from '@/lib/i18n'
import { canCancel } from '@/lib/domain/booking'
import { bookingCardVariant } from '@/lib/domain/booking-card'
import { formatPhone } from '@/lib/domain/phone'
import { formatDateGroup, formatDeadline, formatTimeRange } from '@/lib/time/workspace-time'
import { cancelBooking } from '@/server/bookings/actions'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { ContactActions } from '@/components/ui/contact-actions'
import { ConfirmDialog } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import type { MyBooking, RemovedByCoach } from '@/server/bookings/queries'

const t = messages.myTrainings
const c = messages.cancellation

function ClockIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="size-4 shrink-0" aria-hidden="true">
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
 * What a parent can do about one booking, on its own screen
 * (guardian/SPEC.md §G6, §G6c, §G6d).
 *
 * The deadline is shown rather than merely enforced: a parent who opens this
 * two hours before a training should read why the button is dead instead of
 * pressing it. The refusal is still the server's — `cancel_booking_as_guardian`
 * checks the same deadline against its own clock, so a page left open past it
 * cannot withdraw by being stale.
 *
 * A cancelled training has no footer at all: there is nothing to withdraw from.
 */
export function BookingActions({
  booking,
  timezone,
  deadlineHours,
  now,
  removedBy,
}: {
  booking: MyBooking
  timezone: string
  deadlineHours: number
  now: Date
  /**
   * The coach who removed this athlete, with their number when they gave one
   * (§G6d). It comes from `removed_booking_coach()`, which answers only for a
   * booking a coach actually removed, so it is null everywhere else.
   */
  removedBy?: RemovedByCoach | null
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
  const upcoming = end.getTime() >= now.getTime()

  if (!upcoming || variant === 'cancelledSession' || variant === 'selfCancelled') return null

  // §G6d, D-06: not an action but a person. The parent cannot put the athlete
  // back — only the coach can — so the footer is the coach: their name, their
  // number when they gave one, and two real links.
  if (variant === 'removedByCoach') {
    const coachName = removedBy?.displayName ?? booking.cancelledByName ?? ''
    const phone = removedBy?.phone ?? null

    return (
      <Footer>
        <div className="flex items-center gap-3">
          {coachName ? <Avatar firstName={coachName} size={40} /> : null}
          <span className="flex min-w-0 flex-col">
            <span className="text-row font-bold text-ink">{t.rebookCoachOnly}</span>
            {/* Whichever of the two the club has: a coach nobody has named yet
                is still a coach a parent can ring. */}
            {coachName || phone ? (
              <span className="text-hint text-muted">
                {[coachName, phone ? formatPhone(phone) : null].filter(Boolean).join(' · ')}
              </span>
            ) : null}
          </span>
        </div>
        <ContactActions phone={phone} name={coachName} />
      </Footer>
    )
  }

  const cancellable = canCancel(booking, session, deadlineHours, now)
  const deadlineAt = new Date(start.getTime() - deadlineHours * 60 * 60 * 1000)

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
    <Footer>
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

      {error ? (
        <p role="alert" className="text-hint text-danger">
          {error}
        </p>
      ) : null}

      <Button
        size="lg"
        variant="outline"
        disabled={!cancellable || pending}
        onClick={() => setConfirming(true)}
      >
        {c.cancel}
      </Button>

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
    </Footer>
  )
}

function Footer({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-md flex-col gap-2 bg-bg/95 px-4 pb-5 pt-3 shadow-[0_-1px_0_var(--color-line)] backdrop-blur">
      {children}
    </div>
  )
}
