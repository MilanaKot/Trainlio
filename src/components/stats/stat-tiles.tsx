import { messages } from '@/lib/i18n'
import { percent } from '@/lib/domain/stats'
import type { Statistics } from '@/server/stats/queries'

const t = messages.coach.stats

/** The four tiles of K20 and K20b (2 × 2, white, radius 14, Barlow 30). */
export function StatTiles({ stats, sessionsLabel }: { stats: Statistics; sessionsLabel?: string }) {
  const tiles = [
    { value: String(stats.sessions), label: sessionsLabel ?? t.sessions },
    { value: shown(percent(stats.booked, stats.capacity)), label: t.occupancy },
    { value: shown(percent(stats.present, stats.marked)), label: t.attendance },
    { value: shown(percent(stats.paid, stats.bookings)), label: t.paid },
  ]
  return (
    <dl className="grid grid-cols-2 gap-2">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="flex flex-col-reverse gap-1 rounded-[14px] bg-surface p-3.5 shadow-card"
        >
          <dt className="text-hint font-semibold text-muted">{tile.label}</dt>
          <dd className="nums font-display text-[1.875rem]/[2.125rem] font-bold text-ink">
            {tile.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function shown(value: number | null): string {
  return value === null ? t.none : `${value} %`
}
