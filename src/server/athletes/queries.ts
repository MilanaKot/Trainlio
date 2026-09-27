import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { rows } from '@/server/query-result'
import { PHOTO_BUCKET, PHOTO_SIGNED_URL_SECONDS } from '@/lib/domain/photo'
import type { HockeyPosition, StickSide } from '@/lib/enums/hockey'

export type AthleteSportProfile = {
  id: string
  sportCode: string
  clubName: string | null
  teamOrCategory: string | null
  jerseyNumber: string | null
  position: HockeyPosition | null
  stickSide: StickSide | null
}

export type GuardianAthlete = {
  id: string
  firstName: string
  lastName: string
  dateOfBirth: string
  isActive: boolean
  photoPath: string | null
  photoUrl: string | null
  sportProfiles: AthleteSportProfile[]
}

export type JoinableWorkspace = {
  id: string
  name: string
  sportCode: string
  timezone: string
}

type ProfileRow = {
  id: string
  club_name: string | null
  team_or_category: string | null
  jersey_number: string | null
  attributes: unknown
  is_active: boolean
  sports: { code: string } | null
}

function readAttributes(attributes: unknown): {
  position: HockeyPosition | null
  stickSide: StickSide | null
} {
  if (typeof attributes !== 'object' || attributes === null) {
    return { position: null, stickSide: null }
  }
  const record = attributes as Record<string, unknown>
  return {
    position: typeof record.position === 'string' ? (record.position as HockeyPosition) : null,
    stickSide: typeof record.stick_side === 'string' ? (record.stick_side as StickSide) : null,
  }
}

/**
 * Signed URLs are issued here, on the server, for 60 minutes (D-19). The bucket
 * is private, so the client never receives a durable or public address for a
 * child's photograph — AC-092.
 */
async function signPhotos(
  supabase: Awaited<ReturnType<typeof createClient>>,
  paths: string[],
): Promise<Map<string, string>> {
  const signed = new Map<string, string>()
  if (paths.length === 0) return signed

  // Deliberately not raised. A photograph that will not sign costs the parent
  // an avatar; raising would cost them the page, and the names, birth years and
  // hockey profiles on it are the part they came for.
  const { data } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUrls(paths, PHOTO_SIGNED_URL_SECONDS)

  for (const entry of data ?? []) {
    if (entry.signedUrl && entry.path) signed.set(entry.path, entry.signedUrl)
  }
  return signed
}

/**
 * Every athlete the signed-in guardian has active access to.
 *
 * No workspace or guardian filter is written here: the `athletes` row policy
 * already restricts this to athletes the caller guards, so a missing clause
 * cannot widen the result (AC-091).
 */
export async function listGuardianAthletes(): Promise<GuardianAthlete[]> {
  const supabase = await createClient()

  const result = await supabase
    .from('athletes')
    .select(
      `id, first_name, last_name, date_of_birth, is_active, photo_path,
       athlete_sport_profiles ( id, club_name, team_or_category, jersey_number,
                                attributes, is_active, sports ( code ) )`,
    )
    .order('first_name', { ascending: true })

  const data = rows('listGuardianAthletes', result)

  const photoPaths = data.map((a) => a.photo_path).filter((p): p is string => Boolean(p))
  const signed = await signPhotos(supabase, photoPaths)

  return data.map((athlete) => ({
    id: athlete.id,
    firstName: athlete.first_name,
    lastName: athlete.last_name,
    dateOfBirth: athlete.date_of_birth,
    isActive: athlete.is_active,
    photoPath: athlete.photo_path,
    photoUrl: athlete.photo_path ? (signed.get(athlete.photo_path) ?? null) : null,
    sportProfiles: ((athlete.athlete_sport_profiles ?? []) as unknown as ProfileRow[]).map(
      (profile) => {
        const { position, stickSide } = readAttributes(profile.attributes)
        return {
          id: profile.id,
          sportCode: profile.sports?.code ?? '',
          clubName: profile.club_name,
          teamOrCategory: profile.team_or_category,
          jerseyNumber: profile.jersey_number,
          position,
          stickSide,
        }
      },
    ),
  }))
}

export async function getGuardianAthlete(athleteId: string): Promise<GuardianAthlete | null> {
  const athletes = await listGuardianAthletes()
  return athletes.find((a) => a.id === athleteId) ?? null
}

/**
 * Workspaces this user may register an athlete into.
 *
 * Read through a function rather than the table: a parent with no athlete yet
 * can see no workspace at all under the row policy, which is correct for
 * sessions and rosters but leaves the registration form with nothing to submit.
 * See migration 12.
 */
export async function listJoinableWorkspaces(): Promise<JoinableWorkspace[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('joinable_workspaces')

  if (error || !data) return []

  return data.map((w) => ({
    id: w.id,
    name: w.name,
    sportCode: w.sport_code,
    timezone: w.timezone,
  }))
}
