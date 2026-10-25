'use client'

import { useState, useSyncExternalStore } from 'react'
import { messages } from '@/lib/i18n'
import { sessionRole } from '@/lib/domain/coach-rights'
import { groupByLocalDay } from '@/lib/domain/session-list'
import { formatDateGroup, localDateKey, relativeDayLabel } from '@/lib/time/workspace-time'
import { CoachTrainingRow } from '@/components/session/coach-training-row'
import { TodayChip } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { FilterChips } from '@/components/ui/filter-chips'
import type { CoachSession } from '@/server/sessions/queries'

const t = messages.coach

type Filter = 'all' | 'mine'

// Storage fires `storage` only in other tabs, so this tab announces its own
// writes to the same listeners.
const CHANGED = 'trainlio:coach-filter'

function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange)
  window.addEventListener(CHANGED, onChange)
  return () => {
    window.removeEventListener('storage', onChange)
    window.removeEventListener(CHANGED, onChange)
  }
}

function read(key: string): Filter | null {
  try {
    const stored = window.localStorage.getItem(key)
    return stored === 'all' || stored === 'mine' ? stored : null
  } catch {
    return null
  }
}

/**
 * The coach's list under its `Všechny` / `Moje` filter (coach/SPEC.md §K1,
 * §K1b, §K14, v3.2).
 *
 * `Moje` is every training the signed-in coach leads or assists. The choice is
 * remembered per person on this device; with nothing remembered, a coach who
 * may edit everything starts on `Všechny` and one who may not on `Moje`, the
 * list that is theirs. The same choice applies to `Minulé`.
 *
 * Storage can be missing or refuse (a private window, blocked site data), so
 * every read and write is guarded and the list works without it.
 */
export function CoachSessionList({
  sessions,
  me,
  defaultFilter,
  timezone,
  variant,
  now,
}: {
  sessions: CoachSession[]
  me: string
  defaultFilter: Filter
  timezone: string
  variant: 'upcoming' | 'past'
  /** The server's clock, so the `Dnes` chip agrees with the rest of the page. */
  now: string
}) {
  const key = `trainlio:coach-filter:${me}`
  // The server renders the default; the browser then shows what was remembered.
  const stored = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  )
  // What was tapped on this page, which holds even when storage refuses it.
  const [picked, setPicked] = useState<Filter | null>(null)
  const filter = picked ?? stored ?? defaultFilter

  function choose(next: Filter) {
    setPicked(next)
    try {
      window.localStorage.setItem(key, next)
      window.dispatchEvent(new Event(CHANGED))
    } catch {
      // No storage: remembered for this page only.
    }
  }

  const shown =
    filter === 'mine' ? sessions.filter((session) => sessionRole(me, session) !== null) : sessions
  const days = groupByLocalDay(shown, (session) =>
    localDateKey(new Date(session.startAt), timezone),
  )
  const today = new Date(now)

  return (
    <>
      <FilterChips
        label={t.filterLabel}
        options={[
          { value: 'all', label: t.filterAll },
          { value: 'mine', label: t.filterMine },
        ]}
        value={filter}
        onChange={choose}
      />

      {shown.length === 0 ? (
        <EmptyState>{variant === 'past' ? t.noPastSessionsMine : t.noSessionsMine}</EmptyState>
      ) : (
        days.map((day) => {
          const at = new Date(day.items[0]!.startAt)

          return (
            <section key={day.key} className="flex flex-col gap-3">
              <h2 className="flex items-center gap-2 text-date font-bold text-primary">
                {formatDateGroup(at, timezone)}
                {relativeDayLabel(at, today, timezone) === 'TODAY' ? (
                  <TodayChip>{messages.session.today}</TodayChip>
                ) : null}
              </h2>

              <ul className="flex flex-col gap-3">
                {day.items.map((session) => (
                  <CoachTrainingRow
                    key={session.id}
                    session={session}
                    timezone={timezone}
                    variant={variant}
                    role={sessionRole(me, session)}
                  />
                ))}
              </ul>
            </section>
          )
        })
      )}
    </>
  )
}
