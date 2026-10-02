import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getCoachSeries, getCoachWorkspace, listSeriesSessions } from '@/server/sessions/queries'
import { CoachTrainingRow } from '@/components/session/coach-training-row'
import { SeriesSessionsTabs } from '@/components/session/series-sessions-tabs'
import { WeekdayBadges } from '@/components/ui/weekday-badges'
import { eligibilityLabel } from '@/lib/domain/session'
import { formatLocalDateShort } from '@/lib/time/workspace-time'
import { messages } from '@/lib/i18n'

const t = messages.coach

/**
 * The trainings one series produced (coach/SPEC.md §K16).
 *
 * A filtered list and nothing more. There is no edit action anywhere on this
 * screen, and the footer says so: the occurrences are independent the moment
 * they are created, so a coach who wants Tuesday an hour later opens Tuesday.
 */
export default async function SeriesSessionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ seriesId: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const [{ seriesId }, { tab }, workspace] = await Promise.all([
    params,
    searchParams,
    getCoachWorkspace(),
  ])
  if (!workspace) notFound()

  const [series, sessions] = await Promise.all([
    getCoachSeries(seriesId),
    listSeriesSessions(seriesId),
  ])
  if (!series) notFound()

  const now = new Date().getTime()
  const upcoming = sessions.filter((s) => new Date(s.endAt).getTime() >= now)
  const past = sessions.filter((s) => new Date(s.endAt).getTime() < now).reverse()

  const showingPast = tab === 'minule'
  const shown = showingPast ? past : upcoming

  const days = series.byWeekdays
    .map((day) => t.weekdays[String(day) as keyof typeof t.weekdays])
    .join(' a ')
    .toLocaleLowerCase('cs-CZ')

  const years = eligibilityLabel(
    series.eligibilityMode,
    series.birthYearFrom,
    series.birthYearTo,
    t.eligibilityAllShort,
  )

  return (
    <main className="flex flex-col gap-5 pb-8">
      <Link href="/trener/serie" className="flex min-h-11 items-center gap-1 text-row text-muted">
        <span aria-hidden="true">‹</span> {t.seriesBack}
      </Link>

      <header className="flex flex-col gap-2">
        <WeekdayBadges weekdays={series.byWeekdays} />
        <h1 className="nums font-display text-page font-bold text-ink">
          {series.localStartTime}–{series.localEndTime}
        </h1>
        <p className="text-row font-semibold text-ink">
          {/* `úterý a čtvrtek`, capitalised as a sentence rather than as a list
              of proper nouns — Czech weekday names are not. */}
          {days.charAt(0).toLocaleUpperCase('cs-CZ') + days.slice(1)} ·{' '}
          {formatLocalDateShort(series.localDateFrom)} – {formatLocalDateShort(series.localDateTo)}
        </p>
        <p className="text-meta text-muted">
          {[series.facilityName || series.facilityCode, series.changingRoom, years]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </header>

      <SeriesSessionsTabs
        seriesId={seriesId}
        value={showingPast ? 'past' : 'upcoming'}
        upcoming={upcoming.length}
        past={past.length}
      />

      {shown.length === 0 ? (
        <p className="text-row text-muted">
          {showingPast ? t.noPastSessions : t.athleteNoUpcoming}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((session) => (
            <CoachTrainingRow
              key={session.id}
              session={session}
              timezone={workspace.timezone}
              variant={showingPast ? 'past' : 'upcoming'}
              showEdited
            />
          ))}
        </ul>
      )}

      <p className="text-hint text-muted">{t.seriesNoEdit}</p>
    </main>
  )
}
