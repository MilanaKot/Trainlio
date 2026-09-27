'use client'

import { useId, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * A labelled form control (DESIGN_SYSTEM §6.10).
 *
 * The label, the optional marker, the error and the "Původně …" helper are one
 * component because they are one thing to a person filling the form, and
 * because the wiring between them — `aria-describedby`, `aria-invalid`, the id
 * that ties label to input — is exactly what gets forgotten when each screen
 * assembles its own.
 */
type FieldProps = {
  label: string
  /** Renders the muted `Nepovinné` marker the design puts in the label row. */
  optional?: boolean
  required?: boolean
  error?: string | undefined
  hint?: string | undefined
  /** Coach edit: what this value used to be, before the pending change. */
  previously?: string | undefined
  children: (props: {
    id: string
    'aria-describedby': string | undefined
    'aria-invalid': true | undefined
    className: string
  }) => React.ReactNode
  className?: string
}

export function Field({
  label,
  optional = false,
  required = false,
  error,
  hint,
  previously,
  children,
  className,
}: FieldProps) {
  const id = useId()
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ')

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-meta font-semibold text-ink">
          {label}
          {required ? <span className="text-danger"> *</span> : null}
        </label>
        {optional ? <span className="text-hint font-normal text-muted">Nepovinné</span> : null}
      </div>

      {children({
        id,
        'aria-describedby': describedBy === '' ? undefined : describedBy,
        'aria-invalid': error === undefined ? undefined : true,
        className: controlClass({ error: error !== undefined, changed: previously !== undefined }),
      })}

      {previously !== undefined ? (
        <p className="text-hint font-semibold text-warning">Původně {previously}</p>
      ) : null}
      {hint !== undefined ? (
        <p id={hintId} className="text-hint font-normal text-muted">
          {hint}
        </p>
      ) : null}
      {error !== undefined ? (
        <p id={errorId} className="text-hint font-semibold text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/**
 * The control's own appearance, shared by input, select and textarea so a form
 * row cannot end up half a design system.
 */
export function controlClass({
  error = false,
  changed = false,
}: { error?: boolean; changed?: boolean } = {}): string {
  return cn(
    'w-full rounded-control bg-surface px-3.5 text-body text-ink',
    'shadow-[inset_0_0_0_1.5px_var(--color-line)]',
    'focus:outline-none focus:shadow-field-focus',
    'h-btn-block',
    error && 'shadow-[inset_0_0_0_2px_var(--color-danger)]',
    changed && !error && 'bg-warning-field shadow-[inset_0_0_0_2px_var(--color-warning-fill)]',
  )
}

/**
 * A note with a limit (§6.10).
 *
 * The limit is enforced by the control rather than reported after the fact:
 * `maxLength` stops the typing and the counter turns red on the last
 * character, so nobody writes a paragraph and then loses it.
 */
export function TextareaWithCounter({
  value,
  onChange,
  maxLength = 200,
  className,
  id,
  ...props
}: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange' | 'value'> & {
  value: string
  onChange: (value: string) => void
  maxLength?: number
}) {
  const atLimit = value.length >= maxLength

  return (
    <div className="relative">
      <textarea
        {...props}
        id={id}
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        className={cn(controlClass(), 'min-h-22 resize-y py-3 pb-8', className)}
      />
      <span
        className={cn(
          'nums pointer-events-none absolute right-3 bottom-2.5 text-hint',
          atLimit ? 'font-semibold text-danger' : 'text-muted',
        )}
      >
        {value.length} / {maxLength}
      </span>
    </div>
  )
}

/** A note whose value the caller does not own yet. */
export function useCounterState(initial: string) {
  return useState(initial)
}
