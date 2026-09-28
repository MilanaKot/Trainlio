'use client'

import { useEffect } from 'react'
import { markBookingChangeSeen } from '@/server/bookings/actions'

/**
 * "Opening the booking marks the change as seen" (guardian/SPEC.md §G6).
 *
 * On the client, after mount, rather than in the page's own body. A Server
 * Component runs on prefetch too, so marking it there would silence the badge
 * when a parent's thumb merely passed over the card in the list — the one
 * thing the badge exists to survive.
 *
 * The call is idempotent: the domain function stamps only an unseen change and
 * reports `unchanged` otherwise, so a re-render costs nothing.
 */
export function MarkSeen({ bookingId }: { bookingId: string }) {
  useEffect(() => {
    void markBookingChangeSeen(bookingId)
  }, [bookingId])

  return null
}
