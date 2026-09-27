'use client'

import { cn } from '@/lib/utils'

/**
 * One choosable person or thing in a sheet (DESIGN_SYSTEM §6.8).
 *
 * The control is drawn rather than left to the browser, because a native
 * checkbox is 13 px on a phone and the design asks for 24. The real `<input>`
 * stays in the label, visually hidden: that keeps the keyboard, the screen
 * reader and the form all working, which a clickable div would not.
 *
 * A row that cannot be chosen says why. The design is explicit that an
 * ineligible athlete is shown disabled with a reason rather than hidden — a
 * parent who cannot find their child assumes the app lost them.
 */
export function PickerRow({
  control = 'checkbox',
  name,
  checked,
  onChange,
  disabled = false,
  title,
  meta,
  leading,
  trailing,
}: {
  control?: 'checkbox' | 'radio'
  name?: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  title: React.ReactNode
  /** The second line: a birth year, a reason, a parent's name. */
  meta?: React.ReactNode
  leading?: React.ReactNode
  trailing?: React.ReactNode
}) {
  return (
    <label
      className={cn(
        'flex min-h-16 cursor-pointer items-center gap-3 rounded-control-lg px-3.5 py-2.5',
        'shadow-[inset_0_0_0_1.5px_var(--color-line)]',
        checked && !disabled && 'bg-selected-bg shadow-[inset_0_0_0_2px_var(--color-primary)]',
        disabled && 'cursor-not-allowed bg-neutral-50 text-muted shadow-none',
      )}
    >
      <input
        type={control}
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="sr-only"
      />

      <span
        aria-hidden="true"
        className={cn(
          'flex size-6 shrink-0 items-center justify-center border-[1.5px]',
          control === 'radio' ? 'rounded-full' : 'rounded-[7px]',
          checked && !disabled
            ? 'border-primary bg-primary text-white'
            : 'border-neutral-300 bg-surface',
        )}
      >
        {checked && !disabled ? <Check /> : null}
      </span>

      {leading}

      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn('truncate text-row', disabled ? 'text-muted' : 'text-ink')}>
          {title}
        </span>
        {meta ? <span className="truncate text-meta text-muted">{meta}</span> : null}
      </span>

      {trailing}
    </label>
  )
}

function Check() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="size-4" aria-hidden="true">
      <path
        d="M3.5 8.5l3 3 6-7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
