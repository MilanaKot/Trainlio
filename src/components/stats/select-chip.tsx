'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { Route } from 'next'
import { cn } from '@/lib/utils'

/**
 * A FilterChip with a dropdown (K20 `Všechny ročníky ▾`, `Všichni trenéři ▾`).
 *
 * A native select under the chip's face: the phone's own picker, a keyboard
 * that works, and a name a screen reader reads — none of which a drawn menu
 * gets for free. The choice lives in the URL, `?{param}=`, so back from a
 * player card comes back to the same numbers.
 */
export function SelectChip({
  param,
  label,
  value,
  options,
}: {
  param: string
  /** The select's accessible name (`Ročník`, `Trenér`). */
  label: string
  value: string
  /** The first option is the one that clears the filter, with value ''. */
  options: { value: string; label: string }[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const shown = options.find((option) => option.value === value) ?? options[0]

  return (
    <label
      className={cn(
        'relative flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-surface px-3.5 text-meta font-semibold text-ink',
        'shadow-[inset_0_0_0_1.5px_var(--color-line)] focus-within:shadow-[var(--shadow-focus)]',
      )}
    >
      <span>{shown?.label}</span>
      <svg viewBox="0 0 16 16" fill="none" className="size-3.5 text-muted" aria-hidden="true">
        <path
          d="M4 6l4 4 4-4"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => {
          const search = new URLSearchParams(params.toString())
          if (event.target.value) search.set(param, event.target.value)
          else search.delete(param)
          const query = search.toString()
          router.replace((query ? `${pathname}?${query}` : pathname) as Route, { scroll: false })
        }}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}
