'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { validateSession, type SessionInput } from '@/lib/domain/session'
import { canonicalWeekdays } from '@/lib/domain/series'

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
  /** §K3b. Written in a second call, because assistants are a set of their own. */
  assistantIds: string[] = [],
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

  // Deliberately after the session exists, and deliberately not fatal: a
  // training without its assistants is a training, and the coach is looking at
  // the screen that shows them. Losing the whole creation instead would be
  // worse.
  if (sessionId && assistantIds.length > 0) {
    await setSessionAssistants(sessionId, assistantIds)
  }

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
  /** §K3b, when the form carries them. Undefined means "leave them alone". */
  assistantIds?: string[],
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

  if (assistantIds) await setSessionAssistants(sessionId, assistantIds)

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

/**
 * Create a series and every occurrence, in one call.
 *
 * The dates are generated on the server, not submitted from the preview: the
 * preview and the generator run the same rule, but only one of them is
 * authoritative. Sending the list would let a stale or edited preview decide
 * what gets created.
 */
export async function createSeries(
  workspaceId: string,
  form: FormData,
): Promise<SessionActionResult & { generatedCount?: number }> {
  // A series has no single date: `create_session_series` derives every
  // occurrence from the pattern and the range below. Requiring one here is
  // what made this form unable to submit at all.
  const validated = validateSession(readForm(form), { requireDate: false })
  if (!validated.ok) return { ok: false, code: 'VALIDATION', fieldErrors: validated.errors }

  const v = validated.value
  // The pattern and the dates to SKIP, never the dates to create: a stale or
  // edited client must not be able to decide which occurrences exist
  // (principle 5). It can decline one, it cannot conjure one.
  const byWeekdays = canonicalWeekdays(form.getAll('byWeekday').map((d) => Number(String(d))))
  const excludedDates = form.getAll('excludedDate').map((d) => String(d))
  const dateFrom = String(form.get('localDateFrom') ?? '')
  const dateTo = String(form.get('localDateTo') ?? '')

  if (byWeekdays.length === 0) {
    return { ok: false, code: 'INVALID_WEEKDAY' }
  }
  if (!dateFrom || !dateTo || dateTo < dateFrom) {
    return { ok: false, code: 'INVALID_DATE_RANGE' }
  }

  const supabase = await createClient()

  const { data, error } = await supabase.rpc('create_session_series', {
    p_workspace_id: workspaceId,
    p_by_weekdays: byWeekdays,
    p_excluded_dates: excludedDates,
    p_local_date_from: dateFrom,
    p_local_date_to: dateTo,
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

  revalidatePath('/trener')
  revalidatePath('/trener/serie')
  return { ok: true, generatedCount: Number(result.data?.generated_count ?? 0) }
}

/**
 * Who assists on one training (coach/SPEC.md §K3b).
 *
 * The whole list, not an add and a remove: the sheet shows a set of tick boxes
 * and `Hotovo` means "this is the list". Sending a difference would make the
 * result depend on what the client believed was there when it opened.
 *
 * No guardian is notified, by design (§4): the training is at the same time,
 * in the same hall, with the same main coach.
 */
export async function setSessionAssistants(
  sessionId: string,
  profileIds: string[],
): Promise<SessionActionResult> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('set_session_assistants', {
    p_training_session_id: sessionId,
    p_profile_ids: profileIds,
  })

  if (error) return { ok: false, code: 'generic' }

  const result = readRpc(data)
  if (!result.ok) return { ok: false, code: result.code ?? 'generic' }

  revalidatePath(`/trener/${sessionId}`)
  revalidatePath('/trener')
  revalidatePath('/treninky')
  revalidatePath('/moje-treninky')

  return { ok: true }
}
