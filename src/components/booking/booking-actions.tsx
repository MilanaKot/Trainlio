'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { messages } from '@/lib/i18n'
import { canCancel } from '@/lib/domain/booking'
import { bookingCardVariant } from '@/lib/domain/booking-card'
import { formatDateGroup, formatDeadline, formatTimeRange } from '@/lib/time/workspace-time'
import { cancelBooking } from '@/server/bookings/actions'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import type { MyBooking } from '@/server/bookings/queries'

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
  const upcoming = end.getTime() >= now.getTime()

  if (!upcoming || variant === 'cancelledSession' || variant === 'selfCancelled') return null

  // D-06: a guardian cannot put back an athlete the coach removed, so the
  // design's `Přihlásit znovu` would be a button that always fails. See
  // docs/DESIGN_DEVIATIONS.md.
  if (variant === 'removedByCoach') {
    return (
      <Footer>
        <p className="flex items-center gap-1.5 text-hint text-muted">
          <InfoIcon />
          {t.rebookContactCoach}
        </p>
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
