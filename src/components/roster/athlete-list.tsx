'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Avatar } from '@/components/ui/avatar'
import { EmptyState } from '@/components/ui/empty-state'
import { YearGrid } from '@/components/ui/filter-chips'
import { SearchField } from '@/components/ui/search-field'
import { matchesName } from '@/lib/domain/roster'
import { HOCKEY_POSITION_LABELS, type HockeyPosition } from '@/lib/enums/hockey'
import { messages, plural } from '@/lib/i18n'
import type { CoachAthlete } from '@/server/roster/queries'

const t = messages.coach

const COLLATOR = new Intl.Collator('cs')

/**
 * The club's athletes (coach/SPEC.md §K12).
 *
 * Grouped by birth year, because that is how a coach thinks about a club: the
 * question is rarely "where is Novák" and usually "who is in 2017 and has
 * nothing booked".
 *
 * The search matches the parents' names as well as the athlete's. A coach who
 * met the family at the rink remembers "Procházková" more often than the
 * child's surname, and both are the same one filter to type into.
 *
 * Filtering here rather than on the server: a club is tens of athletes, the
 * list is already on the page, and a round trip per keystroke would make the
 * search feel slower than scrolling.
 *
 * v3.6 (decision 49): the years are a YearGrid, newest first, every one in
 * sight with its count of active athletes. The choice is component state and
 * nothing else, so every visit starts on `Všechny`.
 */
export function AthleteList({ athletes }: { athletes: CoachAthlete[] }) {
  const [query, setQuery] = useState('')
  const [year, setYear] = useState<string>('all')

  const years = useMemo(() => {
    const counts = new Map<number, number>()
    for (const athlete of athletes) {
      if (athlete.isActive) counts.set(athlete.birthYear, (counts.get(athlete.birthYear) ?? 0) + 1)
    }
    return [...counts].sort(([a], [b]) => b - a)
  }, [athletes])
  const activeTotal = athletes.filter((a) => a.isActive).length

  const matching = athletes.filter((athlete) => {
    const names = [`${athlete.firstName} ${athlete.lastName}`, ...athlete.guardianNames]
    if (!names.some((name) => matchesName(name, query))) return false
    return year === 'all' || String(athlete.birthYear) === year
  })

  const active = matching.filter((a) => a.isActive)
  const inactive = matching.filter((a) => !a.isActive)

  const groups = [...new Set(active.map((a) => a.birthYear))]
    .sort((a, b) => b - a)
    .map((birthYear) => ({
      birthYear,
      items: active
        .filter((a) => a.birthYear === birthYear)
        .sort(
          (a, b) =>
            COLLATOR.compare(a.lastName, b.lastName) || COLLATOR.compare(a.firstName, b.firstName),
        ),
    }))

  const header = (
    <header className="flex items-baseline justify-between gap-3">
      <h1 className="font-display text-page font-bold text-ink">{t.athletesTitle}</h1>
      {athletes.length > 0 ? (
        <span className="text-meta text-muted">
          {year === 'all'
            ? String(activeTotal)
            : t.athletesShown
                .replace('{shown}', String(active.length))
                .replace('{count}', String(activeTotal))}
        </span>
      ) : null}
    </header>
  )

  if (athletes.length === 0)
    return (
      <>
        {header}
        <EmptyState>{t.athletesEmpty}</EmptyState>
      </>
    )

  return (
    <div className="flex flex-col gap-4">
      {header}
      <SearchField value={query} onChange={setQuery} label={t.athletesSearch} />

      <YearGrid
        label={t.athletesYearFilter}
        value={year}
        onChange={setYear}
        options={[
          { value: 'all', label: t.athletesAllYears },
          ...years.map(([y, count]) => ({ value: String(y), label: String(y), count })),
        ]}
      />

      {matching.length === 0 ? <p className="text-row text-muted">{t.athletesNoMatch}</p> : null}

      {groups.map((group) => (
        <section key={group.birthYear} className="flex flex-col gap-2">
          <h2 className="flex items-baseline justify-between gap-2">
            <span className="text-date font-bold text-primary">
              {t.athletesYear.replace('{year}', String(group.birthYear))}
            </span>
            <span className="text-hint text-muted">
              {plural(group.items.length, t.athletesCount)}
            </span>
          </h2>

          <ul className="flex flex-col rounded-card bg-surface px-3 shadow-card">
            {group.items.map((athlete) => (
              <AthleteRow key={athlete.id} athlete={athlete} />
            ))}
          </ul>
        </section>
      ))}

      {inactive.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-date font-bold text-muted">{t.athletesInactiveGroup}</h2>
          <ul className="flex flex-col rounded-card bg-surface px-3 shadow-card">
            {inactive.map((athlete) => (
              <AthleteRow key={athlete.id} athlete={athlete} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

function AthleteRow({ athlete }: { athlete: CoachAthlete }) {
  const position = athlete.positionCode
    ? HOCKEY_POSITION_LABELS[athlete.positionCode as HockeyPosition]
    : t.athletesNoPosition

  // A deactivated athlete says why they are in this group; an active one says
  // what a coach is looking for — their position and whether they are booked
  // into anything.
  const meta = athlete.isActive
    ? [
        position,
        athlete.upcomingCount === 0
          ? t.athletesNoBookings
          : plural(athlete.upcomingCount, t.athletesUpcoming),
      ].join(' · ')
    : t.athletesDeactivated.replace('{year}', String(athlete.birthYear))

  return (
    <li className="border-b border-line last:border-0">
      <Link
        href={`/trener/sportovci/${athlete.id}`}
        className="flex min-h-16 items-center gap-3 py-3"
      >
        <Avatar
          firstName={athlete.firstName}
          lastName={athlete.lastName}
          size={40}
          muted={!athlete.isActive}
        />
        <span className="flex min-w-0 flex-col">
          <span
            className={`truncate text-row font-semibold ${athlete.isActive ? 'text-ink' : 'text-muted'}`}
          >
            {athlete.firstName} {athlete.lastName}
          </span>
          <span className="truncate text-meta text-muted">{meta}</span>
        </span>
        <span className="ml-auto text-subtle" aria-hidden="true">
          ›
        </span>
      </Link>
    </li>
  )
}
