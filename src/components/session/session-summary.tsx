import { messages } from '@/lib/i18n'
import { eligibilityLabel } from '@/lib/domain/session'
import { formatSessionDay, formatTimeRange } from '@/lib/time/workspace-time'
import type { CoachSession } from '@/server/sessions/queries'

const t = messages.coach

/** `Příbram · MH · Šatna 4` — the venue line guardians see too (D-12). */
export function venueLine(session: CoachSession): string {
  return [session.locationName, session.facilityCode, session.changingRoom]
    .filter(Boolean)
    .join(' · ')
}

export function SessionSummary({
  session,
  timezone,
}: {
  session: CoachSession
  timezone: string
}) {
  const start = new Date(session.startAt)
  const end = new Date(session.endAt)

  return (
    <div className="flex flex-col gap-1">
      <span className="font-medium">{formatSessionDay(start, timezone)}</span>
      <span className="text-sm">{formatTimeRange(start, end, timezone)}</span>
      <span className="text-sm opacity-70">{venueLine(session)}</span>
      <span className="text-sm opacity-70">
        {eligibilityLabel(
          session.eligibilityMode,
          session.birthYearFrom,
          session.birthYearTo,
          t.eligibilityAll,
        )}
      </span>
    </div>
  )
}

export function StatusBadge({ status }: { status: CoachSession['status'] }) {
  if (status === 'OPEN') return null

  const label =
    status === 'CANCELLED'
      ? messages.session.cancelled
      : status === 'CLOSED'
        ? messages.session.bookingClosed
        : status

  return (
    <span className="shrink-0 rounded bg-black/10 px-2 py-0.5 text-[11px] uppercase dark:bg-white/15">
      {label}
    </span>
  )
}

export function Occupancy({ session }: { session: CoachSession }) {
  return (
    <span className="tabular-nums text-sm font-medium">
      {t.occupancy
        .replace('{confirmed}', String(session.confirmedCount))
        .replace('{capacity}', String(session.capacity))}
    </span>
  )
}
