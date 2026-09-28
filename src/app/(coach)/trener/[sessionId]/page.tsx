import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getCoachSession, getCoachWorkspace, getSessionCoaches } from '@/server/sessions/queries'
import { getSessionRoster, listCandidates } from '@/server/roster/queries'
import { RosterList } from '@/components/roster/roster-list'
import { SessionControls } from '@/components/session/session-controls'
import { Badge, TodayChip } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CapacityMeter } from '@/components/ui/capacity-meter'
import { DetailList } from '@/components/ui/detail-list'
import { Notice } from '@/components/ui/notice'
import { splitRoster } from '@/lib/domain/roster'
import { eligibilityLabel } from '@/lib/domain/session'
import {
  formatDateGroup,
  formatDateShort,
  formatTime,
  formatTimeRange,
  localDateKey,
  relativeDayLabel,
} from '@/lib/time/workspace-time'
import { messages } from '@/lib/i18n'

const t = messages.coach

function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="size-3.5 shrink-0" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 015 0v2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

/**
 * One training, as the coach running it needs it (coach/SPEC.md §K2).
 *
 * The order is the order of a coach's attention: when and where, how full,
 * who is running it, what the parents were told, what only the staff know,
 * who is coming, and only then what can be done about it.
 */
export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ sessionId: string }>
}) {
  const { sessionId } = await params
  const workspace = await getCoachWorkspace()
  if (!workspace) notFound()

  const session = await getCoachSession(sessionId)
  if (!session) notFound()

  const [entries, candidates, coaches] = await Promise.all([
    getSessionRoster(sessionId),
    listCandidates(sessionId),
    getSessionCoaches(sessionId),
  ])

  const start = new Date(session.startAt)
  const end = new Date(session.endAt)
  const now = new Date()
  const cancelled = session.status === 'CANCELLED'
  const { confirmed } = splitRoster(entries)
  const assistants = coaches.filter((c) => c.role === 'ASSISTANT')

  const venue = [
    session.locationName,
    session.facilityCode,
    session.changingRoom,
    eligibilityLabel(
      session.eligibilityMode,
      session.birthYearFrom,
      session.birthYearTo,
      t.eligibilityAll,
    ),
  ]
    .filter(Boolean)
    .join(' · ')

  const sessionLabel = `${formatDateShort(start, workspace.timezone)} · ${formatTime(start, workspace.timezone)}`

  return (
    <main className="flex flex-col gap-6 pb-10">
      <Link href="/trener" className="flex min-h-11 items-center gap-1 text-row text-muted">
        <span aria-hidden="true">‹</span> {t.backToList}
      </Link>

      {/* D-07: cancellation is terminal, so the screen says so at the top and
          the actions below shrink to the one thing still possible. */}
      {cancelled ? (
        <Notice variant="danger" title={t.cancelledCaption}>
          {t.cancelledBy
            .replace('{name}', session.mainCoachName ?? t.none)
            .replace('{when}', formatDateGroup(start, workspace.timezone))}
        </Notice>
      ) : null}

      <header className="flex flex-col gap-1">
        <p className="flex items-center gap-2 text-date font-bold text-primary">
          {formatDateGroup(start, workspace.timezone)}
          {relativeDayLabel(start, now, workspace.timezone) === 'TODAY' ? (
            <TodayChip>{messages.session.today}</TodayChip>
          ) : null}
        </p>
        <p
          className={`nums font-display text-hero font-bold ${cancelled ? 'text-muted line-through' : 'text-ink'}`}
        >
          {formatTimeRange(start, end, workspace.timezone)}
        </p>
        <p className="text-meta text-muted">{venue}</p>
        {session.status === 'CLOSED' ? (
          <span className="flex w-fit items-center gap-1 rounded-badge bg-neutral-50 px-2 py-1 text-hint font-semibold text-muted">
            <LockIcon />
            {t.closed}
          </span>
        ) : null}
        {session.status === 'DRAFT' ? (
          <span className="w-fit pt-1">
            <Badge>{t.draft}</Badge>
          </span>
        ) : null}
      </header>

      <section className="flex flex-col gap-2 rounded-card bg-surface p-4 shadow-card">
        <h2 className="text-caption font-bold uppercase tracking-[0.05em] text-muted">
          {t.occupancyCaption}
        </h2>
        <CapacityMeter
          booked={session.confirmedCount}
          capacity={session.capacity}
          registrationOpen={session.status === 'OPEN'}
        />
      </section>

      <DetailList
        items={[
          {
            term: t.mainCoach,
            value: coaches.find((c) => c.role === 'MAIN')?.displayName ?? session.mainCoachName,
          },
          {
            term: t.assistants,
            value:
              assistants.length > 0 ? (
                <span className="flex flex-col">
                  {assistants.map((coach) => (
                    <span key={coach.profileId}>{coach.displayName}</span>
                  ))}
                </span>
              ) : (
                <span className="text-subtle">{t.none}</span>
              ),
          },
        ]}
      />

      {session.publicNotes ? (
        <section className="flex flex-col gap-2 rounded-card bg-surface p-4 shadow-card">
          <h2 className="text-caption font-bold uppercase tracking-[0.05em] text-muted">
            {t.publicNoteCaption}
          </h2>
          <p className="whitespace-pre-line text-body text-ink">{session.publicNotes}</p>
        </section>
      ) : null}

      {/* D-13: staff only. A guardian's query against this table returns no row
          at all, so this cannot leak through a shared component — and the panel
          says whose eyes it is for, so nobody writes a parent's message here. */}
      {session.internalNotes ? (
        <section className="flex flex-col gap-2 rounded-card border border-internal-border bg-internal p-4">
          <h2 className="flex items-center gap-1.5 text-caption font-bold uppercase tracking-[0.05em] text-internal-ink">
            <LockIcon />
            {t.internalNoteCaption}
          </h2>
          <p className="whitespace-pre-line text-body text-ink">{session.internalNotes}</p>
        </section>
      ) : null}

      <RosterList
        sessionId={session.id}
        sessionLabel={sessionLabel}
        entries={entries}
        candidates={candidates}
        capacity={session.capacity}
        confirmedCount={session.confirmedCount}
        timezone={workspace.timezone}
        addable={!cancelled}
      />

      {cancelled ? (
        <Button variant="outline" size="lg" disabled>
          {t.duplicateAsNew}
        </Button>
      ) : (
        <SessionControls
          session={session}
          confirmedCount={confirmed.length}
          todayLocal={localDateKey(now, workspace.timezone)}
        />
      )}
    </main>
  )
}
