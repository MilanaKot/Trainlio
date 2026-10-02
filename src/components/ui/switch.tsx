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
          // §6.24: off is its own grey, not the neutral the rest of the system
          // uses — a switch that reads as "disabled" when it is merely off is
          // the one mistake this control can make.
          checked ? 'bg-success' : 'bg-[#DCE2EC]',
          disabled && 'opacity-45',
          // No animation for anyone who asked for none.
          'motion-reduce:transition-none',
        )}
      >
        <span
          className={cn(
            'absolute top-[3px] size-[26px] rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/.2)]',
            'transition-all duration-150 motion-reduce:transition-none',
            checked ? 'left-[23px]' : 'left-[3px]',
          )}
        />
      </span>
    </label>
  )
}
