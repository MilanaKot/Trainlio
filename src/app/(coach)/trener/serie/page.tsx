import Link from 'next/link'
import { listCoachSeries } from '@/server/sessions/queries'
import { buttonVariants } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { formatLocalDateKey } from '@/lib/time/workspace-time'
import { messages, plural } from '@/lib/i18n'

const t = messages.coach

/**
 * The series a coach has created.
 *
 * Not in the design handoff, which stops at creating one. It exists because
 * the occurrences are independent the moment they are made (PRD §16): this is
 * the record of what was generated from what, and the only place a coach can
 * see that a pattern skipped three Sundays on purpose.
 */
export default async function SeriesListPage() {
  const series = await listCoachSeries()

  return (
    <main className="flex flex-col gap-5">
      <Link href="/trener" className="flex min-h-11 items-center text-row text-muted">
        ‹ {t.sessionsTitle}
      </Link>

      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-form-title font-bold text-ink">{t.series}</h1>
        <Link href="/trener/serie/nova" className={buttonVariants({ size: 'md' })}>
          {t.newSeries}
        </Link>
      </div>

      {series.length === 0 ? (
        <EmptyState
          action={
            <Link href="/trener/serie/nova" className={buttonVariants({ size: 'md' })}>
              {t.createSeries}
            </Link>
          }
        >
          {t.noSeries}
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {series.map((s) => (
            <li key={s.id} className="flex flex-col gap-1 rounded-card bg-surface p-4 shadow-card">
              <span className="text-row font-semibold text-ink">
                {s.byWeekdays
                  .map((d) => t.weekdaysShort[String(d) as keyof typeof t.weekdaysShort])
                  .join(' ')}{' '}
                · {s.localStartTime}–{s.localEndTime} · {s.facilityCode}
              </span>
              <span className="text-meta text-muted">
                {formatLocalDateKey(s.localDateFrom)} — {formatLocalDateKey(s.localDateTo)}
              </span>
              <span className="text-meta text-muted">
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
              <span className="text-hint text-muted">
                {t.generatedIn.replace('{timezone}', s.generatedInTimezone)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="text-hint text-muted">{t.seriesIndependent}</p>
    </main>
  )
}
