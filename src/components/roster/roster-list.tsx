'use client'

import { useState } from 'react'
import { messages } from '@/lib/i18n'
import { formatDateTime } from '@/lib/time/workspace-time'
import { attribution, splitRoster } from '@/lib/domain/roster'
import { Avatar } from '@/components/ui/avatar'
import { BubbleIcon, PlayerCard, athleteLine } from '@/components/roster/player-card'
import { AddAthleteSheet } from '@/components/roster/add-athlete-sheet'
import { MarkAllPaidSheet } from '@/components/roster/mark-all-paid-sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PaymentChip } from '@/components/ui/payment-chip'
import { loadBookingGuardians } from '@/server/roster/actions'
import type { BookingGuardian, CandidateAthlete, RosterEntry } from '@/server/roster/queries'

const t = messages.coach

function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="size-3.5 shrink-0" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 015 0v2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="size-3.5 shrink-0" aria-hidden="true">
      <path
        d="M3.5 8.5l3 3 6-7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * Who is coming (coach/SPEC.md §K2, BR-092, AC-090), and since v3.3 who has
 * paid.
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
  removable,
  editable,
  profileNotes,
  myName,
}: {
  sessionId: string
  sessionLabel: string
  entries: RosterEntry[]
  candidates: CandidateAthlete[]
  capacity: number
  confirmedCount: number
  timezone: string
  addable: boolean
  /** Whether a booked athlete can still be taken off (not once it is over). */
  removable: boolean
  /**
   * canEdit(session) on a training that is not cancelled: payment, the note
   * and the message (decisions 33–36). Unlike adding and removing, these stay
   * open after the training is over.
   */
  editable: boolean
  /** Each athlete's general note (§K13), by athlete id, for K17. */
  profileNotes: Record<string, string>
  myName: string
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [guardians, setGuardians] = useState<BookingGuardian[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [markingAll, setMarkingAll] = useState(false)

  // Fetched when the coach opens a row, not with the roster: a training of
  // twenty would otherwise cost twenty extra round trips on every page load,
  // for a telephone number that is looked at once.
  async function openAthlete(entry: RosterEntry) {
    setOpenId(entry.bookingId)
    setGuardians(null)
    setGuardians(await loadBookingGuardians(entry.bookingId))
  }

  const { confirmed, inactive } = splitRoster(entries)
  const open = confirmed.find((entry) => entry.bookingId === openId) ?? null
  const unpaid = confirmed.filter((entry) => entry.paidAt === null)
  const paidCount = confirmed.length - unpaid.length

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

      {/* v3.3: how many have paid, and the one tap for the rest. A coach who
          can only view sees the count and not the button (coach test 23). */}
      {confirmed.length > 0 ? (
        <div className="flex min-h-14 items-center justify-between gap-3 rounded-[12px] bg-success-soft py-2.5 pr-3 pl-4">
          <span className="text-meta font-bold text-success">
            {t.paidCount
              .replace('{paid}', String(paidCount))
              .replace('{count}', String(confirmed.length))}
          </span>
          {unpaid.length === 0 ? (
            <span className="text-meta font-bold text-success">{t.allPaid}</span>
          ) : editable ? (
            <button
              type="button"
              onClick={() => setMarkingAll(true)}
              className="flex h-9 items-center gap-1.5 rounded-[10px] bg-surface px-3 text-meta font-bold text-success shadow-[inset_0_0_0_1.5px_#a7d9c4]"
            >
              <CheckIcon />
              {t.markAllPaid}
            </button>
          ) : null}
        </div>
      ) : null}

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
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-1.5">
                    <span className="text-body font-bold text-ink">
                      {entry.firstName} {entry.lastName}
                    </span>
                    {/* §K2 v3.3: what else there is, before opening it. */}
                    {entry.coachNote ? (
                      <span role="img" aria-label={t.hasCoachNote} className="text-internal-ink">
                        <LockIcon />
                      </span>
                    ) : null}
                    {entry.parentMessage ? (
                      <span role="img" aria-label={t.messageSentIndicator} className="text-muted">
                        <BubbleIcon />
                      </span>
                    ) : null}
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
                <PaymentChip paid={entry.paidAt !== null} />
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

      {open ? (
        <PlayerCard
          // A fresh card per athlete: its drafts are this booking's.
          key={open.bookingId}
          entry={open}
          guardians={guardians}
          sessionId={sessionId}
          sessionLabel={sessionLabel}
          timezone={timezone}
          editable={editable}
          removable={removable}
          profileNote={profileNotes[open.athleteId] ?? null}
          myName={myName}
          onClose={() => setOpenId(null)}
        />
      ) : null}

      {markingAll ? (
        <MarkAllPaidSheet
          sessionId={sessionId}
          unpaid={unpaid}
          anyPaid={paidCount > 0}
          onClose={() => setMarkingAll(false)}
        />
      ) : null}

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
