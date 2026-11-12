import { messages } from '@/lib/i18n'
import { cn } from '@/lib/utils'

const t = messages.coach

/**
 * Whether one booking is paid (DESIGN_SYSTEM §6.35, handoff v3.3).
 *
 * Always words, never a bare tick or a circle: on a roster a tick reads as
 * "came", and attendance is not something Trainlio records.
 *
 * `Nezaplaceno` is drawn in `muted` rather than the `subtle` the design names.
 * Subtle measures 3.17:1 on white, which fails WCAG AA for 12 px text, and the
 * design system itself reserves it for chevrons and disabled text (§10).
 */
export function PaymentChip({ paid, className }: { paid: boolean; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-[26px] shrink-0 items-center gap-1 rounded-[13px] px-[9px] text-[0.75rem] font-bold whitespace-nowrap',
        paid
          ? 'bg-success-soft text-success'
          : 'text-muted shadow-[inset_0_0_0_1.5px_var(--color-line)]',
        className,
      )}
    >
      {paid ? (
        <svg viewBox="0 0 12 12" fill="none" className="size-3" aria-hidden="true">
          <path
            d="M2.5 6.2l2.3 2.3 4.7-5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
      {paid ? t.paid : t.unpaid}
    </span>
  )
}
