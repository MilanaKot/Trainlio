'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { validateAthlete, type AthleteInput } from '@/lib/domain/athlete'
import { checkPhoto, photoBelongsToAthlete, photoPath, PHOTO_BUCKET } from '@/lib/domain/photo'
import { DEFAULT_TIMEZONE, localDateKey } from '@/lib/time/workspace-time'

/**
 * Athlete management.
 *
 * Creation goes through create_athlete_with_guardian(): row level security
 * grants no INSERT on `athletes`, because an athlete row without its
 * guardian_athlete_access row is invisible to every policy, including its
 * creator's, and cannot be deleted.
 *
 * Editing does not need a function. The `athletes` UPDATE policy already
 * restricts it to guardians with MANAGE access, and there is no capacity,
 * deadline or notification consequence to make atomic — unlike a booking.
 */

export type ActionResult =
  | { ok: true; athleteId?: string | undefined }
  | { ok: false; code: string; fieldErrors?: Record<string, string> | undefined }

/**
 * Drops keys whose value is null or undefined.
 *
 * `exactOptionalPropertyTypes` distinguishes an absent key from one set to
 * undefined, and so does PostgREST: an absent argument takes the function's SQL
 * default, an explicit null is passed as null. Here both mean "not filled in",
 * so the key is omitted and the default applies.
 */
function withoutEmpty<T extends Record<string, string | null | undefined>>(
  values: T,
): { [K in keyof T]?: NonNullable<T[K]> } {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== null && value !== undefined),
  ) as { [K in keyof T]?: NonNullable<T[K]> }
}

function readForm(form: FormData): AthleteInput {
  const text = (key: string) => String(form.get(key) ?? '')
  return {
    firstName: text('firstName'),
    lastName: text('lastName'),
    dateOfBirth: text('dateOfBirth'),
    position: text('position'),
    stickSide: text('stickSide'),
    clubName: text('clubName'),
    teamOrCategory: text('teamOrCategory'),
    jerseyNumber: text('jerseyNumber'),
  }
}

/**
 * "Today" in the workspace timezone, not the server's or the browser's. A child
 * born today in Prague must not be rejected as born in the future because the
 * server happens to be running in UTC and it is 23:30.
 */
function workspaceToday(timezone: string): string {
  return localDateKey(new Date(), timezone)
}

type RpcResult = { ok: boolean; code?: string; data?: Record<string, string | null> }

function readRpc(value: unknown): RpcResult {
  if (typeof value !== 'object' || value === null) return { ok: false, code: 'generic' }
  return value as RpcResult
}

export async function createAthlete(
  workspaceId: string,
  timezone: string,
  form: FormData,
): Promise<ActionResult> {
  const input = readForm(form)
  const validated = validateAthlete(input, workspaceToday(timezone || DEFAULT_TIMEZONE))

  if (!validated.ok) {
    return { ok: false, code: 'VALIDATION', fieldErrors: validated.errors }
  }

  const supabase = await createClient()
  const v = validated.value

  const { data, error } = await supabase.rpc('create_athlete_with_guardian', {
    p_first_name: v.firstName,
    p_last_name: v.lastName,
    p_date_of_birth: v.dateOfBirth,
    p_workspace_id: workspaceId,
    p_sport_code: 'HOCKEY',
    p_attributes: v.attributes,
    ...withoutEmpty({
      p_club_name: v.clubName,
      p_team_or_category: v.teamOrCategory,
      p_jersey_number: v.jerseyNumber,
    }),
  })

  if (error) return { ok: false, code: 'generic' }

  const result = readRpc(data)
  if (!result.ok) return { ok: false, code: result.code ?? 'generic' }

  revalidatePath('/moji-sportovci')
  return { ok: true, athleteId: result.data?.athlete_id ?? undefined }
}

export async function updateAthlete(
  athleteId: string,
  workspaceId: string,
  timezone: string,
  form: FormData,
): Promise<ActionResult> {
  const input = readForm(form)
  const validated = validateAthlete(input, workspaceToday(timezone || DEFAULT_TIMEZONE))

  if (!validated.ok) {
    return { ok: false, code: 'VALIDATION', fieldErrors: validated.errors }
  }

  const supabase = await createClient()
  const v = validated.value

  // AC-102: the core record is shared across sport profiles, so it is written
  // once here and not duplicated into each one.
  const { error: coreError } = await supabase
    .from('athletes')
    .update({
      first_name: v.firstName,
      last_name: v.lastName,
      date_of_birth: v.dateOfBirth,
    })
    .eq('id', athleteId)

  if (coreError) return { ok: false, code: 'NOT_AUTHORIZED_FOR_ATHLETE' }

  // AC-101: writes exactly the hockey row. A swimming profile on the same
  // athlete is untouched.
  const { data, error } = await supabase.rpc('upsert_athlete_sport_profile', {
    p_athlete_id: athleteId,
    p_sport_code: 'HOCKEY',
    p_attributes: v.attributes,
    p_workspace_id: workspaceId,
    ...withoutEmpty({
      p_club_name: v.clubName,
      p_team_or_category: v.teamOrCategory,
      p_jersey_number: v.jerseyNumber,
    }),
  })

  if (error) return { ok: false, code: 'generic' }

  const result = readRpc(data)
  if (!result.ok) return { ok: false, code: result.code ?? 'generic' }

  revalidatePath('/moji-sportovci')
  revalidatePath(`/moji-sportovci/${athleteId}`)
  return { ok: true, athleteId }
}

/**
 * D-09. Blocks new bookings and nothing else: existing bookings, sport profiles
 * and workspace memberships are all left exactly as they are, and the guardian
 * can still cancel a booking the athlete already holds.
 */
export async function setAthleteActive(
  athleteId: string,
  isActive: boolean,
): Promise<ActionResult> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('athletes')
    .update({ is_active: isActive })
    .eq('id', athleteId)

  if (error) return { ok: false, code: 'NOT_AUTHORIZED_FOR_ATHLETE' }

  revalidatePath('/moji-sportovci')
  revalidatePath(`/moji-sportovci/${athleteId}`)
  return { ok: true, athleteId }
}

export async function uploadAthletePhoto(
  athleteId: string,
  form: FormData,
): Promise<ActionResult> {
  const file = form.get('photo')
  if (!(file instanceof File)) return { ok: false, code: 'PHOTO_EMPTY' }

  const rejection = checkPhoto(file)
  if (rejection) return { ok: false, code: rejection }

  const supabase = await createClient()

  // Uploaded with the caller's own client, so the storage policies apply: they
  // derive the athlete id from the path and check guardian access against it.
  // The service-role client would upload anything anywhere.
  const path = photoPath(athleteId, file.type, randomUUID())

  const { error: uploadError } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false })

  if (uploadError) return { ok: false, code: 'NOT_AUTHORIZED_FOR_ATHLETE' }

  const { data: previous } = await supabase
    .from('athletes')
    .select('photo_path')
    .eq('id', athleteId)
    .maybeSingle()

  const { error: updateError } = await supabase
    .from('athletes')
    .update({ photo_path: path })
    .eq('id', athleteId)

  if (updateError) {
    // The row did not take the new path, so the object is unreferenced. Remove
    // it rather than leave a photograph of a child in storage with nothing
    // pointing at it.
    await supabase.storage.from(PHOTO_BUCKET).remove([path])
    return { ok: false, code: 'NOT_AUTHORIZED_FOR_ATHLETE' }
  }

  if (previous?.photo_path && previous.photo_path !== path) {
    await supabase.storage.from(PHOTO_BUCKET).remove([previous.photo_path])
  }

  revalidatePath('/moji-sportovci')
  revalidatePath(`/moji-sportovci/${athleteId}`)
  return { ok: true, athleteId }
}

export async function removeAthletePhoto(athleteId: string): Promise<ActionResult> {
  const supabase = await createClient()

  const { data: athlete } = await supabase
    .from('athletes')
    .select('photo_path')
    .eq('id', athleteId)
    .maybeSingle()

  const { error } = await supabase
    .from('athletes')
    .update({ photo_path: null })
    .eq('id', athleteId)

  if (error) return { ok: false, code: 'NOT_AUTHORIZED_FOR_ATHLETE' }

  // Guard the path before deleting: the column is guardian-writable, so a
  // crafted value could otherwise point the delete at another athlete's object.
  if (athlete?.photo_path && photoBelongsToAthlete(athlete.photo_path, athleteId)) {
    await supabase.storage.from(PHOTO_BUCKET).remove([athlete.photo_path])
  }

  revalidatePath('/moji-sportovci')
  revalidatePath(`/moji-sportovci/${athleteId}`)
  return { ok: true, athleteId }
}
