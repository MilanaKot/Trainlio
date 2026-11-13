'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Route } from 'next'
import { messages } from '@/lib/i18n'
import { splitInactive, splitRoster } from '@/lib/domain/roster'
import { attendanceView, nextAttendance, type AttendanceMark } from '@/lib/domain/attendance'
import { HOCKEY_POSITION_LABELS, type HockeyPosition } from '@/lib/enums/hockey'
import { markAllPresent, setAttendance, setBookingPaid, undoUnpaid } from '@/server/roster/actions'
import { AddAthleteSheet } from '@/components/roster/add-athlete-sheet'
import { MarkAllPaidSheet } from '@/components/roster/mark-all-paid-sheet'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PlayerCard, TOGGLE_CELLS } from '@/components/ui/player-card'
import { DollarIcon, PersonCheckIcon, StatusToggle } from '@/components/ui/status-toggle'
import { useToast, useUndoToast } from '@/components/ui/toast'
import {
  formatDateAtTime,
  formatTime,
  relativeDayLabel,
  type Timezone,
} from '@/lib/time/workspace-time'
import { cn } from '@/lib/utils'
import type { CandidateAthlete, RosterEntry } from '@/server/roster/queries'

const t = messages.coach

export function LockIcon({ className = 'size-3.5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${className} shrink-0`}
      aria-hidden="true"
    >
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </svg>
  )
}

export function BubbleIcon({ className = 'size-3.5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${className} shrink-0`}
      aria-hidden="true"
    >
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 4v-4A1.5 1.5 0 0 1 4 14.5z" />
    </svg>
  )
}

/** `2017 · Centr` — the line under the name on a K2 card. */
export function yearAndPosition(entry: {
  birthYear: number | null
  positionCode: string | null
}): string {
  return [
    entry.birthYear,
    entry.positionCode ? HOCKEY_POSITION_LABELS[entry.positionCode as HockeyPosition] : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

function errorText(code: string): string {
  const table = t.errors as Record<string, string>
  return table[code] ?? t.errors.generic
}

/**
 * A tap shown before the server answers. Each override remembers the value it
 * replaced, and applies only while the server still says that: once the
 * refreshed roster arrives with anything else, the server's word wins and the
 * override is simply ignored.
 */
type Override = {
  attendance?: { from: AttendanceMark; to: AttendanceMark }
  paid?: { from: boolean; to: boolean }
}

/**
 * Who is coming, who came and who paid (coach/SPEC.md K2 item 6, v3.4).
 *
 * One list for both: each booking is a PlayerCard whose left zone opens the
 * player card (K13) and whose right zone holds the attendance and payment
 * toggles (decision 38). The two never touch each other (decision 41).
 *
 * Confirmed rows first and alone under the heading: a coach arriving at the
 * rink needs that list to be exactly who is coming. Withdrawn and removed
 * bookings are kept (BR-044) and shown below.
 *
 * v3.7: before the start each card begins with the family's answer — `Půjde`
 * or `Nepotvrzeno` — and attendance waits (K2n). Who the family withdrew is
 * the `NEPŮJDOU` section, with their reason and `Pozdě` when it came after the
 * deadline; the coach's removals stay behind the disclosure.
 */
export function RosterList({
  sessionId,
  sessionLabel,
  startAt,
  endAt,
  entries,
  candidates,
  capacity,
  confirmedCount,
  addable,
  editable,
  timezone,
}: {
  sessionId: string
  sessionLabel: string
  startAt: string
  endAt: string
  entries: RosterEntry[]
  candidates: CandidateAthlete[]
  capacity: number
  confirmedCount: number
  addable: boolean
  /**
   * canEdit(session) on a training that is not cancelled (decision 33). Unlike
   * adding, attendance and payment stay open after the training is over.
   */
  editable: boolean
  timezone: Timezone
}) {
  const router = useRouter()
  const toast = useToast()
  const undoToast = useUndoToast()
  const [, startTransition] = useTransition()
  const [overrides, setOverrides] = useState<Record<string, Override>>({})
  const [adding, setAdding] = useState(false)
  const [markingAll, setMarkingAll] = useState(false)
  const now = new Date()
  const started = new Date(startAt) <= now

  const { confirmed, inactive } = splitRoster(entries)
  const { withdrawn, removed } = splitInactive(inactive)
  const goingCount = confirmed.filter((entry) => entry.guardianResponse === 'GOING').length

  const shown = confirmed.map((entry) => {
    const override = overrides[entry.bookingId]
    const paid = entry.paidAt !== null
    return {
      entry,
      attendance:
        override?.attendance && override.attendance.from === entry.attendance
          ? override.attendance.to
          : entry.attendance,
      paid: override?.paid && override.paid.from === paid ? override.paid.to : paid,
    }
  })

  const presentCount = shown.filter((row) => row.attendance === 'PRESENT').length
  const paidCount = shown.filter((row) => row.paid).length
  const unpaid = shown.filter((row) => !row.paid).map((row) => row.entry)
  const unmarked = shown.filter((row) => row.attendance === null)

  function override(bookingId: string, next: Override) {
    setOverrides((current) => ({ ...current, [bookingId]: { ...current[bookingId], ...next } }))
  }

  function settle(result: { ok: true } | { ok: false; code: string }, bookingId: string) {
    if (!result.ok) {
      toast(errorText(result.code))
      setOverrides((current) => {
        const { [bookingId]: _dropped, ...rest } = current
        return rest
      })
    }
    router.refresh()
  }

  function toggleAttendance(entry: RosterEntry, mark: AttendanceMark) {
    const to = nextAttendance(mark)
    override(entry.bookingId, { attendance: { from: entry.attendance, to } })
    startTransition(async () => {
      settle(await setAttendance(sessionId, entry.bookingId, to), entry.bookingId)
    })
  }

  function togglePaid(entry: RosterEntry, paid: boolean) {
    const name = `${entry.firstName} ${entry.lastName}`
    override(entry.bookingId, { paid: { from: entry.paidAt !== null, to: !paid } })
    startTransition(async () => {
      const result = await setBookingPaid(sessionId, entry.bookingId, !paid)
      settle(result, entry.bookingId)
      // Turning a payment off is the one change with an undo (DS §6.16).
      if (result.ok && paid) {
        undoToast({
          message: t.paymentCancelled.replace('{athlete}', name),
          actionLabel: t.undoPayment,
          onAction: () => {
            override(entry.bookingId, { paid: { from: false, to: true } })
            startTransition(async () => {
              settle(await undoUnpaid(sessionId, entry.bookingId), entry.bookingId)
            })
          },
        })
      }
    })
  }

  function othersPresent() {
    for (const row of unmarked) {
      override(row.entry.bookingId, { attendance: { from: null, to: 'PRESENT' } })
    }
    startTransition(async () => {
      const result = await markAllPresent(sessionId)
      if (!result.ok) {
        toast(errorText(result.code))
        setOverrides({})
      }
      router.refresh()
    })
  }

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
        <>
          {/* The column header: what each toggle is, and how many so far. */}
          <div className="flex items-end justify-between pr-4 pl-3">
            <span className="flex flex-col gap-0.5">
              {started ? null : (
                <span className="text-hint font-bold text-ink">
                  {t.responsesConfirmed
                    .replace('{total}', String(confirmed.length))
                    .split('{count}')
                    .flatMap((part, index) =>
                      index === 0
                        ? [part]
                        : [
                            <span key="count" className="text-success">
                              {goingCount}
                            </span>,
                            part,
                          ],
                    )}
                </span>
              )}
              <span className="text-caption font-bold tracking-[0.05em] text-muted">
                {t.rosterColumnAthlete}
              </span>
            </span>
            <span className="-mr-2.5 flex gap-2">
              <ColumnCount
                className={TOGGLE_CELLS[0]}
                label={t.rosterColumnPresent}
                count={presentCount}
                total={confirmed.length}
                pending={!started}
              />
              <ColumnCount
                className={TOGGLE_CELLS[1]}
                label={t.rosterColumnPaid}
                count={paidCount}
                total={confirmed.length}
              />
            </span>
          </div>

          <ul className="flex flex-col gap-2">
            {shown.map(({ entry, attendance, paid }) => {
              const name = `${entry.firstName} ${entry.lastName}`
              return (
                <li key={entry.bookingId}>
                  <PlayerCard
                    href={`/trener/sportovci/${entry.athleteId}` as Route}
                    toggles={
                      <>
                        <StatusToggle
                          kind="attendance"
                          state={attendanceView(attendance, { startAt, endAt }, now)}
                          athlete={name}
                          readOnly={!editable}
                          className={TOGGLE_CELLS[0]}
                          onToggle={() => toggleAttendance(entry, attendance)}
                        />
                        <StatusToggle
                          kind="payment"
                          state={paid ? 'paid' : 'unpaid'}
                          athlete={name}
                          readOnly={!editable}
                          className={TOGGLE_CELLS[1]}
                          onToggle={() => togglePaid(entry, paid)}
                        />
                      </>
                    }
                  >
                    <Avatar firstName={entry.firstName} lastName={entry.lastName} size={40} />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-[1rem]/[1.3125rem] font-bold text-ink">
                        {name}
                      </span>
                      <span className="flex min-w-0 items-center gap-1.5 text-meta text-muted">
                        {started ? null : (
                          <span
                            className={cn(
                              'shrink-0 font-bold',
                              entry.guardianResponse === 'GOING' ? 'text-success' : 'text-warning',
                            )}
                          >
                            {entry.guardianResponse === 'GOING'
                              ? t.responseGoing
                              : t.responsePending}
                            {' ·'}
                          </span>
                        )}
                        <span className="truncate">{yearAndPosition(entry)}</span>
                        {entry.coachNote ? (
                          <span
                            role="img"
                            aria-label={t.hasCoachNote}
                            className="text-internal-ink"
                          >
                            <LockIcon />
                          </span>
                        ) : null}
                        {entry.parentMessage ? (
                          <span role="img" aria-label={t.messageSentIndicator}>
                            <BubbleIcon />
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </PlayerCard>
                </li>
              )
            })}
          </ul>

          {editable ? (
            <div className="grid grid-cols-2 gap-2">
              <Button
                size="lg"
                variant="outline"
                onClick={othersPresent}
                disabled={!started || unmarked.length === 0}
                className="gap-1.5"
              >
                <PersonCheckIcon className="size-[18px]" />
                {t.othersPresent}
              </Button>
              {unpaid.length === 0 ? (
                <span className="flex min-h-13 items-center justify-center gap-1.5 text-row font-bold text-success">
                  {t.allPaid}
                </span>
              ) : (
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => setMarkingAll(true)}
                  className="gap-1.5"
                >
                  <DollarIcon className="size-[18px]" />
                  {t.markAllPaid}
                </Button>
              )}
            </div>
          ) : null}

          <p className="text-hint text-muted">
            {started ? t.attendanceFootnote : t.attendanceFootnoteBefore}
          </p>
        </>
      )}

      {withdrawn.length > 0 ? (
        <section className="mt-2 flex flex-col gap-2">
          <h3 className="px-1 text-caption font-bold tracking-[0.05em] text-muted">
            {t.notGoingCaption.replace('{count}', String(withdrawn.length))}
          </h3>
          <ul className="flex flex-col gap-2">
            {withdrawn.map((entry) => (
              <li key={entry.bookingId}>
                <Link
                  href={`/trener/sportovci/${entry.athleteId}` as Route}
                  className="flex flex-col gap-2 rounded-card bg-[#f8f9fb] py-3 pr-4 pl-3 shadow-[inset_0_0_0_1px_var(--color-line)]"
                >
                  <span className="flex items-center gap-2.5">
                    <Avatar firstName={entry.firstName} lastName={entry.lastName} size={40} muted />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[1rem]/[1.3125rem] font-bold text-muted">
                        {entry.firstName} {entry.lastName}
                      </span>
                      <span className="text-meta text-muted">
                        {t.withdrawnMeta
                          .replace('{year}', String(entry.birthYear ?? ''))
                          .replace('{when}', withdrawnWhen(entry.cancelledAt, timezone, now))}
                      </span>
                    </span>
                    {entry.cancelLate ? (
                      <Badge variant="warning" size="sm" className="normal-case tracking-normal">
                        {t.late}
                      </Badge>
                    ) : null}
                  </span>
                  {entry.cancellationReason ? (
                    <span className="ml-[50px] rounded-control bg-surface px-2.5 py-2 text-meta text-ink shadow-[inset_0_0_0_1px_var(--color-line)]">
                      „{entry.cancellationReason}“
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
          <p className="px-1 text-hint text-muted">{t.notGoingFootnote}</p>
        </section>
      ) : null}

      {removed.length > 0 ? (
        <details className="rounded-card bg-neutral-50 p-3">
          <summary className="min-h-11 cursor-pointer text-meta font-semibold text-muted">
            {t.rosterRemoved} ({removed.length})
          </summary>
          <ul className="flex flex-col gap-2 pt-2">
            {removed.map((entry) => (
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

function ColumnCount({
  label,
  count,
  total,
  className,
  pending = false,
}: {
  label: string
  count: number
  total: number
  className: string
  /** K2n: nothing to count before the start, so a dash. */
  pending?: boolean
}) {
  return (
    <span className={`flex flex-col items-center ${className}`}>
      <span className="text-hint font-semibold text-muted">{label}</span>
      <span className="nums font-display text-[1.125rem]/[1.25rem] font-bold text-ink">
        {pending ? '–' : `${count}/${total}`}
      </span>
    </span>
  )
}

/** `25. 9. v 20:14`, or `dnes v 9:05` (K2n). */
function withdrawnWhen(at: string | null, timezone: Timezone, now: Date): string {
  if (!at) return ''
  const when = new Date(at)
  return relativeDayLabel(when, now, timezone) === 'TODAY'
    ? t.today.replace('{time}', formatTime(when, timezone))
    : formatDateAtTime(when, timezone)
}
