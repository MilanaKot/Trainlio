'use client'

import { useState } from 'react'

/**
 * A small whole number, chosen with a thumb (DESIGN_SYSTEM §6.11).
 *
 * Two buttons because capacity moves by one at the rink and a phone keypad for
 * that is more work than a tap. A typeable field in the middle because a club
 * that trains twenty at a time would otherwise tap `+` ten times, and because
 * a keyboard user could not set it at all.
 *
 * The buttons are labelled for screen readers, and with the number's own name:
 * "−" and "+" say nothing on their own.
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
  // What is being typed, which is not always a number: a field cleared on the
  // way to `24` is empty for a keystroke, and forcing it back to the minimum
  // in that moment leaves a `1` in front of whatever comes next.
  const [draft, setDraft] = useState<string | null>(null)
  const clamp = (n: number) => Math.min(max, Math.max(min, n))
  const step = (delta: number) => {
    setDraft(null)
    onChange(clamp(value + delta))
  }

  return (
    <div
      className="inline-flex h-btn-block w-45 items-center justify-between rounded-control shadow-[inset_0_0_0_1.5px_var(--color-line)]"
      // The group is not labelled: the field it contains is, and two things
      // answering to `Kapacita` is one thing too many for a screen reader and
      // for a test alike.
      role="group"
    >
      <button
        type="button"
        onClick={() => step(-1)}
        disabled={value <= min}
        aria-label={`${label}: ubrat`}
        className="flex size-13 items-center justify-center rounded-l-control bg-neutral-50 text-xl font-bold text-ink disabled:text-subtle"
      >
        −
      </button>
      {/* An input rather than a read-only number: a club that trains twenty at
          a time would otherwise tap `+` ten times, and a keyboard user could
          not set it at all. The buttons stay because they are what a thumb
          wants for 10 → 11. */}
      <input
        id={id}
        type="number"
        inputMode="numeric"
        aria-label={label}
        value={draft ?? String(value)}
        min={min}
        max={max}
        onChange={(event) => {
          const raw = event.target.value
          setDraft(raw)
          const next = Number(raw)
          // Reported as it is typed only while it is a number the caller can
          // accept; anything else waits for the field to be left.
          if (raw !== '' && Number.isInteger(next) && next >= min && next <= max) onChange(next)
        }}
        onBlur={() => {
          const next = Number(draft)
          setDraft(null)
          if (draft === null || draft === '' || Number.isNaN(next)) return
          onChange(clamp(Math.round(next)))
        }}
        className="nums h-full w-16 [appearance:textfield] bg-transparent text-center text-[1.5rem] font-bold text-ink outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button
        type="button"
        onClick={() => step(1)}
        disabled={value >= max}
        aria-label={`${label}: přidat`}
        className="flex size-13 items-center justify-center rounded-r-control bg-neutral-50 text-xl font-bold text-ink disabled:text-subtle"
      >
        +
      </button>
    </div>
  )
}
