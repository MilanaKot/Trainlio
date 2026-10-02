import { messages } from '@/lib/i18n'
import { cn } from '@/lib/utils'

const t = messages.coach

const DAYS = [1, 2, 3, 4, 5, 6, 7] as const

/**
 * The seven days, with the ones a series repeats on filled in
 * (DESIGN_SYSTEM §6.29).
 *
 * Decorative, and marked as such: seven two-letter squares read aloud are
 * noise. The container carries the days in words instead, so a screen reader
 * says "úterý, čtvrtek" where the eye sees the pattern.
 */
export function WeekdayBadges({ weekdays, className }: { weekdays: number[]; className?: string }) {
  const selected = new Set(weekdays)
  const words = DAYS.filter((day) => selected.has(day))
    .map((day) => t.weekdays[String(day) as keyof typeof t.weekdays])
    .join(', ')

  return (
    <span role="img" aria-label={words} className={cn('flex gap-[3px]', className)}>
      {DAYS.map((day) => (
        <span
          key={day}
          aria-hidden="true"
          className={cn(
            'flex size-6 items-center justify-center rounded-chip text-[0.6875rem] font-bold',
            selected.has(day) ? 'bg-primary text-white' : 'bg-neutral-50 text-subtle',
          )}
        >
          {t.weekdaysShort[String(day) as keyof typeof t.weekdaysShort]}
        </span>
      ))}
    </span>
  )
}
