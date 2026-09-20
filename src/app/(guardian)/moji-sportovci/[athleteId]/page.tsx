import { notFound } from 'next/navigation'
import { getGuardianAthlete, listJoinableWorkspaces } from '@/server/athletes/queries'
import { AthleteForm } from '@/components/athlete/athlete-form'
import { PhotoField } from '@/components/athlete/photo-field'
import { ActiveToggle } from '@/components/athlete/active-toggle'
import { messages } from '@/lib/i18n'

export default async function EditAthletePage({
  params,
}: {
  params: Promise<{ athleteId: string }>
}) {
  const { athleteId } = await params

  // Returns null for an athlete this guardian does not guard: the row policy
  // filters it out before it reaches here, so a guessed id is a 404, not a leak.
  const athlete = await getGuardianAthlete(athleteId)
  if (!athlete) notFound()

  const workspaces = await listJoinableWorkspaces()
  const workspace = workspaces[0]
  if (!workspace) notFound()

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{messages.athlete.editTitle}</h1>

      <PhotoField athleteId={athlete.id} photoUrl={athlete.photoUrl} />

      <AthleteForm
        workspaceId={workspace.id}
        workspaceName={workspace.name}
        timezone={workspace.timezone}
        athlete={athlete}
      />

      <ActiveToggle athleteId={athlete.id} isActive={athlete.isActive} />
    </main>
  )
}
