'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { messages } from '@/lib/i18n'

const t = messages.coach

export type CoachTrainingsTab = 'upcoming' | 'past'

/**
 * Nadcházející / Minulé on the coach's list (coach/SPEC.md §K1, §K14).
 *
 * The same component and the same URL-held state as the parent's own tabs: a
 * coach who opens a finished training from `Minulé` and comes back with the
 * browser's back button lands where they left.
 */
export function CoachTrainingsTabs({ value }: { value: CoachTrainingsTab }) {
  const router = useRouter()
  const params = useSearchParams()

  function select(next: CoachTrainingsTab) {
    const search = new URLSearchParams(params.toString())
    if (next === 'upcoming') search.delete('tab')
    else search.set('tab', 'minule')
    const query = search.toString()
    router.replace(query ? `/trener?${query}` : '/trener', { scroll: false })
  }

  return (
    <SegmentedControl
      as="tablist"
      label={t.tabs}
      value={value}
      onChange={select}
      options={[
        { value: 'upcoming', label: t.upcoming },
        { value: 'past', label: t.past },
      ]}
    />
  )
}
