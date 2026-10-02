'use client'

import { useId } from 'react'
import { cn } from '@/lib/utils'
import { messages } from '@/lib/i18n'

/**
 * A search box over a list already on screen (DESIGN_SYSTEM §6.27).
 *
 * `type="search"` and a real label, hidden: the control is recognisable to a
 * screen reader as a search, and the placeholder — which a label it is not —
 * only repeats what the label says.
 *
 * 16px text, which is not a style choice: anything smaller makes iOS Safari
 * zoom the page when the field takes focus, and a coach then has to pinch back
 * out to read the results.
 */
export function SearchField({
  value,
  onChange,
  label,
  variant = 'outline',
  className,
}: {
  value: string
  onChange: (value: string) => void
  /** The placeholder and the hidden label, which say the same thing. */
  label: string
  /** `fill` on a white sheet, where an outline would fight the panel. */
  variant?: 'outline' | 'fill'
  className?: string
}) {
  const id = useId()

  return (
    <div className={cn('relative flex items-center', className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>

      <svg
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden="true"
        className="pointer-events-none absolute left-3.5 size-5 text-subtle"
      >
        <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M13 13l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>

      <input
        id={id}
        type="search"
        value={value}
        placeholder={label}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          'h-12 w-full rounded-control-lg pl-11 pr-10 text-body text-ink placeholder:text-subtle',
          // The browser's own clear button would sit on top of ours.
          '[&::-webkit-search-cancel-button]:appearance-none',
          variant === 'fill'
            ? 'bg-neutral-50'
            : 'bg-surface shadow-[inset_0_0_0_1.5px_var(--color-line)]',
        )}
      />

      {value !== '' ? (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label={messages.common.clear}
          className="absolute right-2 flex size-8 items-center justify-center rounded-full text-muted"
        >
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="size-4">
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
      ) : null}
    </div>
  )
}
