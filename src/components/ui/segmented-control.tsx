'use client'

import { cn } from '@/lib/utils'

/**
 * A choice between two or three things, both of which fit on screen
 * (DESIGN_SYSTEM §6.9).
 *
 * The role is the caller's to give, and it matters: switching a list between
 * "Nadcházející" and "Minulé" is a tablist, while choosing a hall inside a form
 * is a radiogroup. They look identical and behave differently to a screen
 * reader, which is the point.
 */
export type SegmentedOption<T extends string> = {
  value: T
  label: string
  /** The second line, as the hall picker shows `MH` above `Malá hala`. */
  sublabel?: string
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  as = 'radiogroup',
  className,
}: {
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  label: string
  as?: 'radiogroup' | 'tablist'
  className?: string
}) {
  const isTabs = as === 'tablist'

  return (
    <div
      role={as}
      aria-label={label}
      className={cn('flex gap-1 rounded-control-lg bg-neutral-50 p-1', className)}
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role={isTabs ? 'tab' : 'radio'}
            aria-selected={isTabs ? selected : undefined}
            aria-checked={isTabs ? undefined : selected}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex min-h-11 flex-1 flex-col items-center justify-center rounded-[9px] px-3 text-row',
              selected ? 'bg-surface text-ink shadow-card' : 'text-muted',
            )}
          >
            <span>{option.label}</span>
            {option.sublabel ? (
              <span className="text-hint font-normal text-muted">{option.sublabel}</span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
