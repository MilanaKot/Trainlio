'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

/**
 * Guardian booking and cancellation.
 *
 * Both call a domain function. Guardians hold no INSERT or UPDATE grant on
 * `bookings`, so capacity, eligibility, the coach-removal rule and the
 * cancellation deadline cannot be reached around.
 */

export type BookingResult =
  | { ok: true; bookedCount?: number | undefined }
  | {
      ok: false
      code: string
      availablePlaces?: number | undefined
      ineligible?: { athleteId: string; reason: string }[] | undefined
    }

type RpcResult = {
  ok: boolean
  code?: string
  details?: Record<string, unknown>
  data?: Record<string, unknown>
}

function readRpc(value: unknown): RpcResult {
  if (typeof value !== 'object' || value === null) return { ok: false, code: 'generic' }
  return value as RpcResult
}

function refresh() {
  revalidatePath('/treninky')
  revalidatePath('/moje-treninky')
}

/**
 * Atomic across the whole selection (D-05).
 *
 * The server refuses the entire request when there are too few places and
 * returns how many remain; it never books a subset, so one confirmation cannot
 * leave one sibling in and another out.
 */
export async function bookAthletes(
  sessionId: string,
  athleteIds: string[],
): Promise<BookingResult> {
  if (athleteIds.length === 0) return { ok: false, code: 'EMPTY_SELECTION' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('book_athletes_as_guardian', {
    p_training_session_id: sessionId,
    p_athlete_ids: athleteIds,
  })

  if (error) return { ok: false, code: 'generic' }

  const result = readRpc(data)
  if (!result.ok) {
    const details = result.details ?? {}
    const athletes = Array.isArray(details.athletes)
      ? (details.athletes as { athlete_id: string; reason: string }[]).map((a) => ({
          athleteId: a.athlete_id,
          reason: a.reason,
        }))
      : undefined

    return {
      ok: false,
      code: result.code ?? 'generic',
      ...(typeof details.available_places === 'number'
        ? { availablePlaces: details.available_places }
        : {}),
      ...(athletes ? { ineligible: athletes } : {}),
    }
  }

  refresh()
  return { ok: true, bookedCount: Number(result.data?.booked_count ?? athleteIds.length) }
}

/** The deadline is evaluated on the server, from the workspace's own setting. */
export async function cancelBooking(bookingId: string): Promise<BookingResult> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('cancel_booking_as_guardian', {
    p_booking_id: bookingId,
  })

  if (error) return { ok: false, code: 'generic' }

  const result = readRpc(data)
  if (!result.ok) return { ok: false, code: result.code ?? 'generic' }

  refresh()
  return { ok: true }
}
