import { notFound } from 'next/navigation'
import { getCoachSession, getCoachWorkspace, getSessionCoaches } from '@/server/sessions/queries'
import { SeriesForm } from '@/components/session/series-form'
import type { SessionFormValues } from '@/components/session/training-fields'
import { formatDateShort, formatTime, localDateKey } from '@/lib/time/workspace-time'
import { messages } from '@/lib/i18n'

const t = messages.coach

/**
 * A season of trainings (coach/SPEC.md §K11), and a copy of one training over
 * a period (§K4b) — the same screen, because they differ only in where the
 * settings came from.
 */
export default async function NewSeriesPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>
}) {
  const { from } = await searchParams
  const workspace = await getCoachWorkspace()
  if (!workspace) notFound()

  const today = localDateKey(new Date(), workspace.timezone)
  const facility = workspace.facilities[0]

  const blank: SessionFormValues = {
    date: '',
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
  }

  if (!from) {
    return (
      <main className="flex flex-col gap-4">
        <SeriesForm workspace={workspace} today={today} initial={blank} />
      </main>
    )
  }

  const source = await getCoachSession(from)
  if (!source) notFound()

  const coaches = await getSessionCoaches(from)
  const start = new Date(source.startAt)
  const end = new Date(source.endAt)
  const sourceFacility = workspace.facilities.find((f) => f.code === source.facilityCode)

  return (
    <main className="flex flex-col gap-4">
      <SeriesForm
        workspace={workspace}
        today={today}
        source={{
          id: from,
          label: `${formatDateShort(start, workspace.timezone)} · ${formatTime(start, workspace.timezone)}`,
        }}
        initial={{
          ...blank,
          // The weekday the copied training falls on is the one preselected;
          // the range starts empty of it, because a period is not a repeat of
          // a date but a pattern the coach still chooses.
          date: localDateKey(start, workspace.timezone),
          start: formatTime(start, workspace.timezone),
          end: formatTime(end, workspace.timezone),
          locationName: source.locationName,
          facilityId: sourceFacility?.id ?? blank.facilityId,
          changingRoom: source.changingRoom ?? '',
          capacity: source.capacity,
          eligibilityMode: source.eligibilityMode,
          birthYearFrom: source.birthYearFrom ? String(source.birthYearFrom) : '',
          birthYearTo: source.birthYearTo ? String(source.birthYearTo) : '',
          mainCoachId: source.mainCoachId,
          assistantIds: coaches
            .filter((coach) => coach.role === 'ASSISTANT')
            .map((coach) => coach.profileId),
          publicNotes: source.publicNotes ?? '',
          internalNotes: source.internalNotes ?? '',
        }}
      />
    </main>
  )
}
