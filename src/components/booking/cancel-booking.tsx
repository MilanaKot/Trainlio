'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { messages } from '@/lib/i18n'
import { cancelBooking } from '@/server/bookings/actions'

const t = messages.cancellation

/**
 * Guardian cancellation.
 *
 * When the deadline has passed the button is replaced by the explanation
 * (UI_SPEC, BR-041) rather than left enabled to fail. The disabled state is a
 * courtesy: the server evaluates the deadline on database time and refuses a
 * late request whatever the browser's clock says.
 */
export function CancelBooking({ bookingId, allowed }: { bookingId: string; allowed: boolean }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (!allowed) {
    return <p className="text-sm opacity-70">{t.tooLate}</p>
  }

  function onCancel() {
    setError(null)
    startTransition(async () => {
      const result = await cancelBooking(bookingId)
      if (!result.ok) {
        const table = messages.booking.errors as Record<string, string>
        setError(table[result.code] ?? messages.booking.errors.generic)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onCancel}
        disabled={pending}
        className="min-h-11 self-start rounded-lg border border-black/15 px-4 text-sm disabled:opacity-60 dark:border-white/20"
      >
        {t.cancel}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  )
}
