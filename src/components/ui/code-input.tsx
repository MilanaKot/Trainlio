'use client'

import { useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * Six digits, drawn as six boxes (guardian/SPEC.md §G12).
 *
 * One real input underneath, transparent and the full width of the row, with
 * the boxes painted behind it. A row of six separate inputs looks the same and
 * behaves worse: pasting a code fills only the first, `autocomplete` offers the
 * one-time code to one of them, and a backspace at the start of a box has to be
 * taught where to go. Here the browser's own field does all of that, and the
 * boxes are decoration that shows what it holds.
 */
export function CodeInput({
  value,
  onChange,
  length = 6,
  label,
  autoFocus = false,
}: {
  value: string
  onChange: (value: string) => void
  length?: number
  label: string
  autoFocus?: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)
  const digits = Array.from({ length }, (_, index) => value[index] ?? '')

  return (
    <div className="relative" onClick={() => input.current?.focus()}>
      <div aria-hidden="true" className="flex gap-2">
        {digits.map((digit, index) => (
          <span
            key={index}
            className={cn(
              'nums flex h-15 flex-1 items-center justify-center rounded-control bg-surface font-display text-[1.875rem] font-bold text-ink',
              // The caret, drawn: the box that would receive the next digit is
              // ringed, and only while the field has focus — otherwise the row
              // looks focused when it is not.
              focused && index === Math.min(value.length, length - 1)
                ? 'shadow-[inset_0_0_0_2px_var(--color-primary)]'
                : 'shadow-[inset_0_0_0_1.5px_var(--color-line)]',
            )}
          >
            {digit}
          </span>
        ))}
      </div>

      <input
        ref={input}
        type="text"
        name="code"
        aria-label={label}
        // The numeric keypad, and the code the phone offers from the message
        // it has just received.
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d*"
        maxLength={length}
        autoFocus={autoFocus}
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, length))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        // The focus ring belongs on the boxes, not on the transparent field
        // stretched across them, which would draw a second rectangle round the
        // whole row.
        className="absolute inset-0 size-full bg-transparent text-transparent caret-transparent outline-none focus-visible:shadow-none"
      />
    </div>
  )
}
