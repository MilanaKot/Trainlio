import { notFound, redirect } from 'next/navigation'
import { getCoachWorkspace } from '@/server/sessions/queries'
import { getOwnStaffState, getWorkspaceStaff } from '@/server/staff/queries'
import { WelcomeForm } from '@/components/staff/welcome-form'
import { messages } from '@/lib/i18n'

/**
 * The first screen an invited coach sees (coach/SPEC.md §K0).
 *
 * Shown once, after the first sign-in, and the "once" is a stamp rather than a
 * cookie: a coach who closes the tab halfway through sees it again, which is
 * the right answer for a screen that asks for their telephone number.
 */
export default async function WelcomePage() {
  const [workspace, state] = await Promise.all([getCoachWorkspace(), getOwnStaffState()])
  if (!workspace) notFound()
  if (!state?.isStaff || state.welcomedAt !== null) redirect('/trener')

  const staff = await getWorkspaceStaff(workspace.id)
  const me = staff.find((member) => member.profileId === state.profileId)
  const admin = staff.find((member) => member.roles.includes('WORKSPACE_ADMIN') && member.isActive)

  return (
    <WelcomeForm
      organizationName={workspace.organization.name}
      organization={workspace.organization}
      name={me?.displayName ?? messages.staff.noName}
      firstName={me?.firstName ?? '?'}
      {...(me?.lastName ? { lastName: me.lastName } : {})}
      sessions={me?.futureSessions ?? 0}
      {...(admin?.displayName ? { adminName: admin.displayName } : {})}
      phone={state.phone}
    />
  )
}
