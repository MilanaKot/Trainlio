'use client'

import { useId, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { messages } from '@/lib/i18n'
import {
  ABSENCE_REASON_CHIPS,
  ABSENCE_REASON_LIMIT,
  chipPrefix,
  validAbsenceReason,
} from '@/lib/domain/guardian-response'
import { cancelWithReason, confirmGoing } from '@/server/bookings/actions'
import { BottomSheet } from '@/components/ui/bottom-sheet'
import { Button } from '@/components/ui/button'
import { controlClass } from '@/components/ui/field'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

const t = messages.response

export function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={cn('size-4 shrink-0', className)}
      aria-hidden="true"
    >
      <path
        d="m5 12.5 4.5 4.5L19 7.5"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function CrossIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={cn('size-4 shrink-0', className)}
      aria-hidden="true"
    >
      <path
        d="M6 6l12 12M18 6 6 18"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

export type ResponseState = 'pending' | 'going' | 'notGoing'

/** DS §6.38: the status badge of the Účast section. */
export function ResponseStatus({ state }: { state: ResponseState }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1 rounded-badge px-2 text-[0.75rem] font-bold',
        state === 'pending' && 'bg-warning-soft text-warning',
        state === 'going' && 'bg-success-soft text-success',
        state === 'notGoing' && 'bg-danger-soft text-danger',
      )}
    >
      {state === 'going' ? <CheckIcon className="size-3.5" /> : null}
      {state === 'notGoing' ? <CrossIcon className="size-3.5" /> : null}
      {state === 'pending' ? t.pending : state === 'going' ? t.going : t.notGoing}
    </span>
  )
}

/**
 * `✓ Půjde` / `✕ Nepůjde`, two equal columns (DS §6.38): 52 px on the
 * booking's own screen, 44 px on a G4 card.
 */
export function ResponseButtons({
  compact = false,
  disabled = false,
  onGoing,
  onNotGoing,
}: {
  compact?: boolean
  disabled?: boolean
  onGoing: () => void
  onNotGoing: () => void
}) {
  const button =
    'flex items-center justify-center gap-2 rounded-button font-bold disabled:opacity-60'
  return (
    <div role="group" aria-label={t.group} className="grid grid-cols-2 gap-2">
      <button
        type="button"
        onClick={onGoing}
        disabled={disabled}
        className={cn(
          button,
          compact ? 'h-touch text-row' : 'h-13 text-body',
          'bg-success-soft text-success shadow-[inset_0_0_0_1.5px_var(--color-success-border)]',
        )}
      >
        <CheckIcon className={compact ? 'size-4' : 'size-5'} />
        {t.going}
      </button>
      <button
        type="button"
        onClick={onNotGoing}
        disabled={disabled}
        className={cn(
          button,
          compact ? 'h-touch text-row' : 'h-13 text-body',
          'bg-danger-soft text-danger shadow-[inset_0_0_0_1.5px_var(--color-danger-line)]',
        )}
      >
        <CrossIcon className={compact ? 'size-4' : 'size-5'} />
        {t.notGoing}
      </button>
    </div>
  )
}

/**
 * G6g: why the athlete will not come. Required, 1–200 characters after
 * trimming; a chip writes `{chip} – ` and leaves the cursor at the end so the
 * parent can go on typing. Confirming withdraws the booking — the reason cannot
 * be edited afterwards.
 */
export function ReasonSheet({
  open,
  onOpenChange,
  firstName,
  pending,
  error,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  firstName: string
  pending: boolean
  error: string | null
  onConfirm: (reason: string) => void
}) {
  const id = useId()
  const field = useRef<HTMLTextAreaElement>(null)
  const [reason, setReason] = useState('')
  const [chip, setChip] = useState<string | null>(null)
  const valid = validAbsenceReason(reason)
  const length = reason.trim().length

  function pick(value: string) {
    const text = chipPrefix(value)
    setChip(value)
    setReason(text)
    // After the render that puts the text in, so the caret lands at its end.
    requestAnimationFrame(() => {
      const el = field.current
      if (!el) return
      el.focus()
      el.setSelectionRange(text.length, text.length)
    })
  }

  return (
    <BottomSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setReason('')
          setChip(null)
        }
        onOpenChange(next)
      }}
      title={t.sheetTitle.replace('{name}', firstName)}
      footer={
        <div className="flex flex-col gap-2">
          <Button
            size="lg"
            variant="danger"
            disabled={!valid}
            onClick={() => onConfirm(reason.trim())}
            {...(pending ? { loadingLabel: t.sending } : {})}
          >
            {t.sheetConfirm.replace('{name}', firstName)}
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            {t.back}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3.5">
        <div role="group" aria-label={t.chips} className="flex flex-wrap gap-2">
          {ABSENCE_REASON_CHIPS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={chip === value}
              onClick={() => pick(value)}
              className={cn(
                'h-9 rounded-full px-3.5 text-meta font-semibold',
                chip === value
                  ? 'bg-primary text-white'
                  : 'bg-surface text-ink shadow-[inset_0_0_0_1.5px_var(--color-line)]',
              )}
            >
              {value}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={id}
            className="flex items-baseline justify-between text-meta font-semibold"
          >
            <span>
              {t.reasonLabel} <span className="text-danger">*</span>
            </span>
            <span
              className={cn(
                'nums text-hint font-normal',
                length > ABSENCE_REASON_LIMIT ? 'font-semibold text-danger' : 'text-muted',
              )}
            >
              {length} / {ABSENCE_REASON_LIMIT}
            </span>
          </label>
          {/* No maxLength: a pasted reason that is too long stays visible, with
              the counter saying why the button is off, rather than being cut. */}
          <textarea
            ref={field}
            id={id}
            rows={3}
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className={cn(controlClass(), 'resize-none py-3')}
          />
        </div>

        <p className="text-hint text-muted">{t.sheetHint.replace('{name}', firstName)}</p>

        {error ? (
          <p role="alert" className="text-hint text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </BottomSheet>
  )
}

/**
 * The two answers for one booking, with their toasts (`Potvrzeno: {Jméno}
 * půjde`, `Odhlášeno`) — shared by the G4 card and the G6 section, so both say
 * the same thing and refuse the same way.
 */
export function useGuardianResponse(bookingId: string, firstName: string) {
  const router = useRouter()
  const toast = useToast()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [reasonOpen, setReasonOpen] = useState(false)

  const errorText = (code: string) => {
    const table = messages.booking.errors as Record<string, string>
    return table[code] ?? messages.booking.errors.generic
  }

  function going() {
    setError(null)
    startTransition(async () => {
      const result = await confirmGoing(bookingId)
      if (!result.ok) {
        setError(errorText(result.code))
        return
      }
      toast(t.confirmedToast.replace('{name}', firstName))
      router.refresh()
    })
  }

  function notGoing(reason: string) {
    setError(null)
    startTransition(async () => {
      const result = await cancelWithReason(bookingId, reason)
      if (!result.ok) {
        setError(errorText(result.code))
        return
      }
      setReasonOpen(false)
      toast(messages.cancellation.done)
      router.refresh()
    })
  }

  const sheet = (
    <ReasonSheet
      open={reasonOpen}
      onOpenChange={(open) => {
        setError(null)
        setReasonOpen(open)
      }}
      firstName={firstName}
      pending={pending}
      error={reasonOpen ? error : null}
      onConfirm={notGoing}
    />
  )

  return {
    pending,
    /** Errors of `Půjde`; the sheet shows its own. */
    error: reasonOpen ? null : error,
    going,
    openReason: () => {
      setError(null)
      setReasonOpen(true)
    },
    sheet,
  }
}
