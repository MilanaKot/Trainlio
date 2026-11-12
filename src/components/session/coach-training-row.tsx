import Link from 'next/link'
import { messages } from '@/lib/i18n'
import { changingRoomLabel, eligibilityLabel } from '@/lib/domain/session'
import { capacityState } from '@/lib/domain/capacity'
import { formatTimeRange } from '@/lib/time/workspace-time'
import { Badge } from '@/components/ui/badge'
import { CapacityMeter } from '@/components/ui/capacity-meter'
import { RoleLabel, type SessionRole } from '@/components/ui/role-label'
import { DollarIcon, PersonCheckIcon } from '@/components/ui/status-toggle'
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
  showEdited = false,
  role = null,
}: {
  session: CoachSession
  timezone: string
  /**
   * §K14 (v3.4, decision 44): a finished training reports who came and who
   * paid, out of who was booked. Free places no longer matter.
   */
  variant?: 'upcoming' | 'past'
  /**
   * §K16 only: says that this training no longer matches the series that made
   * it. Everywhere else it would be noise — every training a coach has ever
   * touched would carry it.
   */
  showEdited?: boolean
  /** §K1 v3.2: the signed-in coach's part in it, when they have one (DS §6.34). */
  role?: SessionRole | null
}) {
  const start = new Date(session.startAt)
  const end = new Date(session.endAt)
  const cancelled = session.status === 'CANCELLED'
  const registrationOpen = session.status === 'OPEN'

  const meta = [
    session.facilityCode,
    changingRoomLabel(session.changingRoom, t.changingRoom),
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
  // K2e (decision 46): the main coach was deactivated and nobody leads it yet.
  const leaderless = session.mainCoachId === null && !cancelled

  return (
    <li data-session-id={session.id}>
      <Link
        href={`/trener/${session.id}`}
        className={cn(
          'flex items-center justify-between gap-3 rounded-card p-4',
          cancelled
            ? 'bg-neutral-50 shadow-[inset_0_0_0_1px_var(--color-line)]'
            : leaderless
              ? 'bg-surface shadow-[inset_0_0_0_1.5px_var(--color-warning-fill)]'
              : 'bg-surface shadow-card',
        )}
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span
            className={cn(
              'nums whitespace-nowrap text-[1.625rem]/[1.875rem] font-bold',
              cancelled ? 'text-muted line-through' : 'text-ink',
            )}
          >
            {formatTimeRange(start, end, timezone)}
          </span>
          <span className="truncate text-meta text-muted">{meta}</span>
          {role ? <RoleLabel role={role} /> : null}

          {/* One status line at most, and only when there is something to say:
              a row that always carries a line reads as an alert that never
              stops. */}
          {leaderless ? (
            <span className="flex items-center gap-1 text-hint font-bold text-warning">
              <WarningIcon />
              {t.noMainCoach}
            </span>
          ) : session.status === 'DRAFT' ? (
            <span className="pt-0.5">
              <Badge>{t.draft}</Badge>
            </span>
          ) : showEdited && session.editedSinceCreated ? (
            <span className="text-hint font-semibold text-muted">{t.seriesOutOfPattern}</span>
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
            <span className="flex flex-col items-end gap-0.5">
              <Counter
                icon={<PersonCheckIcon className="size-4" />}
                label={t.pastPresent}
                count={session.presentCount}
                total={session.rosterCount}
              />
              <Counter
                icon={<DollarIcon className="size-4" />}
                label={t.pastPaid}
                count={session.paidCount}
                total={session.rosterCount}
              />
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

/** §K14: success when everyone, warning when somebody is missing. */
function Counter({
  icon,
  label,
  count,
  total,
}: {
  icon: React.ReactNode
  label: string
  count: number
  total: number
}) {
  return (
    <span
      aria-label={`${label} ${count}/${total}`}
      className={cn(
        'nums flex items-center gap-1 text-meta font-bold',
        count < total ? 'text-warning' : 'text-success',
      )}
    >
      {icon}
      <span aria-hidden="true">
        {count}/{total}
      </span>
    </span>
  )
}

function WarningIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-3.5 shrink-0" aria-hidden="true">
      <path d="M12 4l9 16H3l9-16z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M12 10v4.5M12 17.2v.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
