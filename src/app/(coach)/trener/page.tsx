import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getCoachWorkspace, listCoachSessions } from '@/server/sessions/queries'
import { getOwnStaffState } from '@/server/staff/queries'
import { touchStaffSeen } from '@/server/staff/actions'
import { CoachTrainingRow } from '@/components/session/coach-training-row'
import { CoachTrainingsTabs } from '@/components/session/coach-trainings-tabs'
import { CreateSheet } from '@/components/session/create-sheet'
import { TodayChip } from '@/components/ui/badge'
import { OrgLogo } from '@/components/ui/org-logo'
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
 * see what is on and how full it is. The past is behind the same switch a
 * parent has on their own list (v3, DR-02), newest first — it is read in the
 * other direction, because what a coach looks back at is the training that has
 * just finished.
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

  // §K0, once: a coach who has signed in and never been welcomed is sent there
  // first. Here rather than in the layout because this is where signing in
  // lands, and a layout cannot tell which screen it is wrapping.
  const state = await getOwnStaffState()
  if (state?.isStaff && state.firstSignInAt !== null && state.welcomedAt === null) {
    redirect('/trener/vitejte')
  }

  // §A3's `Naposledy v aplikaci`. The database writes at most hourly.
  await touchStaffSeen()

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
        <OrgLogo org={workspace.organization} size={36} />
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-display text-page font-bold text-ink">{t.sessionsTitle}</h1>
          {meta.length > 0 ? <p className="text-meta text-muted">{meta.join(' · ')}</p> : null}
        </div>
      </header>

      <CoachTrainingsTabs value={showingPast ? 'past' : 'upcoming'} />

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
                    variant={showingPast ? 'past' : 'upcoming'}
                  />
                ))}
              </ul>
            </section>
          )
        })
      )}

      {/* §K14: nothing is created from the past. */}
      {showingPast ? null : <CreateSheet />}
    </main>
  )
}
