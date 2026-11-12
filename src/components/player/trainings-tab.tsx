'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { Route } from 'next'
import { messages } from '@/lib/i18n'
import {
  attendanceView,
  inPeriod,
  nextAttendance,
  periodCaption,
  summarizeAttendance,
  type AttendanceMark,
  type Period,
} from '@/lib/domain/attendance'
import { changingRoomLabel } from '@/lib/domain/session'
import { formatDateShort, formatTime, formatTimeRange } from '@/lib/time/workspace-time'
import { setAttendance, setBookingPaid, undoUnpaid } from '@/server/roster/actions'
import { RemoveAthleteDialog } from '@/components/roster/remove-athlete-dialog'
import { PeriodControl } from '@/components/ui/period-control'
import { PlayerCard, TOGGLE_CELLS } from '@/components/ui/player-card'
import { StatusToggle } from '@/components/ui/status-toggle'
import { useToast, useUndoToast } from '@/components/ui/toast'
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
 */
export function TrainingsTab({
  athleteName,
  sessions,
  period,
  timezone,
}: {
  athleteName: string
  sessions: CardSession[]
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

  const inThisPeriod = rows.filter((row) =>
    inPeriod(new Date(row.session.startAt), period, timezone),
  )
  const summary = summarizeAttendance(
    inThisPeriod.map((row) => ({
      startAt: row.session.startAt,
      endAt: row.session.endAt,
      mark: row.attendance,
      sessionCancelled: false,
    })),
    now,
  )
  const paidInPeriod = inThisPeriod.filter((row) => row.paid).length

  const upcoming = rows
    .filter((row) => new Date(row.session.startAt) > now)
    .sort((a, b) => a.session.startAt.localeCompare(b.session.startAt))
  const past = inThisPeriod
    .filter((row) => new Date(row.session.startAt) <= now)
    .sort((a, b) => b.session.startAt.localeCompare(a.session.startAt))

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
                athlete={athleteName}
                readOnly={!session.editable}
                className={TOGGLE_CELLS[0]}
                onToggle={() => toggleAttendance(session, attendance)}
              />
              <StatusToggle
                kind="payment"
                size="md"
                state={paid ? 'paid' : 'unpaid'}
                athlete={athleteName}
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
            </span>
          </span>
        </PlayerCard>
      </li>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <PeriodControl period={period} />

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
          {t.upcoming.replace('{count}', String(upcoming.length))}
        </h2>
        {upcoming.length === 0 ? (
          <p className="text-meta text-muted">{t.upcomingNone}</p>
        ) : (
          <ul className="flex flex-col gap-2">{upcoming.map((row) => card(row, true))}</ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-caption font-bold uppercase tracking-[0.05em] text-muted">
          {t.past.replace('{period}', periodCaption(period).toLocaleUpperCase('cs'))}
        </h2>
        {past.length === 0 ? (
          <p className="text-meta text-muted">{t.pastNone}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {past.slice(0, shown).map((row) => card(row, false))}
          </ul>
        )}
        {past.length > shown ? (
          <button
            type="button"
            onClick={() => setShown((count) => count + PAGE)}
            className="flex min-h-11 items-center self-start text-row font-bold text-primary"
          >
            {t.showMore.replace('{count}', String(past.length - shown))}
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
