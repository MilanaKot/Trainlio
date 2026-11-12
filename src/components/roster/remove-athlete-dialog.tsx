'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { messages } from '@/lib/i18n'
import { removeAthleteFromSession } from '@/server/roster/actions'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Field, TextareaWithCounter } from '@/components/ui/field'
import { useToast } from '@/components/ui/toast'

const t = messages.coach

/** The design caps the removal message at 200; the domain function does too. */
const REMOVAL_MESSAGE_LIMIT = 200

/**
 * `Odhlásit sportovce z tréninku?` (coach/SPEC.md K2 item 6), opened since
 * v3.4 from an upcoming row in K13 `Tréninky`. The place is freed at once and
 * the parent gets E07, with the optional message in it.
 */
export function RemoveAthleteDialog({
  open,
  onOpenChange,
  sessionId,
  bookingId,
  athleteName,
  sessionLabel,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionId: string
  bookingId: string
  athleteName: string
  /** `Ne 4. 10. · 09:00` */
  sessionLabel: string
}) {
  const router = useRouter()
  const toast = useToast()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)

  function remove() {
    setError(null)
    startTransition(async () => {
      const result = await removeAthleteFromSession(sessionId, bookingId, message.trim())
      if (!result.ok) {
        const table = t.errors as Record<string, string>
        setError(table[result.code] ?? t.errors.generic)
        return
      }
      onOpenChange(false)
      toast(t.removed)
      router.refresh()
    })
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t.removeTitle}
      description={`${athleteName} · ${sessionLabel}`}
      tone="warning"
      cancelLabel={t.keep}
      confirmLabel={t.removeConfirm}
      onConfirm={remove}
      pending={pending}
      stacked
    >
      <div className="flex flex-col gap-3">
        <Field label={t.removeMessage} optional>
          {(field) => (
            <TextareaWithCounter
              {...field}
              rows={3}
              maxLength={REMOVAL_MESSAGE_LIMIT}
              value={message}
              onChange={setMessage}
            />
          )}
        </Field>
        <p className="flex items-start gap-1.5 text-meta text-muted">
          <svg viewBox="0 0 16 16" fill="none" className="size-4 shrink-0" aria-hidden="true">
            <rect
              x="2"
              y="3.5"
              width="12"
              height="9"
              rx="2"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path d="M2.5 5l5.5 4 5.5-4" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          {t.removeInfo}
        </p>
        {error ? (
          <p role="alert" className="text-hint text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </ConfirmDialog>
  )
}
