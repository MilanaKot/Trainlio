import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getCoachSession, getCoachWorkspace, getSessionCoaches } from '@/server/sessions/queries'
import { SessionForm, type SessionFormValues } from '@/components/session/session-form'
import { Notice } from '@/components/ui/notice'
import { formatDateShort, formatTime, localDateKey } from '@/lib/time/workspace-time'
import { messages } from '@/lib/i18n'

const t = messages.coach

function CopyIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="size-4" aria-hidden="true">
      <rect x="5.5" y="5.5" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.5 3.5h-7a1 1 0 00-1 1v7" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

/**
 * A new training, and the same screen as a copy of one (coach/SPEC.md §K3, §K4).
 *
 * The copy is the form, prefilled and with the date deliberately empty: a
 * duplicate is never one tap, because the one thing that must differ is the one
 * thing a copy cannot supply. Nothing is created until a date is chosen, and
 * the notice says what does not come with it.
 */
export default async function NewSessionPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>
}) {
  const { from } = await searchParams
  const workspace = await getCoachWorkspace()
  if (!workspace) notFound()

  const facility = workspace.facilities[0]

  const blank: SessionFormValues = {
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
  }

  if (!from) {
    return (
      <main className="flex flex-col gap-4">
        <SessionForm workspace={workspace} initial={blank} />
      </main>
    )
  }

  const source = await getCoachSession(from)
  if (!source) notFound()

  const coaches = await getSessionCoaches(from)
  const start = new Date(source.startAt)
  const end = new Date(source.endAt)
  const sourceFacility = workspace.facilities.find((f) => f.code === source.facilityCode)
  const label = `${formatDateShort(start, workspace.timezone)} · ${formatTime(start, workspace.timezone)}`

  return (
    <main className="flex flex-col gap-4">
      <SessionForm
        workspace={workspace}
        requireDate
        initial={{
          ...blank,
          date: '',
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
        notice={
          <div className="flex flex-col gap-3">
            <Notice
              variant="info"
              icon={<CopyIcon />}
              title={t.duplicateNotice.replace('{source}', label)}
            >
              {t.duplicateNoticeAction}
            </Notice>

            {/* One termín or a period: two different jobs, and the second one
                is the series form with the same training copied into it. */}
            <div
              role="tablist"
              aria-label={t.duplicateTitle}
              className="flex gap-1 rounded-control-lg bg-neutral-50 p-1"
            >
              <span
                role="tab"
                aria-selected="true"
                className="flex min-h-11 flex-1 items-center justify-center rounded-[9px] bg-surface text-row text-ink shadow-card"
              >
                {t.duplicateOne}
              </span>
              <Link
                role="tab"
                aria-selected="false"
                href={{ pathname: '/trener/serie/nova', query: { from } }}
                className="flex min-h-11 flex-1 items-center justify-center rounded-[9px] text-row text-muted"
              >
                {t.duplicatePeriod}
              </Link>
            </div>
          </div>
        }
      />
    </main>
  )
}
