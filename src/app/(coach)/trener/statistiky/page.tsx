import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Route } from 'next'
import { getCoachWorkspace } from '@/server/sessions/queries'
import { listCoachAthletes } from '@/server/roster/queries'
import { getStatistics } from '@/server/stats/queries'
import { SelectChip } from '@/components/stats/select-chip'
import { StatTiles } from '@/components/stats/stat-tiles'
import { Avatar } from '@/components/ui/avatar'
import { PeriodControl } from '@/components/ui/period-control'
import { DollarIcon } from '@/components/ui/status-toggle'
import { attendanceTone, percent } from '@/lib/domain/stats'
import { parsePeriod } from '@/lib/period'
import { messages, plural } from '@/lib/i18n'
import { cn } from '@/lib/utils'

const t = messages.coach.stats

const TOP = 3

/**
 * K20 · Statistiky (coach/SPEC.md, handoff v3.5, decision 48).
 *
 * Every coach reads the club's numbers for a month or a season, narrowed by a
 * birth year or a coach; only an administrator sees `Trenéři` and, from it,
 * another coach's K20b. The counting is the database's (migration 47).
 */
export default async function StatisticsPage({
  searchParams,
}: {
  searchParams: Promise<{ obdobi?: string; rocnik?: string; trener?: string; seznam?: string }>
}) {
  const query = await searchParams
  const workspace = await getCoachWorkspace()
  if (!workspace) notFound()

  const period = parsePeriod(query.obdobi, 'month', new Date(), workspace.timezone)
  const athletes = await listCoachAthletes(workspace.id)
  const years = [...new Set(athletes.filter((a) => a.isActive).map((a) => a.birthYear))].sort(
    (a, b) => b - a,
  )
  const birthYear = years.includes(Number(query.rocnik)) ? Number(query.rocnik) : null
  const coachId = workspace.coaches.some((c) => c.id === query.trener)
    ? (query.trener ?? null)
    : null

  const result = await getStatistics(workspace.id, period, { birthYear, coachId })
  if (!result.ok) notFound()
  const stats = result.data

  const unpaidTotal = stats.unpaid.reduce((sum, row) => sum + row.count, 0)
  const unpaid = query.seznam === 'nezaplaceno' ? stats.unpaid : stats.unpaid.slice(0, TOP)
  // The top three are those who missed something: a child at 100 % is not
  // anybody's lowest attendance. `Všichni hráči` lists everyone.
  const missed = stats.attendance.filter((row) => row.present < row.marked)
  const lowest = query.seznam === 'dochazka' ? stats.attendance : missed.slice(0, TOP)
  const toggle = (list: string) => {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(query))
      if (value && key !== 'seznam') search.set(key, value)
    if (query.seznam !== list) search.set('seznam', list)
    const text = search.toString()
    return (text ? `/trener/statistiky?${text}` : '/trener/statistiky') as Route
  }

  return (
    <main className="flex flex-col gap-4 pb-8">
      <Link
        href="/trener/vice"
        className="flex min-h-11 items-center gap-1 self-start text-row text-muted"
      >
        <span aria-hidden="true">‹</span> {t.back}
      </Link>
      <h1 className="font-display text-page font-bold text-ink">{t.title}</h1>

      <PeriodControl period={period} timezone={workspace.timezone} />

      {/* Two halves of one row, whatever they say: a chip that shrank to
          `Ročník 2017` used to pull the coach chip across the screen. */}
      <div className="grid grid-cols-2 gap-2">
        <SelectChip
          param="rocnik"
          label={t.yearFilter}
          value={birthYear ? String(birthYear) : ''}
          options={[
            { value: '', label: t.allYears },
            ...years.map((year) => ({
              value: String(year),
              label: t.yearOption.replace('{year}', String(year)),
            })),
          ]}
        />
        <SelectChip
          param="trener"
          label={t.coachFilter}
          value={coachId ?? ''}
          options={[
            { value: '', label: t.allCoaches },
            ...workspace.coaches.map((coach) => ({
              value: coach.id,
              label: coach.displayName ?? t.none,
            })),
          ]}
        />
      </div>

      {stats.sessions === 0 ? (
        <p className="rounded-card bg-surface p-4 text-meta text-muted shadow-card">{t.empty}</p>
      ) : (
        <>
          <StatTiles stats={stats} />

          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-caption font-bold tracking-[0.05em] text-muted">
                {plural(unpaidTotal, t.unpaidCaption)}
              </h2>
              {stats.unpaid.length > TOP ? (
                <Link
                  href={toggle('nezaplaceno')}
                  className="flex min-h-11 items-center text-meta font-bold text-primary"
                >
                  {query.seznam === 'nezaplaceno' ? t.showLess : t.all}
                </Link>
              ) : null}
            </div>
            {unpaid.length === 0 ? (
              <p className="text-meta text-muted">{t.unpaidNone}</p>
            ) : (
              <ul className="flex flex-col rounded-card bg-surface px-3.5 shadow-card">
                {unpaid.map((row) => (
                  <li key={row.athleteId} className="border-b border-line last:border-0">
                    <Link
                      href={`/trener/sportovci/${row.athleteId}` as Route}
                      className="flex min-h-15 items-center gap-3 py-2"
                    >
                      <Avatar firstName={row.firstName} lastName={row.lastName} size={36} />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-row font-bold text-ink">
                          {row.firstName} {row.lastName}
                        </span>
                        <span className="text-hint text-muted">{row.birthYear}</span>
                      </span>
                      <span className="flex items-center gap-1 text-meta font-bold text-danger">
                        <DollarIcon className="size-3.5" />
                        {plural(row.count, t.unpaidCount)}
                      </span>
                      <span aria-hidden="true" className="text-subtle">
                        ›
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Shown under every filter: with one coach chosen it ranks the
              children by that coach's trainings (product request). */}
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-caption font-bold tracking-[0.05em] text-muted">
                {t.lowestCaption}
              </h2>
              {stats.attendance.length > lowest.length || query.seznam === 'dochazka' ? (
                <Link
                  href={toggle('dochazka')}
                  className="flex min-h-11 items-center text-meta font-bold text-primary"
                >
                  {query.seznam === 'dochazka' ? t.showLess : t.allPlayers}
                </Link>
              ) : null}
            </div>
            {lowest.length === 0 ? (
              <p className="text-meta text-muted">
                {stats.attendance.length === 0 ? t.lowestNone : t.lowestAllPresent}
              </p>
            ) : (
              <ul className="flex flex-col rounded-card bg-surface px-3.5 shadow-card">
                {lowest.map((row) => {
                  const value = percent(row.present, row.marked) ?? 0
                  const tone = attendanceTone(value)
                  return (
                    <li key={row.athleteId} className="border-b border-line last:border-0">
                      <Link
                        href={`/trener/sportovci/${row.athleteId}` as Route}
                        className="flex min-h-15 items-center gap-3 py-2"
                      >
                        <Avatar firstName={row.firstName} lastName={row.lastName} size={36} />
                        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-row font-bold text-ink">
                              {row.firstName} {row.lastName}
                            </span>
                            <span
                              className={cn(
                                'nums font-display text-[1.0625rem] font-bold',
                                tone === 'danger'
                                  ? 'text-danger'
                                  : tone === 'warning'
                                    ? 'text-warning'
                                    : 'text-ink',
                              )}
                            >
                              {value} %
                            </span>
                          </span>
                          <Bar
                            value={value}
                            tone={
                              tone === 'danger'
                                ? 'danger'
                                : tone === 'warning'
                                  ? 'warning'
                                  : 'success'
                            }
                          />
                        </span>
                        <span aria-hidden="true" className="text-subtle">
                          ›
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {stats.coaches ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-caption font-bold tracking-[0.05em] text-muted">
                {t.coachesCaption}
              </h2>
              <ul className="flex flex-col rounded-card bg-surface px-3.5 shadow-card">
                {stats.coaches.map((coach) => {
                  const value = percent(coach.present, coach.marked)
                  return (
                    <li key={coach.profileId} className="border-b border-line last:border-0">
                      <Link
                        href={
                          `/trener/statistiky/trener/${coach.profileId}?obdobi=${query.obdobi ?? ''}` as Route
                        }
                        className="flex min-h-15 items-center gap-3 py-2"
                      >
                        <Avatar firstName={coach.name ?? '?'} size={36} />
                        <span className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-row font-bold text-ink">
                              {coach.name ?? t.none}
                            </span>
                            <span className="nums text-row font-bold text-ink">
                              {value === null ? t.none : `${value} %`}
                            </span>
                          </span>
                          <span className="text-hint text-muted">
                            {plural(coach.sessions, t.coachSessions)}
                          </span>
                          <Bar value={value ?? 0} tone="success" />
                        </span>
                        <span aria-hidden="true" className="text-subtle">
                          ›
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </section>
          ) : null}
        </>
      )}

      <p className="text-hint text-muted">{t.footnote}</p>
    </main>
  )
}

function Bar({ value, tone }: { value: number; tone: 'success' | 'warning' | 'danger' }) {
  return (
    <span
      className="block h-1.5 w-full overflow-hidden rounded-full bg-neutral-50"
      aria-hidden="true"
    >
      <span
        className={cn(
          'block h-full rounded-full',
          tone === 'success' ? 'bg-success' : tone === 'warning' ? 'bg-warning-fill' : 'bg-danger',
        )}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </span>
  )
}
