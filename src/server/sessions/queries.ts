import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { SessionStatus, EligibilityMode } from '@/types/database'

export type CoachWorkspace = {
  id: string
  name: string
  timezone: string
  facilities: { id: string; code: string; name: string; locationName: string }[]
  coaches: { id: string; displayName: string | null }[]
}

export type CoachSession = {
  id: string
  startAt: string
  endAt: string
  status: SessionStatus
  capacity: number
  confirmedCount: number
  facilityCode: string
  locationName: string
  changingRoom: string | null
  eligibilityMode: EligibilityMode
  birthYearFrom: number | null
  birthYearTo: number | null
  publicNotes: string | null
  internalNotes: string | null
  mainCoachId: string
  mainCoachName: string | null
  significantChangedAt: string | null
}

/**
 * The workspace this user coaches, with everything the session forms need.
 *
 * Returns null for anyone who is not active staff: `is_workspace_coach` is the
 * same predicate the row policies and every session RPC use, so a guardian
 * cannot reach a coach screen by URL.
 */
export async function getCoachWorkspace(): Promise<CoachWorkspace | null> {
  const supabase = await createClient()

  const { data: memberships } = await supabase
    .from('workspace_members')
    .select('workspace_id, workspaces ( id, name, timezone )')
    .eq('is_active', true)

  const workspace = memberships?.[0]?.workspaces
  if (!workspace) return null

  const [{ data: facilities }, { data: staff }] = await Promise.all([
    supabase
      .from('facilities')
      .select('id, code, name, locations!inner ( name, workspace_id )')
      .eq('is_active', true)
      .eq('locations.workspace_id', workspace.id)
      .order('code'),
    supabase
      .from('workspace_members')
      .select('profile_id, app_profiles ( id, display_name )')
      .eq('workspace_id', workspace.id)
      .eq('is_active', true),
  ])

  const coaches = new Map<string, string | null>()
  for (const member of staff ?? []) {
    const profile = member.app_profiles
    if (profile) coaches.set(profile.id, profile.display_name)
  }

  return {
    id: workspace.id,
    name: workspace.name,
    timezone: workspace.timezone,
    facilities: (facilities ?? []).map((f) => ({
      id: f.id,
      code: f.code,
      name: f.name,
      locationName: f.locations?.name ?? '',
    })),
    coaches: [...coaches].map(([id, displayName]) => ({ id, displayName })),
  }
}

const SESSION_COLUMNS = `
  id, start_at, end_at, status, capacity, changing_room, public_notes,
  eligibility_mode, birth_year_from, birth_year_to, significant_changed_at,
  main_coach_profile_id,
  facilities ( code ),
  locations ( name ),
  app_profiles ( display_name ),
  training_session_occupancy ( confirmed_count ),
  training_session_internal_notes ( notes )
`

type Row = {
  id: string
  start_at: string
  end_at: string
  status: SessionStatus
  capacity: number
  changing_room: string | null
  public_notes: string | null
  eligibility_mode: EligibilityMode
  birth_year_from: number | null
  birth_year_to: number | null
  significant_changed_at: string | null
  main_coach_profile_id: string
  facilities: { code: string } | null
  locations: { name: string } | null
  app_profiles: { display_name: string | null } | null
  training_session_occupancy: { confirmed_count: number } | null
  training_session_internal_notes: { notes: string | null } | null
}

function toSession(row: Row): CoachSession {
  return {
    id: row.id,
    startAt: row.start_at,
    endAt: row.end_at,
    status: row.status,
    capacity: row.capacity,
    // The count comes from the projection, never from counting booking rows.
    confirmedCount: row.training_session_occupancy?.confirmed_count ?? 0,
    facilityCode: row.facilities?.code ?? '',
    locationName: row.locations?.name ?? '',
    changingRoom: row.changing_room,
    eligibilityMode: row.eligibility_mode,
    birthYearFrom: row.birth_year_from,
    birthYearTo: row.birth_year_to,
    publicNotes: row.public_notes,
    // Staff-only, and only reachable because this query runs as a coach: the
    // table has its own policy, so a guardian's identical query returns no row.
    internalNotes: row.training_session_internal_notes?.notes ?? null,
    mainCoachId: row.main_coach_profile_id,
    mainCoachName: row.app_profiles?.display_name ?? null,
    significantChangedAt: row.significant_changed_at,
  }
}

/** Upcoming first, then past — a list by date, not a calendar (UI_SPEC). */
export async function listCoachSessions(): Promise<{
  upcoming: CoachSession[]
  past: CoachSession[]
}> {
  const supabase = await createClient()
  const now = new Date().toISOString()

  const [{ data: upcoming }, { data: past }] = await Promise.all([
    supabase.from('training_sessions').select(SESSION_COLUMNS).gte('end_at', now).order('start_at'),
    supabase
      .from('training_sessions')
      .select(SESSION_COLUMNS)
      .lt('end_at', now)
      .order('start_at', { ascending: false })
      .limit(50),
  ])

  return {
    upcoming: ((upcoming ?? []) as unknown as Row[]).map(toSession),
    past: ((past ?? []) as unknown as Row[]).map(toSession),
  }
}

export async function getCoachSession(sessionId: string): Promise<CoachSession | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('training_sessions')
    .select(SESSION_COLUMNS)
    .eq('id', sessionId)
    .maybeSingle()

  return data ? toSession(data as unknown as Row) : null
}
