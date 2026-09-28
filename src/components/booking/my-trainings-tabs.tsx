'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { messages } from '@/lib/i18n'

const t = messages.myTrainings

export type MyTrainingsTab = 'upcoming' | 'past'

/**
 * Nadcházející / Minulé (guardian/SPEC.md §G4, §G5).
 *
 * The tab lives in the URL rather than in component state, so a parent who
 * opens a booking from "Minulé" and comes back with the browser's own back
 * button lands where they left, not on the other tab.
 */
export function MyTrainingsTabs({ value }: { value: MyTrainingsTab }) {
  const router = useRouter()
  const params = useSearchParams()

  function select(next: MyTrainingsTab) {
    const search = new URLSearchParams(params.toString())
    if (next === 'upcoming') search.delete('tab')
    else search.set('tab', 'minule')
    const query = search.toString()
    router.replace(query ? `/moje-treninky?${query}` : '/moje-treninky', { scroll: false })
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
