'use client'

import { cn } from '@/lib/utils'

/**
 * A small closed set, chosen by tapping (guardian/SPEC.md §G9).
 *
 * Pills rather than a `<select>` because there are six of them and a parent
 * should see the choices without opening anything — and because a native
 * select on Android is a full-screen list for what fits on two lines here.
 *
 * Real radio inputs inside the labels: the keyboard, the screen reader and the
 * form all keep working, and the 44px label is the tap target.
 */
export function RadioPills<T extends string>({
  name,
  options,
  value,
  onChange,
  columns = 2,
  label,
}: {
  name: string
  options: { value: T; label: string }[]
  value: T | ''
  onChange: (value: T) => void
  columns?: 2 | 3
  /** Names the group for a screen reader, which sees no caption above it. */
  label: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('grid gap-2', columns === 3 ? 'grid-cols-3' : 'grid-cols-2')}
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <label
            key={option.value}
            className={cn(
              'relative flex min-h-touch cursor-pointer items-center justify-center gap-1.5 rounded-control px-3 text-center text-row font-semibold',
              selected
                ? 'bg-primary-100 text-primary shadow-[inset_0_0_0_2px_var(--color-primary)]'
                : 'bg-surface text-ink shadow-[inset_0_0_0_1.5px_var(--color-line)]',
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={selected}
              onChange={() => onChange(option.value)}
              // Transparent and the size of the pill, rather than `sr-only`:
              // the control a person taps and the control a keyboard or a test
              // drives are then the same element.
              className="absolute inset-0 size-full cursor-pointer appearance-none opacity-0"
            />
            {selected ? (
              <svg viewBox="0 0 16 16" fill="none" className="size-4 shrink-0" aria-hidden="true">
                <path
                  d="M3 8.5l3.5 3.5L13 5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : null}
            {option.label}
          </label>
        )
      })}
    </div>
  )
}
