'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { messages } from '@/lib/i18n'
import { setAthleteActive } from '@/server/athletes/actions'
import { Switch } from '@/components/ui/switch'

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
    <section className="flex flex-col gap-2.5">
      <h2 className="text-caption font-bold uppercase tracking-[0.8px] text-muted">
        {messages.athlete.stateCaption}
      </h2>
      <div className="flex flex-col gap-3 rounded-card bg-surface p-4 shadow-card">
        <Switch
          checked={isActive}
          onChange={onToggle}
          label={messages.athlete.activeSwitch}
          hint={messages.athlete.activeSwitchHint}
          disabled={pending}
        />
        <p className="rounded-control-lg bg-bg p-3 text-meta text-muted">
          {messages.athlete.deactivateExplain}
        </p>
        {error ? (
          <p role="alert" className="text-hint font-semibold text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  )
}
