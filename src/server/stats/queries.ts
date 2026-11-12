import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { Period } from '@/lib/period'

export type StatsAthlete = {
  athleteId: string
  firstName: string
  lastName: string
  birthYear: number
}

export type Statistics = {
  sessions: number
  sessionsAsMain: number
  booked: number
  capacity: number
  present: number
  marked: number
  paid: number
  bookings: number
  /** `Nezaplaceno`, most unpaid first. */
  unpaid: (StatsAthlete & { count: number })[]
  /** Everyone with three trainings or more, lowest attendance first. */
  attendance: (StatsAthlete & { present: number; marked: number; bookings: number })[]
  /** `Trenéři`: administrators only, otherwise null. */
  coaches:
    | {
        profileId: string
        name: string | null
        sessions: number
        present: number
        marked: number
      }[]
    | null
  /** K20b chart. */
  buckets: { key: string; present: number; marked: number }[] | null
  /** K20b list: the trainings this coach led. */
  led:
    | {
        id: string
        startAt: string
        endAt: string
        facilityCode: string | null
        capacity: number
        booked: number
        present: number
      }[]
    | null
  isAdmin: boolean
}

export type StatsResult = { ok: true; data: Statistics } | { ok: false; code: string }

type Raw = {
  ok?: boolean
  code?: string
  data?: {
    sessions: number
    sessions_as_main: number
    booked: number
    capacity: number
    present: number
    marked: number
    paid: number
    bookings: number
    unpaid: {
      athlete_id: string
      first_name: string
      last_name: string
      birth_year: number
      count: number
    }[]
    attendance: {
      athlete_id: string
      first_name: string
      last_name: string
      birth_year: number
      present: number
      marked: number
      bookings: number
    }[]
    coaches:
      | {
          profile_id: string
          name: string | null
          sessions: number
          present: number
          marked: number
        }[]
      | null
    buckets: { key: string; present: number; marked: number }[] | null
    led:
      | {
          id: string
          start_at: string
          end_at: string
          facility_code: string | null
          capacity: number
          booked: number
          present: number
        }[]
      | null
    is_admin: boolean
  }
}

const athlete = (row: {
  athlete_id: string
  first_name: string
  last_name: string
  birth_year: number
}) => ({
  athleteId: row.athlete_id,
  firstName: row.first_name,
  lastName: row.last_name,
  birthYear: row.birth_year,
})

/**
 * K20 and K20b (handoff v3.5): one call to `workspace_statistics`, which
 * counts in Postgres and refuses what the caller may not read — another
 * coach's K20b for anybody but an administrator (coach test 28).
 */
export async function getStatistics(
  workspaceId: string,
  period: Period,
  filters: {
    birthYear?: number | null
    coachId?: string | null
    mainOnly?: boolean
    bucket?: 'week' | 'month'
    /** K20b: one coach's own page, which only they and administrators may open. */
    personal?: boolean
  } = {},
): Promise<StatsResult> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('workspace_statistics', {
    p_workspace_id: workspaceId,
    p_from: period.start.toISOString(),
    p_to: period.end.toISOString(),
    ...(filters.birthYear ? { p_birth_year: filters.birthYear } : {}),
    ...(filters.coachId ? { p_coach_id: filters.coachId } : {}),
    ...(filters.mainOnly ? { p_main_only: true } : {}),
    ...(filters.bucket ? { p_bucket: filters.bucket } : {}),
    ...(filters.personal ? { p_personal: true } : {}),
  })
  if (error) return { ok: false, code: 'generic' }

  const raw = data as Raw
  if (!raw.ok || !raw.data) return { ok: false, code: raw.code ?? 'generic' }
  const d = raw.data

  return {
    ok: true,
    data: {
      sessions: d.sessions,
      sessionsAsMain: d.sessions_as_main,
      booked: d.booked,
      capacity: d.capacity,
      present: d.present,
      marked: d.marked,
      paid: d.paid,
      bookings: d.bookings,
      unpaid: d.unpaid.map((row) => ({ ...athlete(row), count: row.count })),
      attendance: d.attendance.map((row) => ({
        ...athlete(row),
        present: row.present,
        marked: row.marked,
        bookings: row.bookings,
      })),
      coaches:
        d.coaches?.map((row) => ({
          profileId: row.profile_id,
          name: row.name,
          sessions: row.sessions,
          present: row.present,
          marked: row.marked,
        })) ?? null,
      buckets: d.buckets,
      led:
        d.led?.map((row) => ({
          id: row.id,
          startAt: row.start_at,
          endAt: row.end_at,
          facilityCode: row.facility_code,
          capacity: row.capacity,
          booked: row.booked,
          present: row.present,
        })) ?? null,
      isAdmin: d.is_admin,
    },
  }
}
