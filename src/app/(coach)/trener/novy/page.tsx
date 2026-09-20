import { notFound } from 'next/navigation'
import { getCoachWorkspace } from '@/server/sessions/queries'
import { SessionForm } from '@/components/session/session-form'
import { localDateKey } from '@/lib/time/workspace-time'
import { messages } from '@/lib/i18n'

export default async function NewSessionPage() {
  const workspace = await getCoachWorkspace()
  if (!workspace) notFound()

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{messages.coach.newSessionTitle}</h1>
      <SessionForm
        workspace={workspace}
        // Today in the workspace timezone, not the server's: a coach adding a
        // session late in the evening should see today's date, not tomorrow's.
        initial={{
          date: localDateKey(new Date(), workspace.timezone),
          start: '09:00',
          end: '10:00',
        }}
      />
    </main>
  )
}
