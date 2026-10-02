'use client'

import { cn } from '@/lib/utils'

/**
 * One filter, chosen from a row of pills (DESIGN_SYSTEM §6.28).
 *
 * `aria-pressed` rather than a radiogroup: these are toggles over a list that is
 * already there, not a value being chosen in a form. The first chip is the one
 * that clears the filter, so there is always a way back without a reset button.
 *
 * The row scrolls sideways rather than wrapping. A club with eight birth years
 * would otherwise push the list itself off a phone screen.
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
                ? 'bg-ink text-white'
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
