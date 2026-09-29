'use client'

import { useState } from 'react'
import { messages } from '@/lib/i18n'
import { formatDateTime } from '@/lib/time/workspace-time'
import { attribution, splitRoster } from '@/lib/domain/roster'
import { Avatar } from '@/components/ui/avatar'
import { AthleteSheet, athleteLine } from '@/components/roster/athlete-sheet'
import { AddAthleteSheet } from '@/components/roster/add-athlete-sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { loadBookingGuardians } from '@/server/roster/actions'
import type { BookingGuardian, CandidateAthlete, RosterEntry } from '@/server/roster/queries'

const t = messages.coach

/**
 * Who is coming (coach/SPEC.md §K2, BR-092, AC-090).
 *
 * Confirmed rows first and alone under the heading: a coach arriving at the
 * rink needs that list to be exactly who is coming. Withdrawn and removed
 * bookings are kept (BR-044) and shown below, because "was booked and is not"
 * is information, not noise — but it is not the list.
 */
export function RosterList({
  sessionId,
  sessionLabel,
  entries,
  candidates,
  capacity,
  confirmedCount,
  timezone,
  addable,
}: {
  sessionId: string
  sessionLabel: string
  entries: RosterEntry[]
  candidates: CandidateAthlete[]
  capacity: number
  confirmedCount: number
  timezone: string
  addable: boolean
}) {
  const [open, setOpen] = useState<RosterEntry | null>(null)
  const [guardians, setGuardians] = useState<BookingGuardian[] | null>(null)
  const [adding, setAdding] = useState(false)

  // Fetched when the coach opens a row, not with the roster: a training of
  // twenty would otherwise cost twenty extra round trips on every page load,
  // for a telephone number that is looked at once.
  async function openAthlete(entry: RosterEntry) {
    setOpen(entry)
    setGuardians(null)
    setGuardians(await loadBookingGuardians(entry.bookingId))
  }

  const { confirmed, inactive } = splitRoster(entries)

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-date font-bold text-ink">
          {t.rosterTitle.replace('{count}', String(confirmed.length))}
        </h2>
        {addable ? (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            + {t.addAthlete}
          </Button>
        ) : null}
      </div>

      {confirmed.length === 0 ? (
        <p className="rounded-card bg-surface p-4 text-meta text-muted shadow-card">
          {t.rosterEmpty}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {confirmed.map((entry) => (
            <li key={entry.bookingId}>
              <button
                type="button"
                onClick={() => void openAthlete(entry)}
                className="flex w-full items-center gap-3 rounded-card bg-surface p-3 text-left shadow-card"
              >
                <Avatar firstName={entry.firstName} lastName={entry.lastName} size={36} />
                <span className="flex min-w-0 flex-col">
                  <span className="text-body font-bold text-ink">
                    {entry.firstName} {entry.lastName}
                  </span>
                  <span className="text-meta text-muted">{athleteLine(entry)}</span>
                  {/* Who put them there and when. BR-092: the coach sees the
                      guardian's name, which is the point of the roster — so it
                      is `muted`, not `subtle`, which the design system reserves
                      for chevrons and disabled text and which measures 3.17:1. */}
                  <span className="text-hint text-muted">
                    {(attribution(entry) === 'STAFF' ? t.bookedByCoach : t.bookedBy).replace(
                      '{name}',
                      entry.bookedByName ?? t.bookedByParent,
                    )}{' '}
                    · {formatDateTime(new Date(entry.bookedAt), timezone)}
                  </span>
                </span>
                <span className="ml-auto shrink-0 text-subtle" aria-hidden="true">
                  ›
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {inactive.length > 0 ? (
        <details className="rounded-card bg-neutral-50 p-3">
          <summary className="min-h-11 cursor-pointer text-meta font-semibold text-muted">
            {t.rosterRemoved} ({inactive.length})
          </summary>
          <ul className="flex flex-col gap-2 pt-2">
            {inactive.map((entry) => (
              <li key={entry.bookingId} className="flex items-center gap-2">
                <span className="text-meta text-muted">
                  {entry.firstName} {entry.lastName}
                </span>
                <Badge>
                  {entry.status === 'CANCELLED_BY_COACH'
                    ? t.removedByCoachBadge
                    : t.cancelledByUserBadge}
                </Badge>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <AthleteSheet
        entry={open}
        guardians={guardians}
        sessionId={sessionId}
        sessionLabel={sessionLabel}
        timezone={timezone}
        onClose={() => setOpen(null)}
      />

      {adding ? (
        <AddAthleteSheet
          sessionId={sessionId}
          sessionLabel={sessionLabel}
          candidates={candidates}
          capacity={capacity}
          confirmedCount={confirmedCount}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </section>
  )
}
