import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getCoachSession, getCoachWorkspace } from '@/server/sessions/queries'
import { Occupancy, SessionSummary, StatusBadge } from '@/components/session/session-summary'
import { SessionActions } from '@/components/session/session-actions'
import { localDateKey } from '@/lib/time/workspace-time'
import { messages } from '@/lib/i18n'

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

  const t = messages.coach

  return (
    <main className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <SessionSummary session={session} timezone={workspace.timezone} />
        <span className="flex shrink-0 flex-col items-end gap-2">
          <StatusBadge status={session.status} />
          <Occupancy session={session} />
        </span>
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="opacity-60">{t.mainCoach}</dt>
          <dd>{session.mainCoachName ?? '—'}</dd>
        </div>
        {session.publicNotes ? (
          <div>
            <dt className="opacity-60">{t.publicNotes}</dt>
            <dd className="whitespace-pre-line">{session.publicNotes}</dd>
          </div>
        ) : null}
        {/* D-13: staff only. A guardian's query against this table returns no
            row at all, so this cannot leak through a shared component. */}
        {session.internalNotes ? (
          <div>
            <dt className="opacity-60">{t.internalNotes}</dt>
            <dd className="whitespace-pre-line">{session.internalNotes}</dd>
          </div>
        ) : null}
      </dl>

      {session.status !== 'CANCELLED' ? (
        <Link
          href={`/trener/${session.id}/upravit`}
          className="flex min-h-11 items-center justify-center rounded-lg border border-black/15 px-4 text-sm font-medium dark:border-white/20"
        >
          {t.editSession}
        </Link>
      ) : null}

      {/* The roster and manual booking arrive with the booking engine. */}
      <p className="rounded-lg bg-black/5 p-3 text-sm opacity-70 dark:bg-white/10">{t.rosterLater}</p>

      <SessionActions
        session={session}
        todayLocal={localDateKey(new Date(), workspace.timezone)}
      />
    </main>
  )
}
