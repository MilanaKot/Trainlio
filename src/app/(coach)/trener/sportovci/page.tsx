import { notFound } from 'next/navigation'
import { getCoachWorkspace } from '@/server/sessions/queries'
import { listCoachAthletes } from '@/server/roster/queries'
import { AthleteList } from '@/components/roster/athlete-list'
import { messages } from '@/lib/i18n'

const t = messages.coach

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
  const active = athletes.filter((athlete) => athlete.isActive).length

  return (
    <main className="flex flex-col gap-5 pb-8">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="font-display text-page font-bold text-ink">{t.athletesTitle}</h1>
        <span className="text-meta text-muted">
          {t.athletesActive.replace('{count}', String(active))}
        </span>
      </header>

      <AthleteList athletes={athletes} />
    </main>
  )
}
