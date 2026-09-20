'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { messages, plural } from '@/lib/i18n'
import { bookAthletes } from '@/server/bookings/actions'
import type { PickerAthlete } from '@/server/bookings/queries'

const t = messages.booking

/**
 * The athlete picker (UI_SPEC).
 *
 * Only eligible athletes are offered, and the list comes from the same server
 * function the booking path consults, so the picker cannot offer a child the
 * write would refuse.
 *
 * Selecting several children is one all-or-nothing action (D-05). When there
 * are too few places the server refuses the whole request and says how many
 * remain; this asks the parent to choose, rather than silently booking a subset
 * and leaving them to discover which sibling missed out.
 */
export function BookingPicker({
  sessionId,
  athletes,
  freePlaces,
}: {
  sessionId: string
  athletes: PickerAthlete[]
  freePlaces: number
}) {
  const router = useRouter()
  const [selected, setSelected] = useState<string[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const bookable = athletes.filter((a) => a.canBook)
  const booked = athletes.filter((a) => a.bookingStatus === 'CONFIRMED')
  const removed = athletes.filter((a) => a.removedByCoach)

  function toggle(athleteId: string) {
    setNotice(null)
    setSelected((current) =>
      current.includes(athleteId)
        ? current.filter((id) => id !== athleteId)
        : [...current, athleteId],
    )
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setNotice(null)

    startTransition(async () => {
      const result = await bookAthletes(sessionId, selected)

      if (result.ok) {
        setSelected([])
        router.refresh()
        return
      }

      if (result.code === 'INSUFFICIENT_CAPACITY') {
        const places = result.availablePlaces ?? 0
        // Czech agreement changes the verb, the adjective and the noun with the
        // count, which is why this is a plural set and not a template.
        setNotice(places === 0 ? messages.session.full : plural(places, t.insufficientCapacity))
        return
      }

      const table = t.errors as Record<string, string>
      setNotice(table[result.code] ?? t.errors.generic)
    })
  }

  if (bookable.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        {booked.length > 0 ? (
          <p className="text-sm">
            {messages.session.booked}: {booked.map((a) => a.firstName).join(', ')}
          </p>
        ) : null}
        {removed.length > 0 ? (
          <p className="text-sm opacity-70">{messages.booking.removedByCoach}</p>
        ) : (
          <>
            <p className="text-sm opacity-70">{t.noEligible}</p>
            <p className="text-xs opacity-60">{t.noEligibleHint}</p>
          </>
        )}
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <p className="text-sm font-medium">{t.pickAthletes}</p>

      {booked.length > 0 ? (
        <p className="text-sm opacity-70">
          {messages.session.booked}: {booked.map((a) => a.firstName).join(', ')}
        </p>
      ) : null}

      <ul className="flex flex-col gap-2">
        {bookable.map((athlete) => (
          <li key={athlete.athleteId}>
            <label className="flex min-h-11 items-center gap-3 text-base">
              <input
                type="checkbox"
                checked={selected.includes(athlete.athleteId)}
                onChange={() => toggle(athlete.athleteId)}
                className="size-5"
              />
              {athlete.firstName} {athlete.lastName}
            </label>
          </li>
        ))}
      </ul>

      {notice ? (
        <div role="alert" className="flex flex-col gap-2 rounded-lg bg-black/5 p-3 dark:bg-white/10">
          <p className="text-sm leading-relaxed">{notice}</p>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="min-h-11 self-start text-sm underline"
          >
            {t.acknowledge}
          </button>
        </div>
      ) : null}

      <button
        type="submit"
        // Never disabled on a cached free-place count: it may be stale, and the
        // server is what decides. Only an empty selection blocks the button.
        disabled={pending || selected.length === 0}
        className="min-h-12 rounded-lg bg-black px-4 text-base font-medium text-white disabled:opacity-60 dark:bg-white dark:text-black"
      >
        {pending
          ? t.booking
          : selected.length > 1
            ? plural(selected.length, t.submit)
            : messages.session.book}
      </button>

      <p className="sr-only" aria-live="polite">
        {freePlaces}
      </p>
    </form>
  )
}
