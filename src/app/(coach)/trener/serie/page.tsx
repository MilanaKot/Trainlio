import Link from 'next/link'
import { listCoachSeries } from '@/server/sessions/queries'
import { formatLocalDateKey } from '@/lib/time/workspace-time'
import { messages, plural } from '@/lib/i18n'

export default async function SeriesListPage() {
  const series = await listCoachSeries()
  const t = messages.coach

  return (
    <main className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t.series}</h1>
        <Link
          href="/trener/serie/nova"
          className="flex min-h-11 items-center rounded-lg bg-black px-4 text-sm font-medium text-white dark:bg-white dark:text-black"
        >
          {t.newSeries}
        </Link>
      </div>

      {series.length === 0 ? (
        <p className="rounded-xl border border-dashed border-black/15 p-6 text-center text-sm opacity-70 dark:border-white/20">
          {t.noSeries}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {series.map((s) => (
            <li
              key={s.id}
              className="flex flex-col gap-1 rounded-xl border border-black/10 p-4 dark:border-white/15"
            >
              <span className="font-medium">
                {s.byWeekdays
                  .map((d) => t.weekdaysShort[String(d) as keyof typeof t.weekdaysShort])
                  .join(' ')}{' '}
                · {s.localStartTime}–{s.localEndTime} · {s.facilityCode}
              </span>
              <span className="text-sm opacity-70">
                {formatLocalDateKey(s.localDateFrom)} — {formatLocalDateKey(s.localDateTo)}
              </span>
              <span className="text-sm opacity-70">
                {plural(s.generatedCount, t.seriesGenerated)}
                {s.cancelledCount > 0
                  ? ` · ${s.cancelledCount} ${messages.session.cancelled.toLowerCase()}`
                  : ''}
                {/* The gaps the coach chose, so the list explains why the
                    pattern produced fewer sessions than the range suggests. */}
                {s.excludedDates.length > 0
                  ? ` · ${plural(s.excludedDates.length, t.seriesSkipped)}`
                  : ''}
              </span>
              {/* Provenance, not a live template: this is the zone the existing
                  occurrences were generated under, whatever the workspace uses now. */}
              <span className="text-xs opacity-50">
                {t.generatedIn.replace('{timezone}', s.generatedInTimezone)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="text-sm opacity-70">{t.seriesIndependent}</p>
    </main>
  )
}
