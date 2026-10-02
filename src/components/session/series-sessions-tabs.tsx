'use client'

import { useRouter } from 'next/navigation'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { messages } from '@/lib/i18n'

const t = messages.coach

/**
 * Nadcházející / Minulé inside one series (coach/SPEC.md §K16).
 *
 * The counts are in the labels, as the design draws them: a coach opening a
 * series wants to know how much of it is left before they read a single row.
 */
export function SeriesSessionsTabs({
  seriesId,
  value,
  upcoming,
  past,
}: {
  seriesId: string
  value: 'upcoming' | 'past'
  upcoming: number
  past: number
}) {
  const router = useRouter()

  return (
    <SegmentedControl
      as="tablist"
      label={t.seriesTabs}
      value={value}
      onChange={(next) =>
        router.replace(
          next === 'past' ? `/trener/serie/${seriesId}?tab=minule` : `/trener/serie/${seriesId}`,
          { scroll: false },
        )
      }
      options={[
        { value: 'upcoming', label: t.seriesUpcomingTab.replace('{count}', String(upcoming)) },
        { value: 'past', label: t.seriesPastTab.replace('{count}', String(past)) },
      ]}
    />
  )
}
