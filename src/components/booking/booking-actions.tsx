'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { messages } from '@/lib/i18n'
import { freePlaces } from '@/lib/domain/booking'
import { bookingCardVariant } from '@/lib/domain/booking-card'
import { cancellationDeadline, canRespond, isLate } from '@/lib/domain/guardian-response'
import { formatPhone } from '@/lib/domain/phone'
import { formatDateAtTime, formatDeadline } from '@/lib/time/workspace-time'
import { bookAthletes } from '@/server/bookings/actions'
import {
  ResponseButtons,
  ResponseStatus,
  useGuardianResponse,
} from '@/components/booking/response-block'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { ContactActions } from '@/components/ui/contact-actions'
import { useToast } from '@/components/ui/toast'
import type { MyBooking, RemovedByCoach } from '@/server/bookings/queries'

const t = messages.myTrainings
const r = messages.response

function ClockIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="size-4 shrink-0" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4.75V8l2.25 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

/**
 * G6f–G6i (v3.7, DS §6.38): the family's answer, above the detail list.
 *
 * `Nepotvrzeno` asks the question with two buttons; `Půjde` says who answered
 * and offers the way out; a withdrawal shows its reason, which cannot be
 * edited. From the start of the training it is read-only — attendance takes
 * over. Not shown for a removal by the coach or a cancelled training.
 */
export function ResponseSection({
  booking,
  timezone,
  now,
}: {
  booking: MyBooking
  timezone: string
  now: Date
}) {
  const response = useGuardianResponse(booking.bookingId, booking.athleteFirstName)
  const { session } = booking
  const variant = bookingCardVariant(booking, session)
  const name = booking.athleteFirstName

  if (variant === 'removedByCoach' || variant === 'cancelledSession') return null

  if (variant === 'selfCancelled') {
    return (
      <section
        aria-labelledby="ucast"
        className="flex flex-col gap-3 rounded-card bg-surface p-4 shadow-[inset_0_0_0_1.5px_var(--color-danger-line)]"
      >
        <Header state="notGoing" title={r.title} />
        <p className="text-meta text-ink">{r.cancelledText.replace('{name}', name)}</p>
        {booking.absenceReason ? (
          <div className="flex flex-col gap-1">
            <span className="text-caption font-bold tracking-[0.05em] text-muted">
              {r.reasonCaption}
            </span>
            <p className="rounded-control bg-bg px-3 py-2.5 text-[0.9375rem]/[1.375rem] whitespace-pre-line text-ink">
              {booking.absenceReason}
            </p>
          </div>
        ) : null}
        {booking.cancelledAt ? (
          <p className="text-hint text-muted">
            {r.cancelledMeta
              .replace('{when}', formatDateAtTime(new Date(booking.cancelledAt), timezone))
              .replace('{name}', booking.cancelledByName ?? t.none)}
          </p>
        ) : null}
      </section>
    )
  }

  const open = canRespond(booking, session, now)

  if (booking.response) {
    return (
      <section aria-labelledby="ucast" className="flex flex-col gap-3 rounded-card bg-surface p-4">
        <Header state="going" title={r.title} />
        <p className="text-meta text-ink">{r.goingText.replace('{name}', name)}</p>
        <p className="text-hint text-muted">
          {r.goingMeta
            .replace('{when}', formatDateAtTime(new Date(booking.response.sentAt), timezone))
            .replace('{name}', booking.response.byName ?? t.none)}
        </p>
        {open ? (
          <button
            type="button"
            onClick={response.openReason}
            disabled={response.pending}
            className="flex min-h-11 items-center self-start text-row font-bold text-danger"
          >
            {r.change.replace('{name}', name)}
          </button>
        ) : null}
        {open ? response.sheet : null}
      </section>
    )
  }

  return (
    <section aria-labelledby="ucast" className="flex flex-col gap-3 rounded-card bg-surface p-4">
      <Header state="pending" title={open ? r.question.replace('{name}', name) : r.title} />
      {open ? (
        <>
          <ResponseButtons
            disabled={response.pending}
            onGoing={response.going}
            onNotGoing={response.openReason}
          />
          <p className="text-hint text-muted">{r.pendingHint.replace('{name}', name)}</p>
          {response.error ? (
            <p role="alert" className="text-hint text-danger">
              {response.error}
            </p>
          ) : null}
          {response.sheet}
        </>
      ) : null}
    </section>
  )
}

function Header({ state, title }: { state: 'pending' | 'going' | 'notGoing'; title: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 id="ucast" className="text-[1.0625rem]/[1.5rem] font-bold text-ink">
        {title}
      </h2>
      <ResponseStatus state={state} />
    </div>
  )
}

/**
 * The footer of one booking's screen (guardian/SPEC.md §G6, §G6d, §G6i).
 *
 * v3.7: the answer lives in the Účast section, so the footer only says when a
 * withdrawal turns late — the server stamps that itself, on its own clock. A
 * withdrawn booking offers `Přihlásit znovu` while there is a place and the
 * training has not started; the new booking starts as `Nepotvrzeno`.
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
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const { session } = booking
  const end = new Date(session.endAt)
  const variant = bookingCardVariant(booking, session)
  const upcoming = end.getTime() >= now.getTime()

  if (!upcoming || variant === 'cancelledSession') return null

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

  const started = new Date(session.startAt).getTime() <= now.getTime()

  if (variant === 'selfCancelled') {
    if (started) return null
    // Booking again is the server's decision as much as ever: capacity,
    // eligibility and a coach's removal are checked there.
    const rebookable = session.status === 'OPEN' && freePlaces(session) > 0

    function onRebook() {
      setError(null)
      startTransition(async () => {
        const result = await bookAthletes(session.id, [booking.athleteId])
        if (!result.ok) {
          const table = messages.booking.errors as Record<string, string>
          setError(table[result.code] ?? messages.booking.errors.generic)
          return
        }
        toast(messages.booking.booked)
        router.refresh()
      })
    }

    return (
      <Footer>
        <p className="text-center text-hint text-muted">{r.rebookHint}</p>
        {error ? (
          <p role="alert" className="text-center text-hint text-danger">
            {error}
          </p>
        ) : null}
        {rebookable ? (
          <Button
            size="lg"
            variant="outline"
            onClick={onRebook}
            {...(pending ? { loadingLabel: messages.booking.booking } : {})}
          >
            {r.rebook}
          </Button>
        ) : null}
      </Footer>
    )
  }

  if (started) return null

  const late = isLate(session.startAt, deadlineHours, now)

  return (
    <Footer>
      <p className="flex items-center justify-center gap-1.5 text-hint text-muted">
        <ClockIcon />
        {late
          ? r.lateAfter
          : r.lateFrom.replace(
              '{deadline}',
              formatDeadline(cancellationDeadline(session.startAt, deadlineHours), timezone),
            )}
      </p>
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
