import { OrgLogo } from '@/components/ui/org-logo'
import { messages } from '@/lib/i18n'
import type { CoachWorkspace } from '@/server/sessions/queries'

/**
 * `Tréninky` with the club's mark and `Lední hokej · Příbram` (§K1), shared by
 * the three tabs under it: Nadcházející, Minulé and, since v3.6, Série (K15).
 *
 * The town is the club's own location, not whichever training happens to be
 * first in the list: on the day the club is handed over there are no trainings
 * at all. Named only while the club has a single location — with two, picking
 * one of them would be a guess.
 */
export function TrainingsHeader({ workspace }: { workspace: CoachWorkspace }) {
  const sports = messages.sports as Record<string, string>
  const towns = [...new Set(workspace.facilities.map((one) => one.locationName))]
  const meta = [sports[workspace.sportCode], towns.length === 1 ? towns[0] : null].filter(Boolean)

  return (
    <header className="flex items-center gap-3">
      <OrgLogo org={workspace.organization} size={36} />
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="font-display text-page font-bold text-ink">
          {messages.coach.sessionsTitle}
        </h1>
        {meta.length > 0 ? <p className="text-meta text-muted">{meta.join(' · ')}</p> : null}
      </div>
    </header>
  )
}
