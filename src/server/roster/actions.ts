'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getBookingGuardians, type BookingGuardian } from '@/server/roster/queries'
import { z } from 'zod'
import { sequenceAdditions, type SequencedAdditions } from '@/lib/domain/roster'
import { canEditSession } from '@/lib/domain/coach-rights'
import { COACH_NOTE_LIMIT, PARENT_MESSAGE_LIMIT } from '@/lib/domain/booking-notes'
import { getCoachSession } from '@/server/sessions/queries'
import { getCoachRights } from '@/server/staff/queries'

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

/**
 * Several athletes, one after another (coach/SPEC.md §K7).
 *
 * The sequencing itself is `sequenceAdditions`, which explains why it is not
 * atomic (D-05). This binds it to the domain function.
 */
export async function addAthletesToSession(
  sessionId: string,
  athleteIds: string[],
  confirmOverCapacity = false,
): Promise<SequencedAdditions> {
  return sequenceAdditions(athleteIds, (athleteId) =>
    addAthleteToSession(sessionId, athleteId, confirmOverCapacity),
  )
}

/**
 * The guardians of one booking, fetched when the coach opens that athlete
 * (coach/SPEC.md §K2).
 *
 * On demand rather than with the roster: a training of twenty would otherwise
 * cost twenty extra round trips on every page load, to show a telephone number
 * the coach looks at once. Reading through an action because the query is
 * `server-only` and the sheet is a Client Component.
 */
export async function loadBookingGuardians(bookingId: string): Promise<BookingGuardian[]> {
  return getBookingGuardians(bookingId)
}

/**
 * The staff's note about an athlete (§K13, D-13).
 *
 * Through a domain function, not a table write: the check is "this athlete
 * trains at this club and I am staff here", which no row policy on an empty
 * table can express for an insert (migration 35).
 */
export async function saveAthleteNote(
  workspaceId: string,
  athleteId: string,
  notes: string,
): Promise<{ ok: true } | { ok: false; code: string }> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('set_athlete_internal_note', {
    p_workspace_id: workspaceId,
    p_athlete_id: athleteId,
    p_notes: notes.slice(0, 200),
  })

  if (error) return { ok: false, code: 'generic' }

  const result = data as { ok?: boolean; code?: string } | null
  if (!result?.ok) return { ok: false, code: result?.code ?? 'generic' }

  revalidatePath(`/trener/sportovci/${athleteId}`)
  return { ok: true }
}

/**
 * What a coach records against one booking (handoff v3.3, decisions 34–36):
 * paid, the note for this training, the message to the parent.
 *
 * Each is checked twice. Here, so a coach who can only view the training is
 * refused before a round trip and a malformed value never reaches the
 * database; and in the domain function, which is the one that decides
 * (FORBIDDEN_EDIT, migration 43) — the check here could be skipped by anyone
 * calling the function directly, so it is a courtesy, not the guard.
 */
export type BookingResult = { ok: true } | { ok: false; code: string }

const id = z.uuid()
const paidSchema = z.object({ sessionId: id, bookingId: id, paid: z.boolean() })
const allPaidSchema = z.object({ sessionId: id })
const noteSchema = z.object({
  sessionId: id,
  bookingId: id,
  note: z.string().trim().max(COACH_NOTE_LIMIT),
})
const messageSchema = z.object({
  sessionId: id,
  bookingId: id,
  message: z.string().trim().min(1).max(PARENT_MESSAGE_LIMIT),
})

/** canEdit(session), decision 33. */
async function assertCanEditSession(sessionId: string): Promise<BookingResult> {
  const [session, rights] = await Promise.all([getCoachSession(sessionId), getCoachRights()])
  if (!session) return { ok: false, code: 'SESSION_NOT_FOUND' }
  if (!canEditSession(rights, session)) return { ok: false, code: 'FORBIDDEN_EDIT' }
  return { ok: true }
}

async function record(
  sessionId: string,
  call: () => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<BookingResult> {
  const allowed = await assertCanEditSession(sessionId)
  if (!allowed.ok) return allowed

  const { data, error } = await call()
  if (error) return { ok: false, code: 'generic' }

  const result = readRpc(data)
  if (!result.ok) return { ok: false, code: result.code ?? 'generic' }

  refresh(sessionId)
  return { ok: true }
}

/** K17 `Zaplaceno`, saved on tap. */
export async function setBookingPaid(
  sessionId: string,
  bookingId: string,
  paid: boolean,
): Promise<BookingResult> {
  const input = paidSchema.safeParse({ sessionId, bookingId, paid })
  if (!input.success) return { ok: false, code: 'VALIDATION' }

  const supabase = await createClient()
  return record(sessionId, () =>
    supabase.rpc('set_booking_paid', { p_booking_id: bookingId, p_paid: paid }),
  )
}

/** K2c `Zaplatili všichni`: the unpaid confirmed bookings, in one request. */
export async function markAllPaid(sessionId: string): Promise<BookingResult> {
  const input = allPaidSchema.safeParse({ sessionId })
  if (!input.success) return { ok: false, code: 'VALIDATION' }

  const supabase = await createClient()
  return record(sessionId, () =>
    supabase.rpc('mark_session_paid', { p_training_session_id: sessionId }),
  )
}

/** K17 `Poznámka k tréninku`, saved on blur. Blank clears it. */
export async function setCoachNote(
  sessionId: string,
  bookingId: string,
  note: string,
): Promise<BookingResult> {
  const input = noteSchema.safeParse({ sessionId, bookingId, note })
  if (!input.success) return { ok: false, code: 'NOTE_TOO_LONG' }

  const supabase = await createClient()
  return record(sessionId, () =>
    supabase.rpc('set_booking_coach_note', { p_booking_id: bookingId, p_note: input.data.note }),
  )
}

/** K17 `Odeslat rodiči`: saved on the booking and e-mailed (E09). */
export async function sendParentMessage(
  sessionId: string,
  bookingId: string,
  message: string,
): Promise<BookingResult> {
  const input = messageSchema.safeParse({ sessionId, bookingId, message })
  if (!input.success) {
    return { ok: false, code: message.trim() === '' ? 'MESSAGE_EMPTY' : 'MESSAGE_TOO_LONG' }
  }

  const supabase = await createClient()
  return record(sessionId, () =>
    supabase.rpc('send_parent_message', {
      p_booking_id: bookingId,
      p_message: input.data.message,
    }),
  )
}
