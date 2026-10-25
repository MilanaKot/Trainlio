import { Fragment } from 'react'
import { changingRoomLabel, eligibilityLabel } from '@/lib/domain/session'
import { messages } from '@/lib/i18n'
import type { EligibilityMode } from '@/types/database'

/**
 * Where and for whom a training is, right under its time (DESIGN_SYSTEM
 * §6.33, coach/SPEC.md §K2, v3.1).
 *
 * `Příbram · MH · Šatna 4 · Ročníky 2017–2018`. A statement, not a control:
 * no icon, no hover or focus.
 *
 * One line on a phone. §6.33 names the hall in full (`Malá hala (MH)`), and
 * the full line measures 390 px at 15 px bold against 330 px inside the chip at
 * 390 px wide — it did not fit even at 13 px. The hall's code is what the club
 * calls it, and with it the line is 301 px. On a narrower screen than that it
 * still wraps, between the parts and never inside one, so `Ročníky 2017–` is
 * not left above `2018`.
 */
export function PlaceChip({
  town,
  facilityCode,
  changingRoom,
  eligibilityMode,
  birthYearFrom,
  birthYearTo,
}: {
  town: string | null
  facilityCode: string
  changingRoom: string | null
  eligibilityMode: EligibilityMode
  birthYearFrom: number | null
  birthYearTo: number | null
}) {
  const all = messages.coach.eligibilityAllShort
  const years = eligibilityLabel(eligibilityMode, birthYearFrom, birthYearTo, all)

  const parts = [
    town,
    facilityCode,
    changingRoomLabel(changingRoom, messages.coach.changingRoom),
    years === all ? years : `${messages.session.years} ${years}`,
  ].filter((part): part is string => Boolean(part))

  return (
    <p className="mt-1.5 self-start rounded-control-lg bg-primary-100 px-3.5 py-2.5 text-row font-bold text-primary">
      {parts.map((part, index) => (
        <Fragment key={part}>
          {index > 0 ? ' · ' : null}
          <span className="whitespace-nowrap">{part}</span>
        </Fragment>
      ))}
    </p>
  )
}
