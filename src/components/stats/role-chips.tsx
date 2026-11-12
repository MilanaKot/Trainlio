'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { Route } from 'next'
import { FilterChips } from '@/components/ui/filter-chips'
import { messages } from '@/lib/i18n'

const t = messages.coach.stats

/** K20b `Hlavní trenér + asistent` / `Jen hlavní`, kept in `?role=`. */
export function RoleChips({ mainOnly }: { mainOnly: boolean }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  return (
    <FilterChips
      label={t.role}
      value={mainOnly ? 'main' : 'both'}
      options={[
        { value: 'both', label: t.roleBoth },
        { value: 'main', label: t.roleMain },
      ]}
      onChange={(value) => {
        const search = new URLSearchParams(params.toString())
        if (value === 'main') search.set('role', 'hlavni')
        else search.delete('role')
        const query = search.toString()
        router.replace((query ? `${pathname}?${query}` : pathname) as Route, { scroll: false })
      }}
    />
  )
}
