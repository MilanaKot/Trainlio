import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getOwnProfile, listJoinableWorkspaces } from '@/server/athletes/queries'
import { AthleteForm } from '@/components/athlete/athlete-form'
import { messages } from '@/lib/i18n'

const t = messages.athlete

/** A new child (guardian/SPEC.md §G10). */
export default async function NewAthletePage() {
  const [workspaces, profile] = await Promise.all([listJoinableWorkspaces(), getOwnProfile()])

  // MVP runs one workspace. The list is read through joinable_workspaces()
  // because a parent with no athlete yet can see no workspace row at all.
  const workspace = workspaces[0]
  if (!workspace) notFound()

  return (
    <main className="flex flex-col gap-5 pb-36">
      <Link
        href="/moji-sportovci"
        className="flex min-h-11 items-center self-start text-row font-semibold text-muted"
      >
        {messages.common.cancel}
      </Link>
      <h1 className="font-display text-form-title font-bold text-ink">{t.newTitle}</h1>

      <AthleteForm
        workspaceId={workspace.id}
        workspaceName={workspace.name}
        timezone={workspace.timezone}
        // Once, for a parent who has not said who they are. A second child is
        // registered on the same screen without the block.
        askGuardianDetails={(profile?.firstName ?? '') === ''}
      />
    </main>
  )
}
