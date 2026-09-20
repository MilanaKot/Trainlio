'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { messages } from '@/lib/i18n'
import { formatDate, formatTime } from '@/lib/time/workspace-time'
import { HOCKEY_POSITION_LABELS, type HockeyPosition } from '@/lib/enums/hockey'
import { attribution, blockedReason, splitCandidates, splitRoster } from '@/lib/domain/roster'
import { addAthleteToSession, removeAthleteFromSession } from '@/server/roster/actions'
import type { CandidateAthlete, RosterEntry } from '@/server/roster/queries'
import type { Timezone } from '@/lib/time/workspace-time'

const t = messages.coach

const button =
  'min-h-11 rounded-lg border border-black/15 px-4 text-sm disabled:opacity-60 dark:border-white/20'

function positionLabel(code: string | null): string | null {
  if (!code) return null
  return HOCKEY_POSITION_LABELS[code as HockeyPosition] ?? code
}

/**
 * The coach roster (UI_SPEC, AC-090, BR-092).
 *
 * Confirmed and withdrawn rows are shown separately, because cancelled
 * bookings are preserved rather than deleted (BR-044) and a coach arriving at
 * the rink needs the first list to be exactly who is coming.
 *
 * Both the over-capacity confirmation and the removal warning are rendered
 * here, but neither is what enforces the rule. The domain function refuses an
 * addition that would exceed capacity unless the confirmation flag is set, so
 * a client that skipped this dialog would simply be refused (AC-050).
 */
export function SessionRoster({
  sessionId,
  entries,
  candidates,
  capacity,
  timezone,
  addable,
}: {
  sessionId: string
  entries: RosterEntry[]
  candidates: CandidateAthlete[]
  capacity: number
  timezone: Timezone
  addable: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState('')
  const [overCapacity, setOverCapacity] = useState<{ confirmed: number; capacity: number } | null>(
    null,
  )
  const [removing, setRemoving] = useState<RosterEntry | null>(null)
  const [reason, setReason] = useState('')

  const { confirmed, inactive } = splitRoster(entries)
  const { available } = splitCandidates(candidates)

  function fail(code: string) {
    const table = t.errors as Record<string, string>
    setError(table[code] ?? t.errors.generic)
  }

  function add(athleteId: string, confirmOverCapacity: boolean) {
    setError(null)
    startTransition(async () => {
      const result = await addAthleteToSession(sessionId, athleteId, confirmOverCapacity)

      if (result.ok) {
        setPicked('')
        setOverCapacity(null)
        router.refresh()
        return
      }

      // AC-050: the refusal carries the numbers the warning has to show, so the
      // dialog never states a count the client guessed.
      if (result.code === 'WOULD_EXCEED_CAPACITY') {
        setOverCapacity({
          confirmed: result.confirmedCount ?? confirmed.length,
          capacity: result.capacity ?? capacity,
        })
        return
      }

      setOverCapacity(null)
      fail(result.code)
    })
  }

  function remove(entry: RosterEntry) {
    setError(null)
    startTransition(async () => {
      const result = await removeAthleteFromSession(sessionId, entry.bookingId, reason)
      setRemoving(null)
      setReason('')
      if (!result.ok) {
        fail(result.code)
        return
      }
      router.refresh()
    })
  }

  return (
    <section className="flex flex-col gap-4 border-t border-black/10 pt-6 dark:border-white/15">
      <h2 className="text-base font-medium">
        {t.roster} ({confirmed.length} / {capacity})
      </h2>

      {confirmed.length === 0 ? (
        <p className="text-sm opacity-70">{t.rosterEmpty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {confirmed.map((entry) => (
            <li
              key={entry.bookingId}
              className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-black/10 p-3 dark:border-white/15"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <p className="font-medium">
                  {entry.firstName} {entry.lastName}
                  {entry.jerseyNumber ? (
                    <span className="opacity-60"> #{entry.jerseyNumber}</span>
                  ) : null}
                </p>
                <p className="text-xs opacity-60">
                  {[entry.birthYear, positionLabel(entry.positionCode), entry.clubName]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {/* BR-092: who booked, and when. */}
                <p className="text-xs opacity-60">
                  {(attribution(entry) === 'GUARDIAN' ? t.bookedBy : t.bookedByCoach).replace(
                    '{name}',
                    entry.bookedByName ?? '—',
                  )}
                  {' · '}
                  {t.bookedAt
                    .replace('{date}', formatDate(new Date(entry.bookedAt), timezone))
                    .replace('{time}', formatTime(new Date(entry.bookedAt), timezone))}
                </p>
                {entry.capacityOverride ? (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    {t.overCapacityBadge}
                  </p>
                ) : null}
              </div>

              {addable ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setRemoving(entry)
                    setReason('')
                  }}
                  className={`${button} shrink-0`}
                >
                  {t.removeAthlete}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {/* BR-044 / AC-070a: nothing is hard-deleted, so the history stays visible. */}
      {inactive.length > 0 ? (
        <details className="text-sm">
          <summary className="min-h-11 cursor-pointer py-2 opacity-70">
            {t.rosterRemoved} ({inactive.length})
          </summary>
          <ul className="flex flex-col gap-2 pt-2">
            {inactive.map((entry) => (
              <li key={entry.bookingId} className="flex flex-col gap-1 opacity-70">
                <span>
                  {entry.firstName} {entry.lastName}
                  {' — '}
                  {entry.status === 'CANCELLED_BY_COACH'
                    ? t.removedByCoachBadge
                    : t.cancelledByUserBadge}
                </span>
                {entry.cancellationReason ? (
                  <span className="text-xs">{entry.cancellationReason}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {addable ? (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-2 text-sm font-medium">
            {t.addAthlete}
            <select
              value={picked}
              onChange={(e) => {
                setPicked(e.target.value)
                setOverCapacity(null)
              }}
              className="min-h-11 rounded-lg border border-black/15 px-3 py-2 text-base dark:border-white/20"
            >
              <option value="">{t.pickCandidate}</option>
              {available.map((c) => (
                <option key={c.athleteId} value={c.athleteId}>
                  {c.firstName} {c.lastName}
                  {c.birthYear ? ` (${c.birthYear})` : ''}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            // Not disabled on a full session: a full session is a warning the
            // coach may override, not a bar (BR-033).
            disabled={pending || picked === ''}
            onClick={() => add(picked, false)}
            className={button}
          >
            {pending ? t.adding : messages.common.add}
          </button>
        </div>
      ) : null}

      {/* Why a name is missing from the list above. */}
      {addable && available.length === 0 ? (
        <p className="text-sm opacity-70">{t.noCandidates}</p>
      ) : null}
      {addable ? <Ineligible candidates={candidates} /> : null}

      {overCapacity ? (
        <div className="flex flex-col gap-3 rounded-lg border border-amber-600/50 p-4">
          <p className="font-medium">
            {t.overCapacityTitle
              .replace('{confirmed}', String(overCapacity.confirmed))
              .replace('{capacity}', String(overCapacity.capacity))}
          </p>
          <p className="text-sm leading-relaxed">{t.overCapacityWarning}</p>
          <div className="flex gap-3">
            <button type="button" onClick={() => setOverCapacity(null)} className={button}>
              {messages.common.cancel}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => add(picked, true)}
              className="min-h-11 rounded-lg bg-black px-4 text-sm font-medium text-white disabled:opacity-60 dark:bg-white dark:text-black"
            >
              {t.addAnyway}
            </button>
          </div>
        </div>
      ) : null}

      {removing ? (
        <div className="flex flex-col gap-3 rounded-lg border border-red-600/40 p-4">
          <p className="font-medium">
            {t.removeTitle}: {removing.firstName} {removing.lastName}
          </p>
          {/* D-06: says plainly that the parent cannot undo this. */}
          <p className="text-sm leading-relaxed">{t.removeWarning}</p>
          <label className="flex flex-col gap-2 text-sm">
            {t.reasonOptional}
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="min-h-11 rounded-lg border border-black/15 px-3 py-2 text-base dark:border-white/20"
            />
          </label>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                setRemoving(null)
                setReason('')
              }}
              className={button}
            >
              {messages.common.cancel}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => remove(removing)}
              className="min-h-11 rounded-lg bg-red-600 px-4 text-sm font-medium text-white disabled:opacity-60"
            >
              {pending ? t.removing : t.removeConfirm}
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </section>
  )
}

/**
 * The athletes the coach cannot add, with the server's reason.
 *
 * The guardian picker hides these; the coach's does not. "Chybí hokejový
 * profil" and "Neodpovídá ročník" are things a coach can act on, and a name
 * that silently never appears is the harder problem to diagnose.
 */
function Ineligible({ candidates }: { candidates: CandidateAthlete[] }) {
  const { blocked } = splitCandidates(candidates)
  if (blocked.length === 0) return null

  const reasons = t.ineligibleReason as Record<string, string>

  return (
    <details className="text-sm">
      <summary className="min-h-11 cursor-pointer py-2 opacity-70">
        {t.ineligibleTitle} ({blocked.length})
      </summary>
      <ul className="flex flex-col gap-1 pt-2 text-xs opacity-70">
        {blocked.map((c) => (
          <li key={c.athleteId}>
            {c.firstName} {c.lastName} —{' '}
            {(() => {
              const reason = blockedReason(c) ?? ''
              return reasons[reason] ?? reason
            })()}
          </li>
        ))}
      </ul>
    </details>
  )
}
