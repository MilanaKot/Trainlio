import Link from 'next/link'
import {
  getCancellationDeadlineHours,
  listBookableSessions,
  listPickerAthletesFor,
} from '@/server/bookings/queries'
import { listGuardianAthletes, listJoinableWorkspaces } from '@/server/athletes/queries'
import { TrainingCard } from '@/components/booking/training-card'
import { TodayChip } from '@/components/ui/badge'
import { OrgLogo } from '@/components/ui/org-logo'
import { buttonVariants } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { groupByLocalDay } from '@/lib/domain/session-list'
import {
  DEFAULT_TIMEZONE,
  formatDateGroup,
  localDateKey,
  relativeDayLabel,
} from '@/lib/time/workspace-time'
import { messages } from '@/lib/i18n'

const t = messages.session

/**
 * The training list (guardian/SPEC.md §G1).
 *
 * Grouped by the workspace's calendar day, ascending. Cancelled trainings do
 * not appear here at all — a parent with a booking on one sees it in "Moje
 * tréninky", where they can act on it; a parent without one has nothing to do
 * about it.
 */
export default async function SessionsPage() {
  const [sessions, workspaces, athletes, deadlineHours] = await Promise.all([
    listBookableSessions(),
    listJoinableWorkspaces(),
    listGuardianAthletes(),
    getCancellationDeadlineHours(),
  ])

  const workspace = workspaces[0]
  const timezone = workspace?.timezone ?? DEFAULT_TIMEZONE
  const now = new Date()

  // One query for the whole list, not one per card (migration 32). It returns
  // only this guardian's athletes, each with the server's own eligibility
  // verdict.
  const athletesBySession = await listPickerAthletesFor(sessions.map((session) => session.id))

  const sports = messages.sports as Record<string, string>
  // The venue comes from the club, not from whichever training is first: a
  // parent who has just signed up has no trainings yet and should still be
  // told where this is (migration 31).
  const meta = [
    workspace ? sports[workspace.sportCode] : undefined,
    workspace?.locationName ?? sessions[0]?.locationName,
  ].filter(Boolean)

  const days = groupByLocalDay(sessions, (session) =>
    localDateKey(new Date(session.startAt), timezone),
  )

  return (
    <main className="flex flex-col gap-5">
      {/* The club above the page title, not beside it (guardian/SPEC.md §G1,
          updated). Only this tab carries it: it says whose trainings these are,
          which the other tabs do not need to repeat. */}
      <header className="flex flex-col gap-3">
        {workspace ? (
          <div className="flex items-center gap-2.5">
            <OrgLogo org={workspace.organization} size={36} />
            <div className="flex min-w-0 flex-col">
              <p className="truncate text-row font-bold text-ink">{workspace.organization.name}</p>
              {meta.length > 0 ? (
                <p className="truncate text-hint font-normal text-muted">{meta.join(' · ')}</p>
              ) : null}
            </div>
          </div>
        ) : null}
        <h1 className="font-display text-page font-bold text-ink">{t.listTitle}</h1>
      </header>

      {/* D-01 means these two are never both relevant: a family with no athlete
          belongs to no workspace, so they see no trainings either. The one they
          get is the one they can act on — "add a child" before "nothing is on". */}
      {athletes.length === 0 ? (
        <EmptyState
          action={
            <Link href="/moji-sportovci/novy" className={buttonVariants({ size: 'md' })}>
              {t.addAthlete}
            </Link>
          }
        >
          {t.noAthletes}
        </EmptyState>
      ) : sessions.length === 0 ? (
        <EmptyState>{t.noSessions}</EmptyState>
      ) : (
        days.map((day) => {
          const first = day.items[0]!
          const at = new Date(first.startAt)
          const relative = relativeDayLabel(at, now, timezone)

          return (
            <section key={day.key} className="flex flex-col gap-3">
              <h2 className="flex items-center gap-2 text-date font-bold text-primary">
                {formatDateGroup(at, timezone)}
                {relative === 'TODAY' ? <TodayChip>{t.today}</TodayChip> : null}
              </h2>

              <ul className="flex flex-col gap-3">
                {day.items.map((session) => (
                  <TrainingCard
                    key={session.id}
                    session={session}
                    timezone={timezone}
                    athletes={athletesBySession.get(session.id) ?? []}
                    deadlineHours={deadlineHours}
                    now={now}
                  />
                ))}
              </ul>
            </section>
          )
        })
      )}
    </main>
  )
}
