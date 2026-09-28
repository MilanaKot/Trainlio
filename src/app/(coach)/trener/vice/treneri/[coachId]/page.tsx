import { notFound, redirect } from 'next/navigation'
import { getCoachWorkspace } from '@/server/sessions/queries'
import { getWorkspaceStaff } from '@/server/staff/queries'
import { getOwnProfile } from '@/server/athletes/queries'
import { CoachForm } from '@/components/staff/coach-form'

/**
 * One coach (admin/SPEC.md §A3).
 *
 * Renaming changes the name everywhere, because every training references the
 * profile rather than a copy of the name. Leaving is a deactivation and never
 * a delete: a coach who led a training last winter is part of that training's
 * record (AC-249).
 */
export default async function EditCoachPage({ params }: { params: Promise<{ coachId: string }> }) {
  const { coachId } = await params
  const workspace = await getCoachWorkspace()
  if (!workspace) notFound()

  const staff = await getWorkspaceStaff(workspace.id)
  if (!staff.some((member) => member.isEditable)) redirect('/trener/vice/treneri')

  const member = staff.find((one) => one.profileId === coachId)
  if (!member) notFound()

  const own = await getOwnProfile()

  return (
    <main className="flex flex-col gap-4">
      <CoachForm
        workspaceId={workspace.id}
        member={member}
        // An administrator cannot switch themselves off (§A3). The database
        // says the same thing in the case that matters — the last active
        // administrator is refused outright — and this is the courtesy in
        // front of it.
        isSelf={own?.id === member.profileId}
      />
    </main>
  )
}
