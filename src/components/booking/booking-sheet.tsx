'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { messages, plural } from '@/lib/i18n'
import { remainingPlaces } from '@/lib/domain/capacity'
import {
  birthYear,
  formatDateGroup,
  formatDeadline,
  formatTimeRange,
} from '@/lib/time/workspace-time'
import { bookAthletes } from '@/server/bookings/actions'
import { Avatar } from '@/components/ui/avatar'
import { BottomSheet } from '@/components/ui/bottom-sheet'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'
import { PickerRow } from '@/components/ui/picker-row'
import { useToast } from '@/components/ui/toast'
import type { GuardianSession, PickerAthlete } from '@/server/bookings/queries'

const t = messages.booking

/**
 * Choosing who to book (guardian/SPEC.md §G2, §G3).
 *
 * Selecting several children is one all-or-nothing action (D-05): the server
 * books every selected athlete or none, so one confirmation never splits
 * siblings into booked and not-booked.
 *
 * Every athlete of the family is listed, including the ones who cannot be
 * booked, each with its reason. Hiding them would leave a parent looking for a
 * child the app appears to have lost.
 *
 * Nothing here decides anything: `canBook` is the server's own verdict and the
 * booking function re-checks all of it. Too few places is a state of this
 * sheet, not an error — hence warning rather than red (§G3).
 */
export function BookingSheet({
  open,
  onOpenChange,
  session,
  booked,
  athletes,
  timezone,
  deadlineHours,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  session: GuardianSession
  /** Live count, so the sheet and the card behind it agree. */
  booked: number
  athletes: PickerAthlete[]
  timezone: string
  deadlineHours: number
}) {
  const router = useRouter()
  const toast = useToast()
  const [pending, startTransition] = useTransition()
  const [notice, setNotice] = useState<{ title?: string; text: string } | null>(null)

  const bookable = useMemo(() => athletes.filter((a) => a.canBook), [athletes])

  // One eligible child is the common case, and the brief allows the simplified
  // flow: preselected, so booking is one tap inside the sheet.
  const [selected, setSelected] = useState<string[]>(() =>
    bookable.length === 1 && bookable[0] ? [bookable[0].athleteId] : [],
  )

  const formId = `book-${session.id}`
  const remaining = remainingPlaces(booked, session.capacity)
  const tooMany = selected.length > remaining

  const start = new Date(session.startAt)
  const deadlineAt = new Date(start.getTime() - deadlineHours * 60 * 60 * 1000)
  const venue = [session.locationName, session.facilityCode, session.changingRoom]
    .filter(Boolean)
    .join(' · ')

  // Eligible first, then the rest, each keeping the server's order.
  const ordered = [...bookable, ...athletes.filter((a) => !a.canBook)]

  function toggle(athleteId: string) {
    setNotice(null)
    setSelected((current) =>
      current.includes(athleteId)
        ? current.filter((id) => id !== athleteId)
        : [...current, athleteId],
    )
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setNotice(null)

    startTransition(async () => {
      const result = await bookAthletes(session.id, selected)

      if (result.ok) {
        onOpenChange(false)
        setSelected([])
        toast(t.booked)
        router.refresh()
        return
      }

      if (result.code === 'INSUFFICIENT_CAPACITY') {
        const places = result.availablePlaces ?? 0
        setNotice({
          title: t.notEnoughTitle,
          // Czech agreement changes the verb, the adjective and the noun with
          // the count, which is why this is a plural set and not a template.
          text: places === 0 ? messages.session.full : plural(places, t.insufficientCapacity),
        })
        return
      }

      const table = t.errors as Record<string, string>
      setNotice({ text: table[result.code] ?? t.errors.generic })
    })
  }

  function metaFor(athlete: PickerAthlete): string {
    const year = String(birthYear(athlete.dateOfBirth))
    if (athlete.bookingStatus === 'CONFIRMED') return `${year} · ${t.alreadyBookedMeta}`
    if (athlete.removedByCoach) return `${year} · ${t.removedByCoachShort}`
    if (
      athlete.eligibility === 'BIRTH_YEAR_OUT_OF_RANGE' &&
      session.birthYearFrom !== null &&
      session.birthYearTo !== null
    ) {
      return `${year} · ${t.outsideYears
        .replace('{from}', String(session.birthYearFrom))
        .replace('{to}', String(session.birthYearTo))}`
    }
    if (!athlete.canBook) return `${year} · ${t.notEligibleShort}`
    return year
  }

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t.pickAthletes}
      // Not `tall`: most families have one or two children, and a sheet pinned
      // to the top of the screen puts an empty half-screen between the last
      // name and the button. The default caps at 85dvh and scrolls past that.
      footer={
        <Button
          type="submit"
          form={formId}
          size="lg"
          // Never disabled on the free-place count alone: it can be stale, and
          // the server is what decides. An empty selection is the one thing
          // this side can be sure of.
          disabled={selected.length === 0 || tooMany}
          {...(pending ? { loadingLabel: t.booking } : {})}
        >
          {selected.length > 1 ? plural(selected.length, t.submit) : t.confirm}
        </Button>
      }
    >
      <form id={formId} onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4 rounded-control-lg bg-bg p-3.5">
          <div className="flex flex-col gap-1">
            <p className="text-row font-bold text-ink">
              {formatDateGroup(start, timezone)} ·{' '}
              {formatTimeRange(start, new Date(session.endAt), timezone)}
            </p>
            <p className="text-meta text-muted">{venue}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-0.5">
            <span className="nums text-count font-semibold text-ink">
              {booked} / {session.capacity}
            </span>
            <span
              className={tooMany ? 'text-hint font-semibold text-warning' : 'text-hint text-muted'}
            >
              {plural(remaining, t.freePlaces)}
            </span>
          </div>
        </div>

        {notice ? (
          <Notice variant="warning" role="alert" {...(notice.title ? { title: notice.title } : {})}>
            {notice.text}
          </Notice>
        ) : null}

        {/* The client says the same thing the server would, before the round
            trip. The server still decides: places can go while the sheet is open. */}
        {tooMany && !notice ? (
          <Notice variant="warning" role="alert" title={t.notEnoughTitle}>
            {plural(remaining, t.insufficientCapacity)}
          </Notice>
        ) : null}

        <ul className="flex flex-col gap-2">
          {ordered.map((athlete) => (
            <li key={athlete.athleteId}>
              <PickerRow
                checked={selected.includes(athlete.athleteId)}
                disabled={!athlete.canBook}
                onChange={() => toggle(athlete.athleteId)}
                // §G2 puts a face beside the name: a parent choosing between
                // two children under pressure reads the picture first.
                leading={
                  <Avatar
                    firstName={athlete.firstName}
                    lastName={athlete.lastName}
                    size={36}
                    muted={!athlete.canBook}
                  />
                }
                title={`${athlete.firstName} ${athlete.lastName}`}
                meta={metaFor(athlete)}
              />
            </li>
          ))}
        </ul>

        <p className="flex items-center gap-1.5 text-meta text-muted">
          <ClockIcon />
          {t.cancelUntil.replace('{deadline}', formatDeadline(deadlineAt, timezone))}
        </p>
      </form>
    </BottomSheet>
  )
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="size-4 shrink-0" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4.75V8l2.25 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
