import { notFound } from 'next/navigation'
import { getCoachWorkspace } from '@/server/sessions/queries'
import { SessionForm } from '@/components/session/session-form'
import { localDateKey } from '@/lib/time/workspace-time'
import { messages } from '@/lib/i18n'

const t = messages.coach

/**
 * A new training (coach/SPEC.md §K3, in its create form).
 *
 * Everything a coach types every time is already filled in: today's date in the
 * club's timezone, the first hall, ten places, themselves as main coach, and
 * the note this club sends with every training. The form says it is a starting
 * point; none of it is a decision the coach cannot undo before saving.
 */
export default async function NewSessionPage() {
  const workspace = await getCoachWorkspace()
  if (!workspace) notFound()

  const facility = workspace.facilities[0]

  return (
    <main className="flex flex-col gap-4">
      <SessionForm
        workspace={workspace}
        initial={{
          // Today in the workspace timezone, not the server's: a coach adding a
          // session late in the evening should see today's date, not tomorrow's.
          date: localDateKey(new Date(), workspace.timezone),
          start: '09:00',
          end: '10:00',
          locationName: facility?.locationName ?? '',
          facilityId: facility?.id ?? '',
          changingRoom: '',
          capacity: 10,
          eligibilityMode: 'ALL',
          birthYearFrom: '',
          birthYearTo: '',
          mainCoachId: workspace.coaches[0]?.id ?? '',
          assistantIds: [],
          publicNotes: t.publicNotesDefault,
          internalNotes: '',
        }}
      />
    </main>
  )
}
