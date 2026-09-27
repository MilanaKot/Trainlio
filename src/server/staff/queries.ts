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
  }))
}
