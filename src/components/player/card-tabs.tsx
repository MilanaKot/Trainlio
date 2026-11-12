'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { Route } from 'next'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { messages } from '@/lib/i18n'
import type { CardTab } from '@/components/player/card-tab'

const t = messages.coach.card

/**
 * `Tréninky · Hráč · Rodiče · Zprávy` (K13, decision 43), in the URL as
 * `?tab=`, so a coach who opens a training from `Tréninky` comes back to it.
 */
export function CardTabs({ value }: { value: CardTab }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  function select(next: CardTab) {
    const search = new URLSearchParams(params.toString())
    if (next === 'treninky') search.delete('tab')
    else search.set('tab', next)
    search.delete('dalsi')
    const query = search.toString()
    router.replace((query ? `${pathname}?${query}` : pathname) as Route, { scroll: false })
  }

  return (
    <SegmentedControl
      as="tablist"
      label={t.tabs}
      value={value}
      onChange={select}
      className="[&>button]:px-1 [&>button]:text-meta [&>button]:font-semibold"
      options={[
        { value: 'treninky', label: t.tabTrainings },
        { value: 'hrac', label: t.tabPlayer },
        { value: 'rodice', label: t.tabParents },
        { value: 'zpravy', label: t.tabMessages },
      ]}
    />
  )
}
