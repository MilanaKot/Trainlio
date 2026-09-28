import { notFound, redirect } from 'next/navigation'
import { getCoachWorkspace } from '@/server/sessions/queries'
import { getWorkspaceStaff } from '@/server/staff/queries'
import { CoachForm } from '@/components/staff/coach-form'

/**
 * A new coach (admin/SPEC.md §A2).
 *
 * Created active and with no login: the club's first coach exists on the ice
 * before they exist in a database, and can lead trainings from the moment
 * their name is on the list (migration 21).
 */
export default async function NewCoachPage() {
  const workspace = await getCoachWorkspace()
  if (!workspace) notFound()

  const staff = await getWorkspaceStaff(workspace.id)
  if (!staff.some((member) => member.isEditable)) redirect('/trener/vice/treneri')

  return (
    <main className="flex flex-col gap-4">
      <CoachForm
        workspaceId={workspace.id}
        existingNames={staff.map((member) => member.displayName ?? '')}
      />
    </main>
  )
}
