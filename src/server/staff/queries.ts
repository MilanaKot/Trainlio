import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { rows } from '@/server/query-result'
import type { WorkspaceRole } from '@/types/database'

export type StaffMember = {
  profileId: string
  firstName: string | null
  lastName: string | null
  displayName: string | null
  roles: WorkspaceRole[]
  isActive: boolean
  hasLogin: boolean
  isEditable: boolean
  futureSessions: number
  /**
   * The coach's own contact number, or null — also when the caller may not see
   * it. `workspace_staff` returns it to an administrator and to the coach
   * themselves, and to nobody else (migration 33).
   */
  phone: string | null
  /** The address they sign in with (§A2). Null means no access at all. */
  email: string | null
  invitedAt: string | null
  firstSignInAt: string | null
  lastSeenAt: string | null
  /** Derived, never stored (§A2 data). */
  access: CoachAccess
}

/** §A2: `Bez přístupu` · `Pozván` · `Přihlášen`. */
export type CoachAccess = 'no_email' | 'invited' | 'signed_in'

export function coachAccess(member: {
  email: string | null
  firstSignInAt: string | null
}): CoachAccess {
  if (member.firstSignInAt !== null) return 'signed_in'
  return member.email === null ? 'no_email' : 'invited'
}

/**
 * The workspace's coaching staff, as the Trenéři screen shows them.
 *
 * Three things come from the database rather than from this page:
 *
 *   * `is_editable`, which is the same predicate `set_member_name` enforces, so
 *     a row the screen offers to edit is a row the write will accept;
 *   * inactive members, which an authenticated caller cannot see in
 *     `app_profiles` at all — staff visibility covers active staff — so without
 *     this function a deactivated coach would be unreachable and could never be
 *     brought back;
 *   * `future_sessions`, so the deactivation warning quotes the same count the
 *     refusal will (AC-251).
 */
export async function getWorkspaceStaff(workspaceId: string): Promise<StaffMember[]> {
  const supabase = await createClient()

  const staff = rows(
    'getWorkspaceStaff',
    await supabase.rpc('workspace_staff', { p_workspace_id: workspaceId }),
  )

  return staff.map((member) => ({
    profileId: member.profile_id,
    firstName: member.first_name,
    lastName: member.last_name,
    displayName: member.display_name,
    roles: member.roles,
    isActive: member.is_active,
    hasLogin: member.has_login,
    isEditable: member.is_editable,
    futureSessions: member.future_sessions,
    phone: member.phone,
    email: member.email,
    invitedAt: member.invited_at,
    firstSignInAt: member.first_sign_in_at,
    lastSeenAt: member.last_seen_at,
    access: coachAccess({
      email: member.email,
      firstSignInAt: member.first_sign_in_at,
    }),
  }))
}

export type OwnStaffState = {
  profileId: string
  isStaff: boolean
  isAdmin: boolean
  phone: string | null
  email: string | null
  firstSignInAt: string | null
  welcomedAt: string | null
}

/**
 * Who the signed-in person is, as the coach app needs to know it (§K0, §A3).
 *
 * One call rather than three reads: the layout asks it on every coach page to
 * decide whether the welcome screen is still owed.
 */
export async function getOwnStaffState(): Promise<OwnStaffState | null> {
  const supabase = await createClient()

  const state = rows('own_staff_state', await supabase.rpc('own_staff_state'))[0]
  if (!state) return null

  return {
    profileId: state.profile_id,
    isStaff: state.is_staff,
    isAdmin: state.is_admin,
    phone: state.phone,
    email: state.email,
    firstSignInAt: state.first_sign_in_at,
    welcomedAt: state.welcomed_at,
  }
}
