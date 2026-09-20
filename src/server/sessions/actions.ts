'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { validateSession, type SessionInput } from '@/lib/domain/session'

/**
 * Coach session management.
 *
 * Every one of these calls a domain function. Coaches hold no UPDATE policy on
 * `training_sessions`, so this is the only path — which is what guarantees the
 * significant-change marker, the notification outbox row and the audit entry
 * are written in the same transaction as the change itself.
 */

export type SessionActionResult =
  | { ok: true; sessionId?: string | undefined }
  | {
      ok: false
      code: string
      fieldErrors?: Record<string, string> | undefined
      details?: Record<string, number> | undefined
    }

function readForm(form: FormData): SessionInput {
  const text = (key: string) => String(form.get(key) ?? '')
  return {
    localDate: text('localDate'),
    localStartTime: text('localStartTime'),
    localEndTime: text('localEndTime'),
    facilityId: text('facilityId'),
    capacity: text('capacity'),
    eligibilityMode: text('eligibilityMode'),
    birthYearFrom: text('birthYearFrom'),
    birthYearTo: text('birthYearTo'),
    changingRoom: text('changingRoom'),
    publicNotes: text('publicNotes'),
    internalNotes: text('internalNotes'),
    mainCoachProfileId: text('mainCoachProfileId'),
  }
}

type RpcResult = {
  ok: boolean
  code?: string
  details?: Record<string, number>
  data?: Record<string, unknown>
}

function readRpc(value: unknown): RpcResult {
  if (typeof value !== 'object' || value === null) return { ok: false, code: 'generic' }
  return value as RpcResult
}

function withoutEmpty<T extends Record<string, string | number | null | undefined>>(
  values: T,
): { [K in keyof T]?: NonNullable<T[K]> } {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== null && value !== undefined),
  ) as { [K in keyof T]?: NonNullable<T[K]> }
}

function refresh(sessionId?: string) {
  revalidatePath('/trener')
  if (sessionId) revalidatePath(`/trener/${sessionId}`)
}

export async function createSession(
  workspaceId: string,
  form: FormData,
): Promise<SessionActionResult> {
  const validated = validateSession(readForm(form))
  if (!validated.ok) return { ok: false, code: 'VALIDATION', fieldErrors: validated.errors }

  const v = validated.value
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('create_training_session', {
    p_workspace_id: workspaceId,
    // Local wall clock. The server converts using the workspace timezone, so a
    // coach who types 09:00 gets 09:00 in Příbram whatever the device thinks.
    p_local_date: v.localDate,
    p_local_start_time: v.localStartTime,
    p_local_end_time: v.localEndTime,
    p_facility_id: v.facilityId,
    p_capacity: v.capacity,
    p_eligibility_mode: v.eligibilityMode,
    ...withoutEmpty({
      p_birth_year_from: v.birthYearFrom,
      p_birth_year_to: v.birthYearTo,
      p_changing_room: v.changingRoom,
      p_public_notes: v.publicNotes,
      p_internal_notes: v.internalNotes,
      p_main_coach_profile_id: v.mainCoachProfileId,
    }),
  })

  if (error) return { ok: false, code: 'generic' }

  const result = readRpc(data)
  if (!result.ok) return { ok: false, code: result.code ?? 'generic' }

  const sessionId = result.data?.training_session_id as string | undefined
  refresh(sessionId)
  return { ok: true, sessionId }
}

/**
 * Two confirmation flags, both refused by default.
 *
 * They are not dialog bookkeeping: the server rejects the change without them
 * and returns the count the warning must show. The UI cannot skip either one by
 * not rendering it.
 */
export async function updateSession(
  sessionId: string,
  form: FormData,
  confirm: { overCapacity?: boolean; ineligibleBookings?: boolean } = {},
): Promise<SessionActionResult> {
  const validated = validateSession(readForm(form))
  if (!validated.ok) return { ok: false, code: 'VALIDATION', fieldErrors: validated.errors }

  const v = validated.value
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('update_training_session', {
    p_training_session_id: sessionId,
    p_local_date: v.localDate,
    p_local_start_time: v.localStartTime,
    p_local_end_time: v.localEndTime,
    p_facility_id: v.facilityId,
    p_capacity: v.capacity,
    p_eligibility_mode: v.eligibilityMode,
    p_confirm_over_capacity: confirm.overCapacity ?? false,
    p_confirm_ineligible_bookings: confirm.ineligibleBookings ?? false,
    ...withoutEmpty({
      p_birth_year_from: v.birthYearFrom,
      p_birth_year_to: v.birthYearTo,
      p_changing_room: v.changingRoom,
      p_public_notes: v.publicNotes,
      p_internal_notes: v.internalNotes,
      p_main_coach_profile_id: v.mainCoachProfileId,
    }),
  })

  if (error) return { ok: false, code: 'generic' }

  const result = readRpc(data)
  if (!result.ok) {
    return {
      ok: false,
      code: result.code ?? 'generic',
      ...(result.details ? { details: result.details } : {}),
    }
  }

  refresh(sessionId)
  return { ok: true, sessionId }
}

export async function setBookingState(
  sessionId: string,
  open: boolean,
): Promise<SessionActionResult> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('set_session_booking_state', {
    p_training_session_id: sessionId,
    p_open: open,
  })

  if (error) return { ok: false, code: 'generic' }
  const result = readRpc(data)
  if (!result.ok) return { ok: false, code: result.code ?? 'generic' }

  refresh(sessionId)
  return { ok: true, sessionId }
}

/** D-07: terminal. The UI says so before confirming. */
export async function cancelSession(
  sessionId: string,
  reason: string,
): Promise<SessionActionResult> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('cancel_training_session', {
    p_training_session_id: sessionId,
    ...withoutEmpty({ p_reason: reason.trim() || null }),
  })

  if (error) return { ok: false, code: 'generic' }
  const result = readRpc(data)
  if (!result.ok) return { ok: false, code: result.code ?? 'generic' }

  refresh(sessionId)
  return { ok: true, sessionId }
}

export async function duplicateSession(
  sessionId: string,
  localDate: string,
): Promise<SessionActionResult> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('duplicate_training_session', {
    p_training_session_id: sessionId,
    p_local_date: localDate,
  })

  if (error) return { ok: false, code: 'generic' }
  const result = readRpc(data)
  if (!result.ok) return { ok: false, code: result.code ?? 'generic' }

  const newId = result.data?.training_session_id as string | undefined
  refresh(newId)
  return { ok: true, sessionId: newId }
}
