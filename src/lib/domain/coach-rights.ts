import type { SessionRole } from '@/components/ui/role-label'

/**
 * Who may do what to a training (decision 33, coach/SPEC.md §K2b).
 *
 *   canEdit(session) = isAdmin || canEditTrainings || session.mainCoachId === me
 *   canCreate        = isAdmin || canEditTrainings
 *
 * `canEditAll` is the first two together, as own_staff_state reports it.
 * The database refuses everything these say no to (FORBIDDEN_EDIT, migration
 * 42); here they only decide what a screen offers, which is why a screen hides
 * what they refuse instead of disabling it.
 */
export type CoachRights = { me: string; canEditAll: boolean }

export function canEditSession(rights: CoachRights, session: { mainCoachId: string }): boolean {
  return rights.canEditAll || session.mainCoachId === rights.me
}

export function canCreateSessions(rights: CoachRights): boolean {
  return rights.canEditAll
}

/** The signed-in coach's part in a training, or null if they have none. */
export function sessionRole(
  me: string,
  session: { mainCoachId: string; coachRoles: { profileId: string; role: SessionRole }[] },
): SessionRole | null {
  if (session.mainCoachId === me) return 'MAIN'
  return session.coachRoles.some((coach) => coach.profileId === me && coach.role === 'ASSISTANT')
    ? 'ASSISTANT'
    : null
}
