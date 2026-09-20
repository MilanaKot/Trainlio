'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { messages } from '@/lib/i18n'
import { cancelSession, duplicateSession, setBookingState } from '@/server/sessions/actions'
import type { CoachSession } from '@/server/sessions/queries'

const t = messages.coach

/**
 * Close/reopen, duplicate and cancel.
 *
 * Cancellation is behind an explicit confirmation that states it is terminal
 * and that parents will be emailed (D-07). Nothing here decides anything: each
 * button calls a domain function that re-checks the coach's membership and the
 * session's state.
 */
export function SessionActions({
  session,
  todayLocal,
}: {
  session: CoachSession
  todayLocal: string
}) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [reason, setReason] = useState('')
  const [duplicateDate, setDuplicateDate] = useState(todayLocal)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const cancelled = session.status === 'CANCELLED'

  function run(action: () => Promise<{ ok: boolean; code?: string; sessionId?: string | undefined }>) {
    setError(null)
    startTransition(async () => {
      const result = await action()
      if (!result.ok) {
        const table = t.errors as Record<string, string>
        setError(table[result.code ?? ''] ?? t.errors.generic)
        return
      }
      if (result.sessionId && result.sessionId !== session.id) {
        router.push(`/trener/${result.sessionId}`)
      }
      router.refresh()
    })
  }

  const button =
    'min-h-11 rounded-lg border border-black/15 px-4 text-sm disabled:opacity-60 dark:border-white/20'

  return (
    <div className="flex flex-col gap-4 border-t border-black/10 pt-6 dark:border-white/15">
      {cancelled ? <p className="text-sm opacity-70">{t.cancelledNotice}</p> : null}

      <div className="flex flex-wrap gap-3">
        {!cancelled ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => setBookingState(session.id, session.status !== 'OPEN'))}
            className={button}
          >
            {session.status === 'OPEN' ? t.closeBooking : t.openBooking}
          </button>
        ) : null}

        {!cancelled && !confirming ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirming(true)}
            className={`${button} text-red-600`}
          >
            {t.cancelSession}
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-2 text-sm font-medium">
          {t.duplicateTitle}
          <input
            type="date"
            value={duplicateDate}
            onChange={(e) => setDuplicateDate(e.target.value)}
            className="rounded-lg border border-black/15 px-3 py-2 text-base dark:border-white/20"
          />
        </label>
        <button
          type="button"
          disabled={pending || !duplicateDate}
          onClick={() => run(() => duplicateSession(session.id, duplicateDate))}
          className={button}
        >
          {t.duplicate}
        </button>
      </div>

      {confirming ? (
        <div className="flex flex-col gap-3 rounded-lg border border-red-600/40 p-4">
          <p className="font-medium">{t.cancelWarningTitle}</p>
          {/* Says plainly that this cannot be undone and that emails go out. */}
          <p className="text-sm leading-relaxed">{t.cancelWarning}</p>
          <label className="flex flex-col gap-2 text-sm">
            {t.reasonOptional}
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="rounded-lg border border-black/15 px-3 py-2 text-base dark:border-white/20"
            />
          </label>
          <div className="flex gap-3">
            <button type="button" onClick={() => setConfirming(false)} className={button}>
              {messages.common.cancel}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const result = await cancelSession(session.id, reason)
                  setConfirming(false)
                  return result
                })
              }
              className="min-h-11 rounded-lg bg-red-600 px-4 text-sm font-medium text-white disabled:opacity-60"
            >
              {t.cancelConfirm}
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  )
}
