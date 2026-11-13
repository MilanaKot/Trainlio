'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { ABSENCE_REASON_LIMIT } from '@/lib/domain/guardian-response'

/**
 * Guardian booking, its answer (`Půjde`) and its withdrawal (`Nepůjde`).
 *
 * Each calls a domain function. Guardians hold no INSERT or UPDATE grant on
 * `bookings`, so capacity, eligibility, the coach-removal rule and the
 * start of the training cannot be reached around.
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

const id = z.uuid()
const reasonSchema = z.string().trim().min(1).max(ABSENCE_REASON_LIMIT)

/** G6f `Půjde`: saved at once, no dialog, no e-mail (decision 52). */
export async function confirmGoing(bookingId: string): Promise<BookingResult> {
  if (!id.safeParse(bookingId).success) return { ok: false, code: 'VALIDATION' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('confirm_attendance_as_guardian', {
    p_booking_id: bookingId,
  })

  if (error) return { ok: false, code: 'generic' }

  const result = readRpc(data)
  if (!result.ok) return { ok: false, code: result.code ?? 'generic' }

  refresh()
  return { ok: true }
}

/**
 * G6g `Nepůjde`: the only way a guardian withdraws, always with a reason
 * (decision 52). Until the training starts; past the workspace's deadline the
 * server stores it as late, which the coach reads as `Pozdě` (decision 53). The
 * place is freed and E10 queued in the same transaction.
 */
export async function cancelWithReason(bookingId: string, reason: string): Promise<BookingResult> {
  const parsed = reasonSchema.safeParse(reason)
  if (!id.safeParse(bookingId).success || !parsed.success) return { ok: false, code: 'VALIDATION' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('cancel_booking_as_guardian', {
    p_booking_id: bookingId,
    p_reason: parsed.data,
  })

  if (error) return { ok: false, code: 'generic' }

  const result = readRpc(data)
  if (!result.ok) return { ok: false, code: result.code ?? 'generic' }

  refresh()
  return { ok: true }
}

/**
 * The parent opened a booking whose training had moved.
 *
 * Through an RPC, because guardians hold no UPDATE grant on `bookings` at all
 * (principle 10) — the same grant that stops a client cancelling by writing a
 * status also stops it writing this. The function reaches only the caller's own
 * bookings and stamps nothing when there is nothing unseen, so opening a
 * booking twice writes once (migration 24).
 *
 * Failure is deliberately silent. This is a side effect of reading a page; a
 * parent who came to check what time the training moved to should not be shown
 * an error about a badge.
 */
export async function markBookingChangeSeen(bookingId: string): Promise<void> {
  const supabase = await createClient()
  await supabase.rpc('mark_booking_change_seen', { p_booking_id: bookingId })
}
