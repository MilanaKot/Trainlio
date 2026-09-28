'use client'

import { cn } from '@/lib/utils'

/**
 * An on/off setting (DESIGN_SYSTEM: 52 × 32, success when on).
 *
 * A real checkbox with `role="switch"`, not a styled div: the keyboard, the
 * screen reader and the form all keep working, and the label is what gets
 * clicked, which is also the 44px target.
 */
export function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled = false,
  disabledHint,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  hint?: string
  disabled?: boolean
  /** Why it cannot be moved, shown in place of the hint. */
  disabledHint?: string
}) {
  return (
    <label
      className={cn(
        'flex min-h-touch items-center justify-between gap-4',
        disabled ? 'cursor-not-allowed' : 'cursor-pointer',
      )}
    >
      <span className="flex flex-col gap-0.5">
        <span className={cn('text-row font-semibold', disabled ? 'text-muted' : 'text-ink')}>
          {label}
        </span>
        {disabled && disabledHint ? (
          <span className="text-hint text-muted">{disabledHint}</span>
        ) : hint ? (
          <span className="text-hint text-muted">{hint}</span>
        ) : null}
      </span>

      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="sr-only"
      />
      <span
        aria-hidden="true"
        className={cn(
          'relative h-8 w-13 shrink-0 rounded-full transition-colors',
          disabled ? 'bg-neutral-200' : checked ? 'bg-success' : 'bg-neutral-300',
        )}
      >
        <span
          className={cn(
            'absolute top-1 size-6 rounded-full bg-surface shadow-card transition-all',
            checked ? 'left-6' : 'left-1',
          )}
        />
      </span>
    </label>
  )
}
