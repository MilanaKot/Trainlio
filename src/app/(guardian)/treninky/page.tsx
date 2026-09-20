import { listBookableSessions, listPickerAthletes } from '@/server/bookings/queries'
import { listJoinableWorkspaces } from '@/server/athletes/queries'
import { SessionCard } from '@/components/booking/session-card'
import { DEFAULT_TIMEZONE } from '@/lib/time/workspace-time'
import { messages } from '@/lib/i18n'

export default async function SessionsPage() {
  const [sessions, workspaces] = await Promise.all([
    listBookableSessions(),
    listJoinableWorkspaces(),
  ])

  const timezone = workspaces[0]?.timezone ?? DEFAULT_TIMEZONE
  const now = new Date()

  // One picker query per session. Each returns only this guardian's athletes
  // with the server's own eligibility verdict.
  const athletesBySession = new Map(
    await Promise.all(
      sessions.map(
        async (session) => [session.id, await listPickerAthletes(session.id)] as const,
      ),
    ),
  )

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{messages.session.listTitle}</h1>

      {sessions.length === 0 ? (
        <div className="flex flex-col gap-2 rounded-xl border border-dashed border-black/15 p-6 text-center dark:border-white/20">
          <p className="font-medium">{messages.session.noSessions}</p>
          <p className="text-sm opacity-70">{messages.session.noSessionsHint}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {sessions.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              timezone={timezone}
              athletes={athletesBySession.get(session.id) ?? []}
              now={now}
            />
          ))}
        </ul>
      )}
    </main>
  )
}
