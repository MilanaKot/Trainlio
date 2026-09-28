import Link from 'next/link'
import {
  getCancellationDeadlineHours,
  listBookableSessions,
  listPickerAthletes,
} from '@/server/bookings/queries'
import { listGuardianAthletes, listJoinableWorkspaces } from '@/server/athletes/queries'
import { TrainingCard } from '@/components/booking/training-card'
import { TodayChip } from '@/components/ui/badge'
import { ClubMark } from '@/components/ui/club-mark'
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

  // One picker query per session. Each returns only this guardian's athletes
  // with the server's own eligibility verdict.
  const athletesBySession = new Map(
    await Promise.all(
      sessions.map(async (session) => [session.id, await listPickerAthletes(session.id)] as const),
    ),
  )

  const sports = messages.sports as Record<string, string>
  const meta = [
    workspace ? sports[workspace.sportCode] : undefined,
    sessions[0]?.locationName,
  ].filter(Boolean)

  const days = groupByLocalDay(sessions, (session) =>
    localDateKey(new Date(session.startAt), timezone),
  )

  return (
    <main className="flex flex-col gap-5">
      <header className="flex items-center gap-3">
        <ClubMark url={workspace?.logoUrl ?? null} name={workspace?.name ?? ''} />
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-display text-page font-bold text-ink">{t.listTitle}</h1>
          {meta.length > 0 ? <p className="text-meta text-muted">{meta.join(' · ')}</p> : null}
        </div>
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
