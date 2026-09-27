'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/browser'
import { messages } from '@/lib/i18n'

/**
 * Live occupancy.
 *
 * Subscribes to `training_session_occupancy`, never to `bookings`. That is the
 * whole design in one line: the projection carries a count and nothing else, so
 * a parent watching a session fill up learns how many places are left and
 * nothing about whose children took them (BR-090, S-P2).
 *
 * Subscribing to `bookings` would not work even if it were allowed — row level
 * security filters realtime per subscriber, so a guardian would only ever see
 * their own rows change and the number would appear stuck.
 */
export function OccupancyLive({
  sessionId,
  capacity,
  initialCount,
}: {
  sessionId: string
  capacity: number
  initialCount: number
}) {
  const [count, setCount] = useState(initialCount)
  const [lastFromServer, setLastFromServer] = useState(initialCount)

  // A server re-render can carry a newer count than the last realtime event —
  // after a booking, or on a fresh navigation. Adjusted during render rather
  // than in an effect, which would render the stale value first and then
  // immediately render again.
  //
  // Only a *change* in the prop resets the count, so a server render that is
  // older than the last event leaves the live value alone.
  if (initialCount !== lastFromServer) {
    setLastFromServer(initialCount)
    setCount(initialCount)
  }

  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel(`occupancy:${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'training_session_occupancy',
          filter: `training_session_id=eq.${sessionId}`,
        },
        (payload) => {
          const next = (payload.new as { confirmed_count?: number }).confirmed_count
          if (typeof next === 'number') setCount(next)
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [sessionId])

  const full = count >= capacity

  return (
    <span
      className={`tabular-nums text-sm font-medium ${full ? 'opacity-100' : ''}`}
      aria-label={messages.coach.occupancy
        .replace('{confirmed}', String(count))
        .replace('{capacity}', String(capacity))}
    >
      {count} / {capacity}
    </span>
  )
}
