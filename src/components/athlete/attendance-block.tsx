import { messages, plural } from '@/lib/i18n'
import { attendanceView, inPeriod, summarizeAttendance, type Period } from '@/lib/domain/attendance'
import { PeriodControl } from '@/components/ui/period-control'
import type { AttendanceRecord } from '@/server/athletes/queries'

const t = messages.athlete.attendance

/**
 * G8b · `DOCHÁZKA · LEDNÍ HOKEJ` (handoff v3.4, decision 45).
 *
 * The parent's view of attendance: the period's percentage, a square per
 * training (green Byl, red Nebyl) and the two counts. Read-only, no list, and
 * nothing about payment. Same rules as the coach's K13: cancelled trainings
 * are left out, and one nobody marked counts as Nebyl only once it is over.
 */
export function AttendanceBlock({
  records,
  period,
  timezone,
  sportName,
}: {
  records: AttendanceRecord[]
  period: Period
  timezone: string
  sportName: string
}) {
  const now = new Date()
  const inThisPeriod = records
    .filter((record) => !record.sessionCancelled)
    .filter((record) => inPeriod(new Date(record.startAt), period, timezone))
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
  const summary = summarizeAttendance(inThisPeriod, now)
  const squares = inThisPeriod
    .map((record) => attendanceView(record.mark, record, now))
    .filter((view) => view === 'present' || view === 'absent')
  const total = summary.present + summary.absent

  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="text-caption font-bold uppercase tracking-[0.8px] text-muted">
        {t.caption.replace('{sport}', sportName.toLocaleUpperCase('cs'))}
      </h2>
      <div className="flex flex-col gap-3 rounded-card bg-surface p-4 shadow-card">
        <PeriodControl period={period} />
        {total === 0 ? (
          <p className="text-meta text-muted">{t.none}</p>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <span className="nums font-display text-[2.75rem]/[3rem] font-bold text-ink">
                {summary.percent} %
              </span>
              <span className="flex min-w-0 flex-col gap-1.5">
                <span className="text-hint font-semibold text-ink">
                  {plural(total, t.summary).replace('{present}', String(summary.present))}
                </span>
                <span className="flex flex-wrap gap-1" aria-hidden="true">
                  {squares.map((view, index) => (
                    <span
                      key={index}
                      className={`size-3.5 rounded-[3px] ${view === 'present' ? 'bg-success' : 'bg-danger'}`}
                    />
                  ))}
                </span>
              </span>
            </div>
            <p className="flex gap-3 text-hint font-bold">
              <span className="text-success">
                {t.present} {summary.present}
              </span>
              <span className="text-danger">
                {t.absent} {summary.absent}
              </span>
            </p>
          </>
        )}
      </div>
    </section>
  )
}
