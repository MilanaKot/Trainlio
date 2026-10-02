import Link from 'next/link'
import { messages, plural } from '@/lib/i18n'
import { eligibilityLabel } from '@/lib/domain/session'
import { capacityState } from '@/lib/domain/capacity'
import { formatTimeRange } from '@/lib/time/workspace-time'
import { Badge } from '@/components/ui/badge'
import { CapacityMeter } from '@/components/ui/capacity-meter'
import { cn } from '@/lib/utils'
import type { CoachSession } from '@/server/sessions/queries'

const t = messages.coach

function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="size-3.5 shrink-0" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 015 0v2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

/**
 * One training in the coach's list (DESIGN_SYSTEM §6.7, coach/SPEC.md §K1).
 *
 * The whole row is the link. A coach standing at the rink reads the time, the
 * hall and the count; everything else about the training is one tap away, and
 * the row stays a row rather than becoming a summary of the detail screen.
 */
export function CoachTrainingRow({
  session,
  timezone,
  variant = 'upcoming',
}: {
  session: CoachSession
  timezone: string
  /**
   * §K14: a finished training reports how many were booked and nothing else.
   * Free places no longer matter, and there is no attendance tracking in the
   * MVP — so a meter here would imply a fullness that means nothing, and any
   * other figure would imply who came.
   */
  variant?: 'upcoming' | 'past'
}) {
  const start = new Date(session.startAt)
  const end = new Date(session.endAt)
  const cancelled = session.status === 'CANCELLED'
  const registrationOpen = session.status === 'OPEN'

  const meta = [
    session.facilityCode,
    session.changingRoom,
    eligibilityLabel(
      session.eligibilityMode,
      session.birthYearFrom,
      session.birthYearTo,
      t.eligibilityAllShort,
    ),
  ]
    .filter(Boolean)
    .join(' · ')

  const state = capacityState(session.confirmedCount, session.capacity, registrationOpen)

  return (
    <li>
      <Link
        href={`/trener/${session.id}`}
        className={cn(
          'flex items-center justify-between gap-3 rounded-card p-4',
          cancelled
            ? 'bg-neutral-50 shadow-[inset_0_0_0_1px_var(--color-line)]'
            : 'bg-surface shadow-card',
        )}
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span
            className={cn(
              'nums text-sheet-title font-bold',
              cancelled ? 'text-muted line-through' : 'text-ink',
            )}
          >
            {formatTimeRange(start, end, timezone)}
          </span>
          <span className="truncate text-meta text-muted">{meta}</span>

          {/* One status line at most, and only when there is something to say:
              a row that always carries a line reads as an alert that never
              stops. */}
          {session.status === 'DRAFT' ? (
            <span className="pt-0.5">
              <Badge>{t.draft}</Badge>
            </span>
          ) : state === 'over' ? (
            <span className="text-hint font-semibold text-muted">{t.overCapacityBadge}</span>
          ) : session.status === 'CLOSED' ? (
            <span className="flex items-center gap-1 text-hint font-semibold text-muted">
              <LockIcon />
              {messages.session.bookingClosed}
            </span>
          ) : null}
        </span>

        <span className="flex shrink-0 items-center gap-2">
          {cancelled ? (
            <Badge variant="danger">{t.cancelledBadge}</Badge>
          ) : variant === 'past' ? (
            <span className="flex flex-col items-end">
              <span className="nums font-display text-[1.375rem] font-bold leading-6 text-ink">
                {session.confirmedCount}
              </span>
              <span className="text-caption text-muted">
                {plural(session.confirmedCount, t.bookedLabel)}
              </span>
            </span>
          ) : (
            <CapacityMeter
              booked={session.confirmedCount}
              capacity={session.capacity}
              registrationOpen={registrationOpen}
              size="sm"
            />
          )}
          <span className="text-subtle" aria-hidden="true">
            ›
          </span>
        </span>
      </Link>
    </li>
  )
}
