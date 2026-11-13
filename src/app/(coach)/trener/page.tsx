import { notFound, redirect } from 'next/navigation'
import { getCoachWorkspace, listCoachSessions } from '@/server/sessions/queries'
import { getOwnStaffState } from '@/server/staff/queries'
import { touchStaffSeen } from '@/server/staff/actions'
import { CoachSessionList } from '@/components/session/coach-session-list'
import { CoachTrainingsTabs } from '@/components/session/coach-trainings-tabs'
import { CreateSheet } from '@/components/session/create-sheet'
import { TrainingsHeader } from '@/components/session/trainings-header'
import { EmptyState } from '@/components/ui/empty-state'
import { canCreateSessions } from '@/lib/domain/coach-rights'
import { DollarIcon, PersonCheckIcon } from '@/components/ui/status-toggle'
import Link from 'next/link'
import { messages, plural } from '@/lib/i18n'
import { listJoinRequests } from '@/server/club/queries'

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

  // Decision 33. The database refuses what this hides (FORBIDDEN_EDIT).
  const rights = { me: state?.profileId ?? '', canEditAll: state?.canEditAll ?? false }
  const canCreate = canCreateSessions(rights)

  const [{ upcoming, past }, requests] = await Promise.all([
    listCoachSessions(),
    // Answers only an administrator; for anyone else it is empty.
    listJoinRequests(workspace.id),
  ])
  const waiting = requests.filter((r) => r.approval === 'PENDING').length
  const showingPast = tab === 'minule'
  const sessions = showingPast ? past : upcoming
  const now = new Date()

  return (
    <main className="flex flex-col gap-5 pb-24">
      <TrainingsHeader workspace={workspace} />

      <CoachTrainingsTabs value={showingPast ? 'past' : 'upcoming'} />

      {/* Migration 50: children waiting for the administrator. */}
      {waiting > 0 ? (
        <Link
          href="/trener/vice/zadosti"
          className="flex min-h-12 items-center justify-between gap-3 rounded-control-lg bg-warning-soft px-4 text-row font-bold text-warning"
        >
          {plural(waiting, messages.access.waitingNotice)}
          <span aria-hidden="true">›</span>
        </Link>
      ) : null}

      {/* §K14 (decision 44): what the two counters on each row are. */}
      {showingPast && sessions.length > 0 ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-hint text-muted">
          <span className="flex items-center gap-1">
            <PersonCheckIcon className="size-3.5" />
            {t.pastPresent}
          </span>
          <span className="flex items-center gap-1">
            <DollarIcon className="size-3.5" />
            {t.pastPaid}
          </span>
          <span>· {t.pastLegendMissing}</span>
        </p>
      ) : null}

      {sessions.length === 0 ? (
        <EmptyState
          {...(showingPast || !canCreate ? {} : { action: <CreateSheet variant="inline" /> })}
        >
          {showingPast ? t.noPastSessions : t.noSessions}
        </EmptyState>
      ) : (
        <CoachSessionList
          sessions={sessions}
          me={rights.me}
          defaultFilter={canCreate ? 'all' : 'mine'}
          timezone={workspace.timezone}
          variant={showingPast ? 'past' : 'upcoming'}
          now={now.toISOString()}
        />
      )}

      {/* §K14: nothing is created from the past. An empty list creates from
          its own empty state, so it has no FAB as well. §K1b (v3.2): a coach
          without the permission creates nothing at all. */}
      {showingPast || sessions.length === 0 || !canCreate ? null : <CreateSheet />}
    </main>
  )
}
