'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { Route } from 'next'
import { messages } from '@/lib/i18n'
import { periodKey, periodLabel, shiftPeriod, type Period } from '@/lib/domain/attendance'
import { cn } from '@/lib/utils'

const t = messages.coach.card

/**
 * `Měsíc / Rok` with ‹ › and `Listopad 2026` (K13 Tréninky, G8b).
 *
 * The period lives in the URL (`?obdobi=2026-11` or `?obdobi=2026`), like the
 * tabs: back from a training lands on the month the coach was reading.
 */
export function PeriodControl({ period }: { period: Period }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  function go(next: Period) {
    const search = new URLSearchParams(params.toString())
    search.set('obdobi', periodKey(next))
    search.delete('dalsi')
    router.replace(`${pathname}?${search.toString()}` as Route, { scroll: false })
  }

  return (
    <div className="flex items-center justify-between gap-2">
      <div
        role="radiogroup"
        aria-label={t.period}
        className="flex rounded-[10px] bg-neutral-50 p-0.5"
      >
        {(['month', 'year'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={period.kind === kind}
            onClick={() => go({ ...period, kind })}
            className={cn(
              'rounded-[8px] px-3.5 text-meta font-semibold',
              period.kind === kind ? 'bg-surface text-ink shadow-card' : 'text-muted',
            )}
          >
            {kind === 'month' ? t.month : t.year}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <StepButton label={t.previous} onClick={() => go(shiftPeriod(period, -1))} flip />
        <span
          className="min-w-[7.5rem] text-center text-meta font-bold text-ink"
          aria-live="polite"
        >
          {periodLabel(period)}
        </span>
        <StepButton label={t.next} onClick={() => go(shiftPeriod(period, 1))} />
      </div>
    </div>
  )
}

function StepButton({
  label,
  onClick,
  flip = false,
}: {
  label: string
  onClick: () => void
  flip?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex size-11 items-center justify-center rounded-[10px] bg-neutral-50 text-ink"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn('size-4', flip && 'rotate-180')}
        aria-hidden="true"
      >
        <path d="m9.5 6 6 6-6 6" />
      </svg>
    </button>
  )
}
