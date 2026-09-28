import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getCoachWorkspace, listCoachSessions } from '@/server/sessions/queries'
import { CoachTrainingRow } from '@/components/session/coach-training-row'
import { CreateSheet } from '@/components/session/create-sheet'
import { TodayChip } from '@/components/ui/badge'
import { ClubMark } from '@/components/ui/club-mark'
import { buttonVariants } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { groupByLocalDay } from '@/lib/domain/session-list'
import { formatDateGroup, localDateKey, relativeDayLabel } from '@/lib/time/workspace-time'
import { messages } from '@/lib/i18n'

const t = messages.coach

/**
 * The coach's training list (coach/SPEC.md §K1).
 *
 * Chronological, not a calendar, and not a dashboard: a coach opens this to
 * see what is on and how full it is. The past is a link at the bottom rather
 * than a second section, because it is looked at rarely and pushes the next
 * training off the screen when it is not.
 */
export default async function CoachSessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const [{ tab }, workspace] = await Promise.all([searchParams, getCoachWorkspace()])

  // The layout redirects a non-coach before this runs, so this is the second
  // line rather than the first. notFound() all the same, as every other coach
  // route does: `return null` renders a blank 200, which is the wrong answer if
  // the layout guard is ever moved or a route is added outside it.
  if (!workspace) notFound()

  const { upcoming, past } = await listCoachSessions()
  const showingPast = tab === 'minule'
  const sessions = showingPast ? past : upcoming
  const now = new Date()

  const sports = messages.sports as Record<string, string>
  const meta = [sports[workspace.sportCode], sessions[0]?.locationName].filter(Boolean)

  const days = groupByLocalDay(sessions, (session) =>
    localDateKey(new Date(session.startAt), workspace.timezone),
  )

  return (
    <main className="flex flex-col gap-5 pb-24">
      <header className="flex items-center gap-3">
        <ClubMark url={workspace.logoUrl} name={workspace.name} />
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-display text-page font-bold text-ink">
            {showingPast ? t.pastSessions : t.sessionsTitle}
          </h1>
          {meta.length > 0 ? <p className="text-meta text-muted">{meta.join(' · ')}</p> : null}
        </div>
      </header>

      {sessions.length === 0 ? (
        <EmptyState
          {...(showingPast
            ? {}
            : {
                action: (
                  <Link href="/trener/novy" className={buttonVariants({ size: 'md' })}>
                    {t.noSessionsAction}
                  </Link>
                ),
              })}
        >
          {showingPast ? t.noPastSessions : t.noSessions}
        </EmptyState>
      ) : (
        days.map((day) => {
          const at = new Date(day.items[0]!.startAt)

          return (
            <section key={day.key} className="flex flex-col gap-3">
              <h2 className="flex items-center gap-2 text-date font-bold text-primary">
                {formatDateGroup(at, workspace.timezone)}
                {relativeDayLabel(at, now, workspace.timezone) === 'TODAY' ? (
                  <TodayChip>{messages.session.today}</TodayChip>
                ) : null}
              </h2>

              <ul className="flex flex-col gap-3">
                {day.items.map((session) => (
                  <CoachTrainingRow
                    key={session.id}
                    session={session}
                    timezone={workspace.timezone}
                  />
                ))}
              </ul>
            </section>
          )
        })
      )}

      <Link
        href={showingPast ? '/trener' : '/trener?tab=minule'}
        className="flex min-h-11 items-center justify-center text-row font-semibold text-primary"
      >
        {showingPast ? t.upcomingSessions : t.pastSessions}
      </Link>

      <CreateSheet />
    </main>
  )
}
