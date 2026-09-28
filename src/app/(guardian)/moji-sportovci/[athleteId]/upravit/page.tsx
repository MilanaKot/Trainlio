import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getGuardianAthlete, listJoinableWorkspaces } from '@/server/athletes/queries'
import { AthleteForm } from '@/components/athlete/athlete-form'
import { PhotoField } from '@/components/athlete/photo-field'
import { ActiveToggle } from '@/components/athlete/active-toggle'
import { messages } from '@/lib/i18n'

const t = messages.athlete

/**
 * Editing one child (guardian/SPEC.md §G9).
 *
 * The photograph is here and not on the new-athlete screen because it is
 * stored against an athlete that has to exist first — a parent adds the child,
 * then the picture.
 *
 * Deactivation is not in the design and is kept: D-09 gives a parent a way to
 * take a child out of the booking lists for a season without losing anything
 * they already hold, and there is nowhere else for it to live.
 */
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
    <main className="flex flex-col gap-5 pb-36">
      <Link
        href={{ pathname: `/moji-sportovci/${athlete.id}` }}
        className="flex min-h-11 items-center self-start text-row font-semibold text-muted"
      >
        {messages.common.cancel}
      </Link>
      <h1 className="font-display text-form-title font-bold text-ink">{t.editTitle}</h1>

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
