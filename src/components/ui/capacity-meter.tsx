import { capacityState, overCapacityBy, type CapacityState } from '@/lib/domain/capacity'
import { cn } from '@/lib/utils'

/**
 * How full a training is (DESIGN_SYSTEM §6.4).
 *
 * The segments are decoration; the count beside them is the fact. That is the
 * §10 rule about never leaving a status to colour, and it is also why the
 * whole thing is one `meter` with a label rather than a row of coloured boxes
 * a screen reader would have to add up.
 *
 * Above sixteen places the segments stop being countable at a glance and
 * become a texture, so the design switches to a plain bar at that point.
 */
const SEGMENT_LIMIT = 16

const FILL: Record<CapacityState, string> = {
  open: 'bg-ink',
  lastPlaces: 'bg-warning-fill',
  full: 'bg-primary',
  closed: 'bg-subtle',
  over: 'bg-ink',
}

export function CapacityMeter({
  booked,
  capacity,
  registrationOpen,
  size = 'md',
  className,
}: {
  booked: number
  capacity: number
  registrationOpen: boolean
  /** `sm` is the coach list, where a row carries a whole day's worth. */
  size?: 'sm' | 'md'
  className?: string
}) {
  const state = capacityState(booked, capacity, registrationOpen)
  const over = overCapacityBy(booked, capacity)
  const filled = Math.min(booked, capacity)

  return (
    <div
      className={cn('flex items-center gap-2', className)}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={capacity}
      aria-valuenow={booked}
      aria-label="Obsazenost"
    >
      {capacity <= SEGMENT_LIMIT ? (
        <div className={cn('flex', size === 'sm' ? 'gap-[2px]' : 'gap-[3px]')} aria-hidden="true">
          {Array.from({ length: capacity }, (_, index) => (
            <span
              key={index}
              className={cn(
                'rounded-seg',
                size === 'sm' ? 'h-3 w-1.5' : 'h-4 w-[9px]',
                index < filled ? FILL[state] : 'bg-seg-off',
              )}
            />
          ))}
        </div>
      ) : (
        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-seg-off" aria-hidden="true">
          <span
            className={cn('block h-full rounded-full', FILL[state])}
            style={{ width: `${capacity === 0 ? 0 : (filled / capacity) * 100}%` }}
          />
        </div>
      )}

      <span
        className={cn(
          'nums font-semibold',
          size === 'sm' ? 'text-count' : 'text-count',
          state === 'closed' ? 'text-muted' : 'text-ink',
        )}
      >
        {booked} / {capacity}
      </span>

      {/* BR-033. A coach put someone in by hand; that is a fact, not a fault,
          so it is the same neutral grey as everything else that is merely
          informative. */}
      {over > 0 ? (
        <span className="rounded-badge bg-neutral-50 px-1.5 py-0.5 text-badge font-bold text-muted">
          +{over}
        </span>
      ) : null}
    </div>
  )
}
