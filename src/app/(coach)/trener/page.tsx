import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getCoachWorkspace, listCoachSessions } from '@/server/sessions/queries'
import { Occupancy, SessionSummary, StatusBadge } from '@/components/session/session-summary'
import { messages } from '@/lib/i18n'
import type { CoachSession } from '@/server/sessions/queries'

function SessionRow({ session, timezone }: { session: CoachSession; timezone: string }) {
  return (
    <li>
      <Link
        href={`/trener/${session.id}`}
        className="flex items-start justify-between gap-4 rounded-xl border border-black/10 p-4 dark:border-white/15"
      >
        <SessionSummary session={session} timezone={timezone} />
        <span className="flex shrink-0 flex-col items-end gap-2">
          <StatusBadge status={session.status} />
          <Occupancy session={session} />
        </span>
      </Link>
    </li>
  )
}

export default async function CoachSessionsPage() {
  const workspace = await getCoachWorkspace()
  // The layout redirects a non-coach before this runs, so this is the second
  // line rather than the first. notFound() all the same, as every other coach
  // route does: `return null` renders a blank 200, which is the wrong answer if
  // the layout guard is ever moved or a route is added outside it.
  if (!workspace) notFound()

  const { upcoming, past } = await listCoachSessions()
  const t = messages.coach

  return (
    <main className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t.sessionsTitle}</h1>
        <Link
          href="/trener/novy"
          className="flex min-h-11 items-center rounded-lg bg-black px-4 text-sm font-medium text-white dark:bg-white dark:text-black"
        >
          {t.newSession}
        </Link>
      </div>

      {upcoming.length === 0 && past.length === 0 ? (
        <p className="rounded-xl border border-dashed border-black/15 p-6 text-center text-sm opacity-70 dark:border-white/20">
          {t.noSessions}
        </p>
      ) : null}

      {upcoming.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide opacity-60">
            {messages.myBookings.upcoming}
          </h2>
          <ul className="flex flex-col gap-3">
            {upcoming.map((session) => (
              <SessionRow key={session.id} session={session} timezone={workspace.timezone} />
            ))}
          </ul>
        </section>
      ) : null}

      {past.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide opacity-60">
            {messages.myBookings.past}
          </h2>
          <ul className="flex flex-col gap-3">
            {past.map((session) => (
              <SessionRow key={session.id} session={session} timezone={workspace.timezone} />
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  )
}
