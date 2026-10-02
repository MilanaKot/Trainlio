import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { maybeRow, rows } from '@/server/query-result'
import { toOrganization } from '@/server/organization/queries'
import type { Organization } from '@/lib/domain/org'
import type { SessionStatus, EligibilityMode, CoachSessionRole } from '@/types/database'

export type CoachWorkspace = {
  id: string
  name: string
  /** `sports.code`, so the header names the sport from data (§K1). */
  sportCode: string
  /** The club's public face: its name, its mark and how the mark is drawn. */
  organization: Organization
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
  /** `Malá hala`, so the detail screen can spell the code out (§K2). */
  facilityName: string
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
  /**
   * §K16: a training the coach has touched since it was created. For one made
   * by a series that means it no longer matches the pattern — which is the
   * whole point of the screen, since a series is provenance and not a template
   * anything follows.
   */
  editedSinceCreated: boolean
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

  const memberships = rows(
    'getCoachWorkspace memberships',
    await supabase
      .from('workspace_members')
      .select(
        'workspace_id, workspaces ( id, name, short_name, timezone, logo_path, logo_background, logo_updated_at, sports ( code ) )',
      )
      .eq('is_active', true),
  )

  const workspace = memberships[0]?.workspaces
  if (!workspace) return null

  const [facilitiesResult, staffResult] = await Promise.all([
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

  const facilities = rows('getCoachWorkspace facilities', facilitiesResult)
  const staff = rows('getCoachWorkspace staff', staffResult)

  const coaches = new Map<string, string | null>()
  for (const member of staff) {
    const profile = member.app_profiles
    if (profile) coaches.set(profile.id, profile.display_name)
  }

  return {
    id: workspace.id,
    name: workspace.name,
    sportCode: workspace.sports?.code ?? '',
    organization: toOrganization(workspace),
    timezone: workspace.timezone,
    facilities: facilities.map((f) => ({
      id: f.id,
      code: f.code,
      name: f.name,
      locationName: f.locations?.name ?? '',
    })),
    coaches: [...coaches].map(([id, displayName]) => ({ id, displayName })),
  }
}

/**
 * Coach-facing session columns.
 *
 * The main coach is embedded through a *named* relationship. A bare
 * `app_profiles ( display_name )` is ambiguous and PostgREST refuses it:
 * training_sessions holds three foreign keys into app_profiles (created_by,
 * cancelled_by, and the main-coach mirror). The refusal is a query error, and
 * because a failed query returns no rows it renders as "no sessions at all" —
 * which is how it went unnoticed until an end-to-end flow booked a real
 * session and found the list empty.
 */
const SESSION_COLUMNS = `
  id, start_at, end_at, status, capacity, changing_room, public_notes,
  eligibility_mode, birth_year_from, birth_year_to, significant_changed_at,
  main_coach_profile_id, created_at, updated_at,
  facilities ( code, name ),
  locations ( name ),
  app_profiles!training_sessions_main_coach_profile_id_fkey ( display_name ),
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
  created_at: string
  updated_at: string
  facilities: { code: string; name: string } | null
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
    facilityName: row.facilities?.name ?? '',
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
    // Both are set in the same statement when the row is written, so an equal
    // pair means nothing has touched it since.
    editedSinceCreated: row.updated_at > row.created_at,
  }
}

/** Upcoming first, then past — a list by date, not a calendar (UI_SPEC). */
export async function listCoachSessions(): Promise<{
  upcoming: CoachSession[]
  past: CoachSession[]
}> {
  const supabase = await createClient()
  const now = new Date().toISOString()

  const [upcoming, past] = await Promise.all([
    supabase.from('training_sessions').select(SESSION_COLUMNS).gte('end_at', now).order('start_at'),
    supabase
      .from('training_sessions')
      .select(SESSION_COLUMNS)
      .lt('end_at', now)
      .order('start_at', { ascending: false })
      .limit(50),
  ])

  return {
    upcoming: (rows('listCoachSessions upcoming', upcoming) as unknown as Row[]).map(toSession),
    past: (rows('listCoachSessions past', past) as unknown as Row[]).map(toSession),
  }
}

export async function getCoachSession(sessionId: string): Promise<CoachSession | null> {
  const supabase = await createClient()
  const result = await supabase
    .from('training_sessions')
    .select(SESSION_COLUMNS)
    .eq('id', sessionId)
    .maybeSingle()

  const row = maybeRow('getCoachSession', result)
  return row ? toSession(row as unknown as Row) : null
}

export type CoachSeries = {
  id: string
  byWeekdays: number[]
  /** Pattern dates the coach unchecked before creating. */
  excludedDates: string[]
  localDateFrom: string
  localDateTo: string
  localStartTime: string
  localEndTime: string
  generatedCount: number
  generatedAt: string | null
  generatedInTimezone: string
  facilityCode: string
  facilityName: string
  changingRoom: string | null
  eligibilityMode: EligibilityMode
  birthYearFrom: number | null
  birthYearTo: number | null
  capacity: number
  /** How many of the generated occurrences still exist and are not cancelled. */
  activeCount: number
  cancelledCount: number
  /** Of those, how many are still to come — `zbývá {n}` on the card (§K15). */
  remainingCount: number
}

type SeriesRow = {
  id: string
  by_weekdays: number[]
  excluded_dates: string[]
  local_date_from: string
  local_date_to: string
  local_start_time: string
  local_end_time: string
  generated_count: number
  generated_at: string | null
  generated_in_timezone: string
  capacity: number
  changing_room: string | null
  eligibility_mode: EligibilityMode
  birth_year_from: number | null
  birth_year_to: number | null
  facilities: { code: string; name: string } | null
  training_sessions: { status: string; start_at: string }[] | null
}

/** Series in the coach's workspace, newest first. */
export async function listCoachSeries(): Promise<CoachSeries[]> {
  const supabase = await createClient()

  const result = await supabase
    .from('session_series')
    .select(
      `id, by_weekdays, excluded_dates, local_date_from, local_date_to, local_start_time, local_end_time,
       generated_count, generated_at, generated_in_timezone, capacity, changing_room,
       eligibility_mode, birth_year_from, birth_year_to,
       facilities ( code, name ),
       training_sessions ( status, start_at )`,
    )
    .order('created_at', { ascending: false })

  const now = new Date().toISOString()

  return (rows('listCoachSeries', result) as unknown as SeriesRow[]).map((row) => {
    const occurrences = row.training_sessions ?? []
    return {
      id: row.id,
      byWeekdays: row.by_weekdays ?? [],
      excludedDates: row.excluded_dates ?? [],
      localDateFrom: row.local_date_from,
      localDateTo: row.local_date_to,
      // `time` comes back as HH:MM:SS; the form and the list want HH:MM.
      localStartTime: row.local_start_time.slice(0, 5),
      localEndTime: row.local_end_time.slice(0, 5),
      generatedCount: row.generated_count,
      generatedAt: row.generated_at,
      generatedInTimezone: row.generated_in_timezone,
      facilityCode: row.facilities?.code ?? '',
      facilityName: row.facilities?.name ?? '',
      changingRoom: row.changing_room,
      eligibilityMode: row.eligibility_mode,
      birthYearFrom: row.birth_year_from,
      birthYearTo: row.birth_year_to,
      capacity: row.capacity,
      // Counted from the occurrences, not from the series row: the series is
      // provenance and never follows what happens to them afterwards.
      activeCount: occurrences.filter((s) => s.status !== 'CANCELLED').length,
      cancelledCount: occurrences.filter((s) => s.status === 'CANCELLED').length,
      // §K15 splits the list by whether anything is left, so this counts the
      // occurrences rather than reading the pattern's end date: a series whose
      // last three trainings were cancelled is over, whatever the range says.
      remainingCount: occurrences.filter((s) => s.status !== 'CANCELLED' && s.start_at > now)
        .length,
    }
  })
}

/**
 * The trainings one series produced (§K16).
 *
 * By `series_id` rather than by re-deriving the pattern: the occurrences are
 * independent from the moment they are created, and a coach who moved one of
 * them must still find it here.
 */
export async function listSeriesSessions(seriesId: string): Promise<CoachSession[]> {
  const supabase = await createClient()

  const result = await supabase
    .from('training_sessions')
    .select(SESSION_COLUMNS)
    .eq('series_id', seriesId)
    .order('start_at')

  return (rows('listSeriesSessions', result) as unknown as Row[]).map(toSession)
}

export async function getCoachSeries(seriesId: string): Promise<CoachSeries | null> {
  const all = await listCoachSeries()
  return all.find((series) => series.id === seriesId) ?? null
}

export type SessionCoach = {
  profileId: string
  displayName: string | null
  role: CoachSessionRole
}

/**
 * Everyone running one training: the main coach and the assistants
 * (coach/SPEC.md §K2, guardian/SPEC.md §G6).
 *
 * A function rather than a query on both sides, so the coach's detail screen
 * and the parent's read the same order — main coach first, then assistants by
 * name — instead of each deciding for itself. The database also answers the
 * harder half: a guardian may read this for a published session and not for a
 * draft, and the predicate for that lives with the data.
 */
export async function getSessionCoaches(sessionId: string): Promise<SessionCoach[]> {
  const supabase = await createClient()

  const coaches = rows(
    'getSessionCoaches',
    await supabase.rpc('session_coaches', { p_training_session_id: sessionId }),
  )

  return coaches.map((coach) => ({
    profileId: coach.profile_id,
    displayName: coach.display_name,
    role: coach.role,
  }))
}
