'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

/**
 * Coach roster operations.
 *
 * Coaches hold no INSERT or UPDATE grant on `bookings` either. The capacity
 * override is a server-side gate: without the explicit confirmation the domain
 * function refuses the addition and returns the numbers the warning has to
 * show, so the warning cannot be skipped by a client that chooses not to render
 * it (BR-033, AC-050).
 */

export type RosterResult =
  | { ok: true; capacityOverride?: boolean | undefined }
  | {
      ok: false
      code: string
      capacity?: number | undefined
      confirmedCount?: number | undefined
      reason?: string | undefined
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

function refresh(sessionId: string) {
  revalidatePath(`/trener/${sessionId}`)
  revalidatePath('/trener')
  // The guardian views read the same occupancy projection.
  revalidatePath('/treninky')
  revalidatePath('/moje-treninky')
}

/**
 * One athlete per call (approved under D-05): a coach adding three athletes to
 * a full session is a deliberate, per-athlete decision, not an atomic family
 * booking.
 */
export async function addAthleteToSession(
  sessionId: string,
  athleteId: string,
  confirmOverCapacity = false,
): Promise<RosterResult> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('book_athlete_as_coach', {
    p_training_session_id: sessionId,
    p_athlete_id: athleteId,
    p_confirm_over_capacity: confirmOverCapacity,
  })

  if (error) return { ok: false, code: 'generic' }

  const result = readRpc(data)
  if (!result.ok) {
    const details = result.details ?? {}
    return {
      ok: false,
      code: result.code ?? 'generic',
      ...(typeof details.capacity === 'number' ? { capacity: details.capacity } : {}),
      ...(typeof details.confirmed_count === 'number'
        ? { confirmedCount: details.confirmed_count }
        : {}),
      ...(typeof details.reason === 'string' ? { reason: details.reason } : {}),
    }
  }

  refresh(sessionId)
  return { ok: true, capacityOverride: result.data?.capacity_override === true }
}

/**
 * Removal, at any time (BR-042, AC-042). The guardian deadline does not apply.
 *
 * This is what makes the athlete un-bookable by their guardian for this session
 * (D-06); only a coach can put them back.
 */
export async function removeAthleteFromSession(
  sessionId: string,
  bookingId: string,
  reason?: string,
): Promise<RosterResult> {
  const supabase = await createClient()
  const trimmed = reason?.trim()
  const { data, error } = await supabase.rpc('cancel_booking_as_coach', {
    p_booking_id: bookingId,
    ...(trimmed ? { p_reason: trimmed } : {}),
  })

  if (error) return { ok: false, code: 'generic' }

  const result = readRpc(data)
  if (!result.ok) return { ok: false, code: result.code ?? 'generic' }

  refresh(sessionId)
  return { ok: true }
}
