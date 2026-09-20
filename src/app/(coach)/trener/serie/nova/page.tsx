import { notFound } from 'next/navigation'
import { getCoachWorkspace } from '@/server/sessions/queries'
import { SeriesForm } from '@/components/session/series-form'
import { localDateKey } from '@/lib/time/workspace-time'
import { messages } from '@/lib/i18n'

export default async function NewSeriesPage() {
  const workspace = await getCoachWorkspace()
  if (!workspace) notFound()

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{messages.coach.newSeriesTitle}</h1>
      <SeriesForm workspace={workspace} today={localDateKey(new Date(), workspace.timezone)} />
    </main>
  )
}
