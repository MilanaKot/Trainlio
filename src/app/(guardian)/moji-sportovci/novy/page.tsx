import { notFound } from 'next/navigation'
import { listJoinableWorkspaces } from '@/server/athletes/queries'
import { AthleteForm } from '@/components/athlete/athlete-form'
import { messages } from '@/lib/i18n'

export default async function NewAthletePage() {
  const workspaces = await listJoinableWorkspaces()

  // MVP runs one workspace. The list is read through joinable_workspaces()
  // because a parent with no athlete yet can see no workspace row at all.
  const workspace = workspaces[0]
  if (!workspace) notFound()

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{messages.athlete.newTitle}</h1>
      <AthleteForm
        workspaceId={workspace.id}
        workspaceName={workspace.name}
        timezone={workspace.timezone}
      />
    </main>
  )
}
