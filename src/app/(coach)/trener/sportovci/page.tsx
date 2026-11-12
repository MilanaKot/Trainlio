import { notFound } from 'next/navigation'
import { getCoachWorkspace } from '@/server/sessions/queries'
import { listCoachAthletes } from '@/server/roster/queries'
import { AthleteList } from '@/components/roster/athlete-list'
/**
 * The club's athletes (coach/SPEC.md §K12).
 *
 * A coach cannot create an athlete or a guardian account here, and there is no
 * button suggesting otherwise: a child exists because their parent registered
 * them, which is also why the empty state says where they come from.
 */
export default async function CoachAthletesPage() {
  const workspace = await getCoachWorkspace()
  if (!workspace) notFound()

  const athletes = await listCoachAthletes(workspace.id)

  return (
    <main className="flex flex-col gap-5 pb-8">
      {/* The header's count follows the year chosen, so the list draws it. */}
      <AthleteList athletes={athletes} />
    </main>
  )
}
