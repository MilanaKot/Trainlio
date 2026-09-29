'use client'

import { useState } from 'react'
import { messages, plural } from '@/lib/i18n'
import { eligibilityLabel } from '@/lib/domain/session'
import { sessionAvailability } from '@/lib/domain/booking'
import { capacityState, remainingPlaces } from '@/lib/domain/capacity'
import { bookedNames, cardFooter, type BlockedReason } from '@/lib/domain/session-list'
import { formatTimeRange } from '@/lib/time/workspace-time'
import { Button } from '@/components/ui/button'
import { BookedChip } from '@/components/ui/booked-chip'
import { CapacityMeter } from '@/components/ui/capacity-meter'
import { BookingSheet } from '@/components/booking/booking-sheet'
import { useLiveOccupancy } from '@/components/booking/use-live-occupancy'
import type { GuardianSession, PickerAthlete } from '@/server/bookings/queries'

const t = messages.session

function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="size-4 shrink-0" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 015 0v2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

/**
 * A training as a parent sees it in the list (DESIGN_SYSTEM §6.5,
 * guardian/SPEC.md §G1).
 *
 * Shows the venue with its changing room (D-12) and occupancy as a count —
 * never who is booked (BR-090). The occupancy is live, and the count drives the
 * meter, the "last places" hint and the footer together, so they cannot
 * disagree about whether the training is full.
 *
 * The public note is deliberately not here, as §6.5 has it: it is on the
 * booking detail, where it reaches the parent who is actually bringing a child
 * — and on every card it would be the same sentence forty times.
 */
export function TrainingCard({
  session,
  timezone,
  athletes,
  deadlineHours,
  now,
}: {
  session: GuardianSession
  timezone: string
  athletes: PickerAthlete[]
  deadlineHours: number
  now: Date
}) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const booked = useLiveOccupancy(session.id, session.confirmedCount)

  const start = new Date(session.startAt)
  const end = new Date(session.endAt)

  const availability = sessionAvailability({ ...session, confirmedCount: booked }, now)
  const footer = cardFooter(availability, athletes)
  const registrationOpen = availability === 'BOOKABLE' || availability === 'FULL'
  const remaining = remainingPlaces(booked, session.capacity)
  const chips = bookedNames(athletes)
  const blockedHint = footer.kind === 'blocked' ? blockedText(footer.reason) : null

  const venue = [session.locationName, session.facilityCode, session.changingRoom]
    .filter(Boolean)
    .join(' · ')

  // `Ročníky 2017–2018` or `Všichni sportovci` (§6.5): the range alone reads as
  // a pair of numbers with no subject. Compared against the label rather than
  // the mode, so a range with no years still says something sensible.
  const years = eligibilityLabel(
    session.eligibilityMode,
    session.birthYearFrom,
    session.birthYearTo,
    t.allAthletes,
  )
  const eligibility = years === t.allAthletes ? years : `${t.years} ${years}`

  return (
    <li className="flex flex-col gap-1.5 rounded-card bg-surface p-4 shadow-card">
      <p className="nums text-sheet-title font-bold text-ink">
        {formatTimeRange(start, end, timezone)}
      </p>
      <p className="text-meta text-muted">{venue}</p>
      <p className="text-meta text-muted">{eligibility}</p>

      {/* Only while a parent can still act on it: on a closed or full card the
          number of places left is not a nudge, it is noise. */}
      {capacityState(booked, session.capacity, registrationOpen) === 'lastPlaces' ? (
        <p className="text-hint font-semibold text-warning">{plural(remaining, t.lastPlaces)}</p>
      ) : null}

      {chips.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {chips.map((name) => (
            <BookedChip key={name} name={name} />
          ))}
        </div>
      ) : null}

      {blockedHint ? <p className="text-hint text-muted">{blockedHint}</p> : null}

      <div className="flex items-center justify-between gap-3 pt-2">
        <CapacityMeter
          booked={booked}
          capacity={session.capacity}
          registrationOpen={registrationOpen}
        />

        {footer.kind === 'closed' ? (
          <span className="flex items-center gap-1.5 text-hint font-semibold text-muted">
            <LockIcon />
            {t.bookingClosed}
          </span>
        ) : (
          <Button
            size="card"
            variant={footer.kind === 'book' ? footer.variant : 'primary'}
            disabled={footer.kind !== 'book'}
            onClick={() => setSheetOpen(true)}
          >
            {footer.kind === 'full' ? t.occupied : t.book}
          </Button>
        )}
      </div>

      {/* Kept mounted once it is open. The count is live, so the last place can
          go while a parent is choosing — and §3 is explicit that the sheet then
          explains itself in place rather than disappearing mid-tap. */}
      {footer.kind === 'book' || sheetOpen ? (
        <BookingSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          session={session}
          booked={booked}
          athletes={athletes}
          timezone={timezone}
          deadlineHours={deadlineHours}
        />
      ) : null}
    </li>
  )
}

/**
 * The line under a card whose button cannot be pressed.
 *
 * Two of the five reasons say nothing: the chips above already name everyone
 * who is booked, and the empty state above the list already says what a family
 * with no athletes should do. Repeating either on every card would be shouting.
 */
function blockedText(reason: BlockedReason): string | null {
  switch (reason) {
    case 'birthYears':
      return t.noEligibleYears
    case 'removedByCoach':
      return messages.booking.removedByCoach
    case 'notEligible':
      return messages.booking.noEligible
    case 'noOtherAthlete':
    case 'noAthletes':
      return null
  }
}
