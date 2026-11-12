'use client'

import { cn } from '@/lib/utils'

/**
 * One filter, chosen from a row of pills (DESIGN_SYSTEM §6.28).
 *
 * `aria-pressed` rather than a radiogroup: these are toggles over a list that is
 * already there, not a value being chosen in a form. The first chip is the one
 * that clears the filter, so there is always a way back without a reset button.
 *
 * The row scrolls sideways rather than wrapping, for the two or three chips it
 * holds (K1, K20b). The chosen one is primary blue, never ink (decision 49).
 * Birth years, which can be many, use `YearGrid` below instead.
 */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  label: string
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        '-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex h-9 shrink-0 snap-start items-center rounded-full px-3.5 text-meta font-semibold whitespace-nowrap',
              selected
                ? 'bg-primary text-white'
                : 'bg-surface text-ink shadow-[inset_0_0_0_1.5px_var(--color-line)]',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * The birth-year filter of K12 (DS §6.28 YearGrid, v3.6, decision 49).
 *
 * Every year in sight at once: a four-column grid that grows by rows, where
 * the old row scrolled sideways and hid what did not fit. `Všechny` first,
 * then the years newest first, each with how many active athletes it holds.
 */
export function YearGrid<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  /** `Všechny` first; the caller orders the years. */
  options: { value: T; label: string; count?: number }[]
  value: T
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="grid grid-cols-4 gap-2 rounded-card bg-surface p-3 shadow-card"
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            // `2018, 10` — read as one string the two numbers run together.
            {...(option.count !== undefined
              ? { 'aria-label': `${option.label}, ${option.count}` }
              : {})}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex h-11 min-w-0 items-center justify-center gap-1 rounded-full px-1 text-meta font-semibold whitespace-nowrap',
              selected
                ? 'bg-primary text-white'
                : 'bg-surface text-ink shadow-[inset_0_0_0_1.5px_var(--color-line)]',
            )}
          >
            {option.label}
            {option.count !== undefined ? (
              <span
                className={cn(
                  'text-[0.8125rem] font-medium',
                  selected ? 'text-white/80' : 'text-muted',
                )}
              >
                {option.count}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
