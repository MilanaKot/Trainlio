import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getCoachWorkspace, listCoachSeries } from '@/server/sessions/queries'
import { SeriesCard } from '@/components/session/series-card'
import { buttonVariants } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { messages } from '@/lib/i18n'

const t = messages.coach

/**
 * The series a coach has created (coach/SPEC.md §K15, §K15b).
 *
 * Split by whether anything is still to come rather than by the pattern's end
 * date: a series whose last three trainings were cancelled is over, whatever
 * its range says.
 *
 * Nothing here edits a series. The occurrences are independent from the moment
 * they are made (PRD §16), so this is the record of what produced what — and
 * the way into the trainings it produced.
 */
export default async function SeriesListPage() {
  const workspace = await getCoachWorkspace()
  if (!workspace) notFound()

  const series = await listCoachSeries()
  const running = series.filter((s) => s.remainingCount > 0)
  const ended = series.filter((s) => s.remainingCount === 0)

  return (
    <main className="flex flex-col gap-5 pb-8">
      <Link href="/trener/vice" className="flex min-h-11 items-center gap-1 text-row text-muted">
        <span aria-hidden="true">‹</span> {messages.more.title}
      </Link>

      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-page font-bold text-ink">{t.seriesTitle}</h1>
        <Link
          href="/trener/serie/nova"
          className={`${buttonVariants({ size: 'md' })} whitespace-nowrap`}
        >
          {t.newSeries}
        </Link>
      </div>

      {series.length === 0 ? (
        <EmptyState
          body={t.seriesEmptyBody}
          action={
            <Link href="/trener/serie/nova" className={buttonVariants({ size: 'md' })}>
              {t.newSeries}
            </Link>
          }
        >
          {t.noSeries}
        </EmptyState>
      ) : (
        <>
          <p className="text-hint text-muted">{t.seriesHelper}</p>

          {running.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-caption font-bold uppercase tracking-[0.8px] text-muted">
                {t.seriesRunning.replace('{count}', String(running.length))}
              </h2>
              <ul className="flex flex-col gap-2">
                {running.map((item) => (
                  <SeriesCard key={item.id} series={item} />
                ))}
              </ul>
            </section>
          ) : null}

          {ended.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-caption font-bold uppercase tracking-[0.8px] text-muted">
                {t.seriesEnded.replace('{count}', String(ended.length))}
              </h2>
              <ul className="flex flex-col gap-2">
                {ended.map((item) => (
                  <SeriesCard key={item.id} series={item} ended />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </main>
  )
}
