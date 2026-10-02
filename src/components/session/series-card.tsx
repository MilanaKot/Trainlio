import Link from 'next/link'
import { WeekdayBadges } from '@/components/ui/weekday-badges'
import { eligibilityLabel } from '@/lib/domain/session'
import { formatLocalDateShort } from '@/lib/time/workspace-time'
import { messages } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { CoachSeries } from '@/server/sessions/queries'

const t = messages.coach

/**
 * One series in the list (coach/SPEC.md §K15, DESIGN_SYSTEM §6.29).
 *
 * The whole card opens the trainings it made, because that is the only thing
 * there is to do with a series: it is provenance, not a template, and nothing
 * in the product edits one after it has run.
 */
export function SeriesCard({ series, ended = false }: { series: CoachSeries; ended?: boolean }) {
  const years = eligibilityLabel(
    series.eligibilityMode,
    series.birthYearFrom,
    series.birthYearTo,
    t.eligibilityAllShort,
  )

  const place = [series.facilityCode, series.changingRoom, years].filter(Boolean).join(' · ')

  const range = `${formatLocalDateShort(series.localDateFrom)} – ${formatLocalDateShort(series.localDateTo)}`
  const counts = ended
    ? t.seriesTotal.replace('{total}', String(series.activeCount))
    : t.seriesRemaining
        .replace('{total}', String(series.activeCount))
        .replace('{remaining}', String(series.remainingCount))

  return (
    <li>
      <Link
        href={`/trener/serie/${series.id}`}
        className={cn(
          'flex flex-col gap-1.5 rounded-card p-4',
          ended
            ? 'bg-neutral-50 shadow-[inset_0_0_0_1px_var(--color-line)]'
            : 'bg-surface shadow-card',
        )}
      >
        <WeekdayBadges weekdays={series.byWeekdays} />
        <span className={cn('nums text-sheet-title font-bold', ended ? 'text-muted' : 'text-ink')}>
          {series.localStartTime}–{series.localEndTime}
        </span>
        <span className="text-meta text-muted">{place}</span>
        <span className="text-meta text-muted">
          {range} · {counts}
        </span>
      </Link>
    </li>
  )
}
