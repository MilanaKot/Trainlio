'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Route } from 'next'
import { messages } from '@/lib/i18n'
import {
  attendanceView,
  nextAttendance,
  summarizeAttendance,
  type AttendanceMark,
} from '@/lib/domain/attendance'
import { inPeriod, periodCaption, type Period } from '@/lib/period'
import { changingRoomLabel } from '@/lib/domain/session'
import {
  formatDateAtTime,
  formatDateShort,
  formatTime,
  formatTimeRange,
} from '@/lib/time/workspace-time'
import { setAttendance, setBookingPaid, undoUnpaid } from '@/server/roster/actions'
import { RemoveAthleteDialog } from '@/components/roster/remove-athlete-dialog'
import { PeriodControl } from '@/components/ui/period-control'
import { PlayerCard, TOGGLE_CELLS } from '@/components/ui/player-card'
import { StatusToggle } from '@/components/ui/status-toggle'
import { useToast, useUndoToast } from '@/components/ui/toast'
import { CrossIcon } from '@/components/booking/response-block'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { CoachAthleteSession } from '@/server/roster/queries'

const t = messages.coach.card

const PAGE = 10

/** A confirmed booking on a training that was not called off. */
export type CardSession = CoachAthleteSession & {
  /** canEdit(session) for the signed-in coach (decision 33). */
  editable: boolean
}

type Override = {
  attendance?: { from: AttendanceMark; to: AttendanceMark }
  paid?: { from: boolean; to: boolean }
}

/**
 * K13 · Tréninky (decision 43): the period's two numbers, what is still to
 * come, and what has happened — each training a PlayerCard with the same
 * toggles and the same tap rules as K2.
 *
 * The tiles count the selected month or year: attendance over trainings that
 * have started (an unmarked one counts as `Nebyl` once it is over), payment
 * over every booking in the period, the future ones too, since a training can
 * be paid in advance. `Nadcházející` is every upcoming booking whatever the
 * period; `Proběhlé` is the period's.
 *
 * v3.7: an upcoming row says whether the family answered `Půjde`; a training
 * they withdrew from (`Nepůjde`) is a muted row with their reason, and once
 * it is over a static Nebyl — it counts as one (decision 54).
 */
export function TrainingsTab({
  athleteName,
  sessions,
  withdrawals,
  period,
  timezone,
}: {
  athleteName: string
  sessions: CardSession[]
  /** `currentWithdrawals`: one per training, none that was rebooked. */
  withdrawals: CoachAthleteSession[]
  period: Period
  timezone: string
}) {
  const router = useRouter()
  const toast = useToast()
  const undoToast = useUndoToast()
  const [, startTransition] = useTransition()
  const [overrides, setOverrides] = useState<Record<string, Override>>({})
  const [shown, setShown] = useState(PAGE)
  const [removing, setRemoving] = useState<CardSession | null>(null)
  const now = new Date()

  const rows = sessions.map((session) => {
    const override = overrides[session.bookingId]
    const paid = session.paidAt !== null
    return {
      session,
      attendance:
        override?.attendance && override.attendance.from === session.attendance
          ? override.attendance.to
          : session.attendance,
      paid: override?.paid && override.paid.from === paid ? override.paid.to : paid,
    }
  })

  const inThisPeriod = rows.filter((row) => inPeriod(new Date(row.session.startAt), period))
  const withdrawnInPeriod = withdrawals.filter((w) => inPeriod(new Date(w.startAt), period))
  const summary = summarizeAttendance(
    [
      ...inThisPeriod.map((row) => ({
        sessionId: row.session.sessionId,
        startAt: row.session.startAt,
        endAt: row.session.endAt,
        mark: row.attendance,
        sessionCancelled: false,
        withdrawn: false,
      })),
      ...withdrawnInPeriod.map((w) => ({
        sessionId: w.sessionId,
        startAt: w.startAt,
        endAt: w.endAt,
        mark: null,
        sessionCancelled: false,
        withdrawn: true,
      })),
    ],
    now,
  )
  const paidInPeriod = inThisPeriod.filter((row) => row.paid).length

  const upcoming = rows
    .filter((row) => new Date(row.session.startAt) > now)
    .sort((a, b) => a.session.startAt.localeCompare(b.session.startAt))
  const past = inThisPeriod
    .filter((row) => new Date(row.session.startAt) <= now)
    .sort((a, b) => b.session.startAt.localeCompare(a.session.startAt))
  const upcomingWithdrawn = withdrawals
    .filter((w) => new Date(w.startAt) > now)
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
  // Past ones interleave with the period's trainings, newest first.
  const pastRows: (
    { kind: 'card'; row: (typeof rows)[number] } | { kind: 'withdrawn'; w: CoachAthleteSession }
  )[] = [
    ...past.map((row) => ({ kind: 'card' as const, row })),
    ...withdrawnInPeriod
      .filter((w) => new Date(w.startAt) <= now)
      .map((w) => ({ kind: 'withdrawn' as const, w })),
  ].sort((a, b) =>
    (b.kind === 'card' ? b.row.session.startAt : b.w.startAt).localeCompare(
      a.kind === 'card' ? a.row.session.startAt : a.w.startAt,
    ),
  )

  function override(bookingId: string, next: Override) {
    setOverrides((current) => ({ ...current, [bookingId]: { ...current[bookingId], ...next } }))
  }

  function settle(result: { ok: true } | { ok: false; code: string }, bookingId: string) {
    if (!result.ok) {
      const table = messages.coach.errors as Record<string, string>
      toast(table[result.code] ?? messages.coach.errors.generic)
      setOverrides((current) => {
        const { [bookingId]: _dropped, ...rest } = current
        return rest
      })
    }
    router.refresh()
  }

  function toggleAttendance(session: CardSession, mark: AttendanceMark) {
    const to = nextAttendance(mark)
    override(session.bookingId, { attendance: { from: session.attendance, to } })
    startTransition(async () => {
      settle(await setAttendance(session.sessionId, session.bookingId, to), session.bookingId)
    })
  }

  function togglePaid(session: CardSession, paid: boolean) {
    override(session.bookingId, { paid: { from: session.paidAt !== null, to: !paid } })
    startTransition(async () => {
      const result = await setBookingPaid(session.sessionId, session.bookingId, !paid)
      settle(result, session.bookingId)
      if (result.ok && paid) {
        undoToast({
          message: messages.coach.paymentCancelled.replace('{athlete}', athleteName),
          actionLabel: messages.coach.undoPayment,
          onAction: () => {
            override(session.bookingId, { paid: { from: false, to: true } })
            startTransition(async () => {
              settle(await undoUnpaid(session.sessionId, session.bookingId), session.bookingId)
            })
          },
        })
      }
    })
  }

  function card(row: (typeof rows)[number], upcomingRow: boolean) {
    const { session, attendance, paid } = row
    const start = new Date(session.startAt)
    const end = new Date(session.endAt)
    // On the card the athlete is the page's subject; the toggles name the
    // training, so two rows never share a label.
    return (
      <li key={session.bookingId}>
        <PlayerCard
          compact
          href={`/trener/${session.sessionId}` as Route}
          {...(upcomingRow && session.editable
            ? {
                below: (
                  <button
                    type="button"
                    onClick={() => setRemoving(session)}
                    className="flex min-h-8 items-center text-meta font-bold text-danger"
                  >
                    {t.remove}
                  </button>
                ),
              }
            : {})}
          toggles={
            <>
              <StatusToggle
                kind="attendance"
                size="md"
                state={attendanceView(attendance, session, now)}
                athlete={`${formatDateShort(start, timezone)} ${formatTime(start, timezone)}`}
                readOnly={!session.editable}
                className={TOGGLE_CELLS[0]}
                onToggle={() => toggleAttendance(session, attendance)}
              />
              <StatusToggle
                kind="payment"
                size="md"
                state={paid ? 'paid' : 'unpaid'}
                athlete={`${formatDateShort(start, timezone)} ${formatTime(start, timezone)}`}
                readOnly={!session.editable}
                className={TOGGLE_CELLS[1]}
                onToggle={() => togglePaid(session, paid)}
              />
            </>
          }
        >
          <span className="flex min-w-0 flex-col">
            <span className="nums truncate text-[0.9375rem]/[1.25rem] font-bold text-ink">
              {formatDateShort(start, timezone)} · {formatTimeRange(start, end, timezone)}
            </span>
            <span className="truncate text-meta text-muted">
              {[
                session.facilityCode,
                changingRoomLabel(session.changingRoom, messages.coach.changingRoom),
              ]
                .filter(Boolean)
                .join(' · ')}
              {upcomingRow ? (
                <>
                  {' · '}
                  <span
                    className={cn(
                      'font-bold',
                      session.guardianResponse === 'GOING' ? 'text-success' : 'text-warning',
                    )}
                  >
                    {session.guardianResponse === 'GOING' ? t.responseGoing : t.responsePending}
                  </span>
                </>
              ) : null}
            </span>
          </span>
        </PlayerCard>
      </li>
    )
  }

  /** A training the family withdrew from: their reason, and from the start a Nebyl. */
  function withdrawnRow(w: CoachAthleteSession, upcomingRow: boolean) {
    const start = new Date(w.startAt)
    const end = new Date(w.endAt)
    return (
      <li key={w.bookingId}>
        <Link
          href={`/trener/${w.sessionId}` as Route}
          className="flex items-start gap-2 rounded-card bg-[#f8f9fb] px-3.5 py-3 shadow-[inset_0_0_0_1px_var(--color-line)]"
        >
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="flex flex-wrap items-center justify-between gap-2">
              <span className="nums text-[0.9375rem]/[1.3125rem] font-bold text-muted line-through">
                {formatDateShort(start, timezone)} · {formatTimeRange(start, end, timezone)}
              </span>
              <span className="flex items-center gap-1.5">
                {w.cancelLate ? <Badge variant="warning">{t.late}</Badge> : null}
                <span className="inline-flex h-6 items-center gap-1 rounded-badge bg-danger-soft px-2 text-[0.75rem] font-bold text-danger">
                  <CrossIcon className="size-3.5" />
                  {t.withdrawnBadge}
                </span>
              </span>
            </span>
            {w.cancellationReason ? (
              <span className="text-meta text-ink">„{w.cancellationReason}“</span>
            ) : null}
            {w.cancelledAt ? (
              <span className="text-hint text-muted">
                {t.withdrawnMeta.replace(
                  '{when}',
                  formatDateAtTime(new Date(w.cancelledAt), timezone),
                )}
              </span>
            ) : null}
          </span>
          {upcomingRow ? null : (
            <StatusToggle
              kind="attendance"
              size="md"
              state="absent"
              athlete={`${formatDateShort(start, timezone)} ${formatTime(start, timezone)}`}
              readOnly
              onToggle={() => undefined}
            />
          )}
        </Link>
      </li>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <PeriodControl period={period} timezone={timezone} />

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1 rounded-[14px] bg-surface p-3.5 shadow-card">
          <span className="nums font-display text-[2rem]/[2.25rem] font-bold text-ink">
            {summary.percent === null ? '—' : `${summary.percent} %`}
          </span>
          <span className="text-hint font-semibold text-muted">
            {summary.percent === null
              ? t.attendanceNone
              : t.attendanceTile
                  .replace('{present}', String(summary.present))
                  .replace('{total}', String(summary.present + summary.absent))}
          </span>
        </div>
        <div className="flex flex-col gap-1 rounded-[14px] bg-surface p-3.5 shadow-card">
          <span className="nums font-display text-[2rem]/[2.25rem] font-bold text-ink">
            {paidInPeriod} / {inThisPeriod.length}
          </span>
          <span className="text-hint font-semibold text-muted">{t.paidTile}</span>
        </div>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-caption font-bold uppercase tracking-[0.05em] text-muted">
          {t.upcoming.replace('{count}', String(upcoming.length + upcomingWithdrawn.length))}
          {upcomingWithdrawn.length > 0 ? (
            <span className="font-semibold normal-case tracking-normal">
              {' '}
              {t.upcomingWithdrawn.replace('{count}', String(upcomingWithdrawn.length))}
            </span>
          ) : null}
        </h2>
        {upcoming.length + upcomingWithdrawn.length === 0 ? (
          <p className="text-meta text-muted">{t.upcomingNone}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {[
              ...upcoming.map((row) => ({ at: row.session.startAt, node: card(row, true) })),
              ...upcomingWithdrawn.map((w) => ({ at: w.startAt, node: withdrawnRow(w, true) })),
            ]
              .sort((a, b) => a.at.localeCompare(b.at))
              .map((entry) => entry.node)}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-caption font-bold uppercase tracking-[0.05em] text-muted">
          {t.past.replace('{period}', periodCaption(period))}
        </h2>
        {pastRows.length === 0 ? (
          <p className="text-meta text-muted">{t.pastNone}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {pastRows
              .slice(0, shown)
              .map((entry) =>
                entry.kind === 'card' ? card(entry.row, false) : withdrawnRow(entry.w, false),
              )}
          </ul>
        )}
        {pastRows.length > shown ? (
          <button
            type="button"
            onClick={() => setShown((count) => count + PAGE)}
            className="flex min-h-11 items-center self-start text-row font-bold text-primary"
          >
            {t.showMore.replace('{count}', String(pastRows.length - shown))}
          </button>
        ) : null}
      </section>

      <p className="text-hint text-muted">{t.footnote}</p>

      {removing ? (
        <RemoveAthleteDialog
          open
          onOpenChange={(open) => (open ? undefined : setRemoving(null))}
          sessionId={removing.sessionId}
          bookingId={removing.bookingId}
          athleteName={athleteName}
          sessionLabel={`${formatDateShort(new Date(removing.startAt), timezone)} · ${formatTime(new Date(removing.startAt), timezone)}`}
        />
      ) : null}
    </div>
  )
}
