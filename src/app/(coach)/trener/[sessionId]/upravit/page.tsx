import { notFound } from 'next/navigation'
import { getCoachSession, getCoachWorkspace, getSessionCoaches } from '@/server/sessions/queries'
import { getSessionRoster } from '@/server/roster/queries'
import { SessionForm } from '@/components/session/session-form'
import { formatTime, localDateKey } from '@/lib/time/workspace-time'
import { messages } from '@/lib/i18n'

const t = messages.coach

/**
 * Editing one training (coach/SPEC.md §K3).
 *
 * The roster comes with it, and only for one reason: §K9 names the athletes a
 * narrower year range would exclude, and a count alone ("4 sportovci") is not
 * something a coach can check. The list is what the coach reads; whether the
 * save is allowed at all is still the server's answer.
 */
export default async function EditSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>
}) {
  const { sessionId } = await params
  const workspace = await getCoachWorkspace()
  if (!workspace) notFound()

  const session = await getCoachSession(sessionId)
  if (!session) notFound()

  // D-07: a cancelled session is terminal, so it is never editable. The server
  // refuses it too; this keeps the coach from filling in a form that cannot save.
  if (session.status === 'CANCELLED') {
    return (
      <main className="flex flex-col gap-4">
        <h1 className="font-display text-form-title font-bold text-ink">{t.editSessionTitle}</h1>
        <p className="text-meta text-muted">{t.cancelledNotice}</p>
      </main>
    )
  }

  const [roster, coaches] = await Promise.all([
    getSessionRoster(sessionId),
    getSessionCoaches(sessionId),
  ])

  const booked = roster.filter((entry) => entry.status === 'CONFIRMED')
  const start = new Date(session.startAt)
  const end = new Date(session.endAt)
  const facility = workspace.facilities.find((f) => f.code === session.facilityCode)

  return (
    <main className="flex flex-col gap-4">
      <SessionForm
        workspace={workspace}
        session={session}
        bookedCount={booked.length}
        bookedAthletes={booked
          .filter((entry) => entry.birthYear !== null)
          .map((entry) => ({
            firstName: entry.firstName,
            lastName: entry.lastName,
            birthYear: entry.birthYear as number,
          }))}
        // Converted back to the workspace's wall clock, which is what the coach
        // typed and what the form must show again.
        initial={{
          date: localDateKey(start, workspace.timezone),
          start: formatTime(start, workspace.timezone),
          end: formatTime(end, workspace.timezone),
          locationName: session.locationName,
          facilityId: facility?.id ?? '',
          changingRoom: session.changingRoom ?? '',
          capacity: session.capacity,
          eligibilityMode: session.eligibilityMode,
          birthYearFrom: session.birthYearFrom ? String(session.birthYearFrom) : '',
          birthYearTo: session.birthYearTo ? String(session.birthYearTo) : '',
          mainCoachId: session.mainCoachId,
          assistantIds: coaches
            .filter((coach) => coach.role === 'ASSISTANT')
            .map((coach) => coach.profileId),
          publicNotes: session.publicNotes ?? '',
          internalNotes: session.internalNotes ?? '',
        }}
      />
    </main>
  )
}
