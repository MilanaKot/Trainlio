import Link from 'next/link'
import { forbidden, notFound } from 'next/navigation'
import type { Route } from 'next'
import { getCoachWorkspace } from '@/server/sessions/queries'
import { getStatistics } from '@/server/stats/queries'
import { RoleChips } from '@/components/stats/role-chips'
import { StatTiles } from '@/components/stats/stat-tiles'
import { Avatar } from '@/components/ui/avatar'
import { PeriodControl } from '@/components/ui/period-control'
import { PersonCheckIcon } from '@/components/ui/status-toggle'
import { barTone, bucketKeys, bucketLabel, percent } from '@/lib/domain/stats'
import { parsePeriod } from '@/lib/period'
import { formatDateShort, formatTimeRange } from '@/lib/time/workspace-time'
import { messages } from '@/lib/i18n'
import { cn } from '@/lib/utils'

const t = messages.coach.stats

/**
 * K20b · one coach's statistics (coach/SPEC.md, handoff v3.5).
 *
 * A coach opens their own; an administrator anybody's. Anybody else is told
 * 403 — the database refuses the numbers (`NOT_AUTHORIZED`, migration 47), and
 * this page says so rather than passing it off as missing (coach test 28).
 */
export default async function CoachStatisticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ coachId: string }>
  searchParams: Promise<{ obdobi?: string; role?: string }>
}) {
  const { coachId } = await params
  const query = await searchParams
  const workspace = await getCoachWorkspace()
  if (!workspace) notFound()

  const period = parsePeriod(query.obdobi, 'month', new Date(), workspace.timezone)
  const mainOnly = query.role === 'hlavni'
  const result = await getStatistics(workspace.id, period, {
    coachId,
    mainOnly,
    personal: true,
    bucket: period.kind === 'season' ? 'month' : 'week',
  })
  if (!result.ok) {
    if (result.code === 'NOT_AUTHORIZED') forbidden()
    notFound()
  }
  const stats = result.data
  const coach = workspace.coaches.find((one) => one.id === coachId)
  const name = coach?.displayName ?? t.none

  // Every bucket of the period, so a week without a training is a gap.
  const lastDay = new Date(period.end.getTime() - 1)
  const lastDayOfMonth = Number(
    new Intl.DateTimeFormat('en-CA', { timeZone: workspace.timezone, day: 'numeric' }).format(
      lastDay,
    ),
  )
  const counts = new Map((stats.buckets ?? []).map((bucket) => [bucket.key, bucket]))
  const bars = bucketKeys(period.kind, period.year).map((key) => {
    const bucket = counts.get(key)
    return {
      key,
      label: bucketLabel(key, lastDayOfMonth),
      value: bucket ? percent(bucket.present, bucket.marked) : null,
    }
  })
  const chartCaption = period.kind === 'season' ? t.monthlyCaption : t.weeklyCaption
  const led = stats.led ?? []

  return (
    <main className="flex flex-col gap-4 pb-8">
      <Link
        href={
          (query.obdobi
            ? `/trener/statistiky?obdobi=${query.obdobi}`
            : '/trener/statistiky') as Route
        }
        className="flex min-h-11 items-center gap-1 self-start text-row text-muted"
      >
        <span aria-hidden="true">‹</span> {t.title}
      </Link>

      <header className="flex items-center gap-3">
        <Avatar firstName={name} size={48} />
        <div className="flex min-w-0 flex-col">
          <h1 className="truncate font-display text-[1.875rem]/[2.125rem] font-bold text-ink">
            {name}
          </h1>
          <p className="text-meta text-muted">{t.coachSubtitle}</p>
        </div>
      </header>

      <PeriodControl period={period} timezone={workspace.timezone} />
      <RoleChips mainOnly={mainOnly} />

      {stats.sessions === 0 ? (
        <p className="rounded-card bg-surface p-4 text-meta text-muted shadow-card">{t.empty}</p>
      ) : (
        <>
          <StatTiles
            stats={stats}
            sessionsLabel={t.sessionsWithMain.replace('{main}', String(stats.sessionsAsMain))}
          />

          <section className="flex flex-col gap-2">
            <h2 className="text-caption font-bold tracking-[0.05em] text-muted">{chartCaption}</h2>
            <div className="rounded-card bg-surface p-4 shadow-card">
              {/* The bars are a picture; the table under them is the same
                  numbers for a screen reader. */}
              <div
                role="img"
                aria-label={`${chartCaption}: ${bars
                  .map((bar) => `${bar.label} ${bar.value === null ? t.none : `${bar.value} %`}`)
                  .join(', ')}`}
                className={cn('flex h-36 items-end gap-2', period.kind === 'season' && 'gap-1')}
              >
                {bars.map((bar) => (
                  <div
                    key={bar.key}
                    className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
                  >
                    <span className="nums text-[0.6875rem] font-bold text-ink">
                      {bar.value === null ? '' : `${bar.value} %`}
                    </span>
                    <span
                      className={cn(
                        'block w-full rounded-t-[6px]',
                        bar.value === null
                          ? 'h-0.5 bg-line'
                          : barTone(bar.value) === 'success'
                            ? 'bg-success'
                            : 'bg-warning-fill',
                      )}
                      style={
                        bar.value === null
                          ? undefined
                          : { height: `${Math.max(4, bar.value * 0.8)}%` }
                      }
                    />
                    <span className="truncate text-[0.6875rem] text-muted">{bar.label}</span>
                  </div>
                ))}
              </div>
              <table className="sr-only">
                <caption>{chartCaption}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t.chartPeriod}</th>
                    <th scope="col">{t.attendance}</th>
                  </tr>
                </thead>
                <tbody>
                  {bars.map((bar) => (
                    <tr key={bar.key}>
                      <th scope="row">{bar.label}</th>
                      <td>{bar.value === null ? t.none : `${bar.value} %`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-caption font-bold tracking-[0.05em] text-muted">
              {t.ledCaption.replace('{count}', String(led.length))}
            </h2>
            {led.length > 0 ? (
              <ul className="flex flex-col rounded-card bg-surface px-3.5 shadow-card">
                {led.map((session) => {
                  const start = new Date(session.startAt)
                  const complete = session.present >= session.booked
                  return (
                    <li key={session.id} className="border-b border-line last:border-0">
                      <Link
                        href={`/trener/${session.id}` as Route}
                        className="flex min-h-15 items-center gap-3 py-2"
                      >
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="nums truncate text-row font-bold text-ink">
                            {formatDateShort(start, workspace.timezone)} ·{' '}
                            {formatTimeRange(start, new Date(session.endAt), workspace.timezone)}
                          </span>
                          <span className="truncate text-hint text-muted">
                            {t.ledMeta
                              .replace('{place}', session.facilityCode ?? t.none)
                              .replace('{booked}', String(session.booked))
                              .replace('{capacity}', String(session.capacity))}
                          </span>
                        </span>
                        <span
                          aria-label={t.ledPresent
                            .replace('{present}', String(session.present))
                            .replace('{booked}', String(session.booked))}
                          className={cn(
                            'nums flex items-center gap-1 text-meta font-bold',
                            complete ? 'text-success' : 'text-warning',
                          )}
                        >
                          <PersonCheckIcon className="size-4" />
                          <span aria-hidden="true">
                            {session.present}/{session.booked}
                          </span>
                        </span>
                        <span aria-hidden="true" className="text-subtle">
                          ›
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </section>
        </>
      )}
    </main>
  )
}
