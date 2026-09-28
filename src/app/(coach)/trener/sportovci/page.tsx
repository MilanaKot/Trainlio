import { listWorkspaceAthletes } from '@/server/roster/queries'
import { Avatar } from '@/components/ui/avatar'
import { EmptyState } from '@/components/ui/empty-state'
import { HOCKEY_POSITION_LABELS, type HockeyPosition } from '@/lib/enums/hockey'
import { messages } from '@/lib/i18n'

const t = messages.coach

/**
 * The club's athletes (the coach's `Sportovci` tab).
 *
 * Deliberately plain: this round of the design does not specify the screen, so
 * it shows what a coach asks it for — who trains here, in one list, by name —
 * and nothing invented on top of that. The rows are not links, because there is
 * no designed athlete screen for a coach to open yet; what a coach needs about
 * one child at a training is on the roster, where it has a reason to be.
 */
export default async function CoachAthletesPage() {
  const athletes = await listWorkspaceAthletes()

  return (
    <main className="flex flex-col gap-5">
      <h1 className="font-display text-page font-bold text-ink">{messages.coachNav.athletes}</h1>

      {athletes.length === 0 ? (
        <EmptyState>{t.rosterEmpty}</EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {athletes.map((athlete) => (
            <li
              key={athlete.id}
              className="flex items-center gap-3 rounded-card bg-surface p-3 shadow-card"
            >
              <Avatar
                firstName={athlete.firstName}
                lastName={athlete.lastName}
                size={36}
                muted={!athlete.isActive}
              />
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-row font-semibold text-ink">
                  {athlete.firstName} {athlete.lastName}
                </span>
                <span className="text-meta text-muted">
                  {[
                    athlete.birthYear,
                    athlete.positionCode
                      ? HOCKEY_POSITION_LABELS[athlete.positionCode as HockeyPosition]
                      : null,
                    athlete.isActive ? null : messages.staff.inactive,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
