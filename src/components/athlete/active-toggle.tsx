'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { messages } from '@/lib/i18n'
import { setAthleteActive } from '@/server/athletes/actions'

/**
 * D-09. Deactivation blocks new bookings only — existing bookings, sport
 * profiles and workspace memberships survive untouched, and the guardian can
 * still cancel a booking the athlete already holds. The explanation is on
 * screen because "deactivate" otherwise reads like deletion.
 */
export function ActiveToggle({ athleteId, isActive }: { athleteId: string; isActive: boolean }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function onToggle() {
    setError(null)
    startTransition(async () => {
      const result = await setAthleteActive(athleteId, !isActive)
      if (!result.ok) {
        setError(messages.athlete.errors.generic)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-2 border-t border-black/10 pt-6 dark:border-white/15">
      <p className="text-sm leading-relaxed opacity-70">{messages.athlete.deactivateExplain}</p>
      <button
        type="button"
        onClick={onToggle}
        disabled={pending}
        className="min-h-11 self-start text-sm underline disabled:opacity-60"
      >
        {isActive ? messages.athlete.deactivate : messages.athlete.reactivate}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  )
}
