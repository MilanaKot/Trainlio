'use client'

/**
 * A small whole number, chosen with a thumb (DESIGN_SYSTEM §6.11).
 *
 * A stepper rather than a number input because capacity is the only number a
 * coach changes at the rink, it moves by one, and a phone keypad for a
 * two-digit value is more work than two buttons.
 *
 * The buttons are labelled for screen readers and the value is announced,
 * because "−" and "+" say nothing on their own.
 */
export function Stepper({
  value,
  onChange,
  min = 1,
  max = 99,
  label,
  id,
}: {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  label: string
  id?: string
}) {
  const step = (delta: number) => onChange(Math.min(max, Math.max(min, value + delta)))

  return (
    <div
      className="inline-flex h-btn-block w-45 items-center justify-between rounded-control shadow-[inset_0_0_0_1.5px_var(--color-line)]"
      role="group"
      aria-label={label}
    >
      <button
        type="button"
        onClick={() => step(-1)}
        disabled={value <= min}
        aria-label="Ubrat"
        className="flex size-13 items-center justify-center rounded-l-control bg-neutral-50 text-xl font-bold text-ink disabled:text-subtle"
      >
        −
      </button>
      <output id={id} className="nums text-[1.5rem] font-bold text-ink" aria-live="polite">
        {value}
      </output>
      <button
        type="button"
        onClick={() => step(1)}
        disabled={value >= max}
        aria-label="Přidat"
        className="flex size-13 items-center justify-center rounded-r-control bg-neutral-50 text-xl font-bold text-ink disabled:text-subtle"
      >
        +
      </button>
    </div>
  )
}
