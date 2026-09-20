import { notFound } from 'next/navigation'
import { getCoachSession, getCoachWorkspace } from '@/server/sessions/queries'
import { SessionForm } from '@/components/session/session-form'
import { formatTime, localDateKey } from '@/lib/time/workspace-time'
import { messages } from '@/lib/i18n'

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
        <h1 className="text-2xl font-semibold">{messages.coach.editSessionTitle}</h1>
        <p className="text-sm opacity-70">{messages.coach.cancelledNotice}</p>
      </main>
    )
  }

  const start = new Date(session.startAt)
  const end = new Date(session.endAt)

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{messages.coach.editSessionTitle}</h1>
      <SessionForm
        workspace={workspace}
        session={session}
        // Converted back to the workspace's wall clock, which is what the coach
        // typed and what the form must show again.
        initial={{
          date: localDateKey(start, workspace.timezone),
          start: formatTime(start, workspace.timezone),
          end: formatTime(end, workspace.timezone),
        }}
      />
    </main>
  )
}
