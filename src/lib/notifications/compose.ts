import { messages, plural } from '@/lib/i18n'
import {
  formatDateGroup,
  formatDateShort,
  formatTime,
  formatTimeRange,
  type Timezone,
} from '@/lib/time/workspace-time'
import {
  fill,
  renderHtml,
  renderText,
  type PALETTE,
  type Row,
  type Template,
} from '@/lib/notifications/layout'
import type { EmailMessage } from '@/lib/email/types'

/**
 * The message a guardian receives (shared/EMAILS.md, E01–E08).
 *
 * Pure: a claimed delivery in, an e-mail out. No database, no clock, no
 * provider — which is what makes AC-072 and AC-073 assertions on a string, and
 * what lets every template be a snapshot test.
 *
 * Three rules from §1 shape the whole thing, and all three are about a message
 * read on a phone in a mail client nobody chose:
 *
 *   * **Tables and inline styles.** Gmail strips `<style>`, Outlook renders
 *     with Word. Flexbox, custom properties and classes — which the design
 *     reference uses, because it is drawn for a browser — collapse to nothing
 *     there, so the layout is tables and every rule is inline.
 *   * **It reads with images blocked**, which is the default in most clients.
 *     Nothing is carried by a picture: the club's mark has its name beside it as
 *     text, and no state is signalled by colour alone — a changed value also
 *     prints what it used to be, struck through.
 *   * **Arial, never a web font.** The design does not depend on Barlow here.
 */

export const NOTIFICATION_EVENT_TYPES = [
  'SESSION_CANCELLED',
  'SESSION_SCHEDULE_CHANGED',
  'SESSION_LOCATION_CHANGED',
  'SESSION_FACILITY_CHANGED',
  'SESSION_MAIN_COACH_CHANGED',
  'SESSION_ELIGIBILITY_NARROWED',
  'BOOKING_REMOVED_BY_COACH',
  'BOOKING_ADDED_BY_COACH',
  'SESSION_CHANGED',
] as const

export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number]

export function isNotificationEventType(value: string): value is NotificationEventType {
  return (NOTIFICATION_EVENT_TYPES as readonly string[]).includes(value)
}

/** What migration 28 recorded about the save, as a parent reads it. */
export type SignificantChangeRecord = {
  fields: string[]
  previous: {
    start_at?: string | null
    end_at?: string | null
    location_name?: string | null
    facility_code?: string | null
    facility_name?: string | null
    main_coach_name?: string | null
  }
}

export type ClaimedDelivery = {
  deliveryId: string
  eventType: string
  recipientEmail: string
  /** Event payload, with names, the coach and the deadline already resolved. */
  session: {
    startAt?: string | null
    endAt?: string | null
    facilityCode?: string | null
    facilityName?: string | null
    locationName?: string | null
    changingRoom?: string | null
    reason?: string | null
    birthYearFrom?: number | null
    birthYearTo?: number | null
    previousBirthYearFrom?: number | null
    previousBirthYearTo?: number | null
    /** The coach who acted: removed, added, or saved the change. */
    coachName?: string | null
    /** Theirs, from `staff_contacts` — E07 only (decision 28, migration 33). */
    coachPhone?: string | null
    mainCoachName?: string | null
    deadlineHours?: number | null
    change?: SignificantChangeRecord | null
  }
  /** This guardian's own affected athletes, in display order. */
  athleteNames: string[]
  /** Their bookings on this session, so the button can open the right screen. */
  bookingIds?: string[]
  workspaceTimezone: Timezone
  workspaceName?: string | null
  /** Public URL of the club's mark, or null when it has none. */
  workspaceLogoUrl?: string | null
}

const t = messages.email

const TONE: Record<NotificationEventType, keyof typeof PALETTE> = {
  SESSION_CANCELLED: 'red',
  SESSION_SCHEDULE_CHANGED: 'orange',
  SESSION_LOCATION_CHANGED: 'orange',
  SESSION_FACILITY_CHANGED: 'orange',
  SESSION_MAIN_COACH_CHANGED: 'orange',
  SESSION_ELIGIBILITY_NARROWED: 'orange',
  BOOKING_REMOVED_BY_COACH: 'orange',
  BOOKING_ADDED_BY_COACH: 'blue',
  SESSION_CHANGED: 'orange',
}

/** `st 7. 10.` — the form the subject lines use, lowercase inside a sentence. */
function shortDay(at: Date, timezone: Timezone): string {
  const formatted = formatDateShort(at, timezone)
  return formatted.charAt(0).toLocaleLowerCase('cs-CZ') + formatted.slice(1)
}

/** `Středa 7. října · 17:00–18:00` — the `Kdy` row (DS §7). */
function whenValue(start: Date, end: Date, timezone: Timezone): string {
  return `${formatDateGroup(start, timezone)} · ${formatTimeRange(start, end, timezone)}`
}

/** `Příbram · Malá hala (MH) · Šatna 4` (BR-063). */
function whereValue(session: ClaimedDelivery['session']): string {
  return [session.locationName, facilityValue(session), session.changingRoom]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' · ')
}

/** `Malá hala (MH)`, or whichever half of it the payload has. */
function facilityValue(session: {
  facilityName?: string | null | undefined
  facilityCode?: string | null | undefined
}): string {
  if (session.facilityName && session.facilityCode) {
    return `${session.facilityName} (${session.facilityCode})`
  }
  return session.facilityName ?? session.facilityCode ?? ''
}

function yearsValue(from?: number | null, to?: number | null): string {
  if (from === null || from === undefined || to === null || to === undefined) return t.allYears
  return fill(t.yearRange, { from: String(from), to: String(to) })
}

/**
 * Which of the eight an event is, and what it says.
 *
 * `SESSION_SCHEDULE_CHANGED` splits in two here rather than in the outbox: the
 * event is one thing to the database — the clock moved — and two things to a
 * parent, because a training an hour later and a training the next day are not
 * the same news (§E02).
 */
function variantOf(delivery: ClaimedDelivery): string {
  const fields = delivery.session.change?.fields ?? []
  if (delivery.eventType === 'SESSION_SCHEDULE_CHANGED' && fields.includes('DATE')) {
    return 'SESSION_SCHEDULE_CHANGED_DATE'
  }
  return delivery.eventType
}

function template(delivery: ClaimedDelivery, event: NotificationEventType): Template {
  const { session, workspaceTimezone: zone } = delivery
  const variant = variantOf(delivery)
  const table = (set: Record<string, string>) => set[variant] ?? set[event] ?? ''

  const start = session.startAt ? new Date(session.startAt) : null
  const end = session.endAt ? new Date(session.endAt) : start
  const previous = session.change?.previous ?? {}
  const fields = session.change?.fields ?? []

  const previousStart = previous.start_at ? new Date(previous.start_at) : null
  const previousEnd = previous.end_at ? new Date(previous.end_at) : previousStart

  const day = start ? shortDay(start, zone) : ''
  const time = start ? formatTime(start, zone) : ''
  const previousDay = previousStart ? shortDay(previousStart, zone) : day

  const athletes = plural(delivery.athleteNames.length, t.rows.athletes)
  const names = delivery.athleteNames.join(', ')

  const rows: Row[] = []
  if (names !== '') rows.push({ label: athletes, value: names })

  const timeChanged = fields.includes('TIME') || fields.includes('DATE')
  if (start && end) {
    rows.push({
      label: t.rows.when,
      value: whenValue(start, end, zone),
      struck: event === 'SESSION_CANCELLED',
      changed: timeChanged,
      // Only what moved: a training an hour earlier on the same day reads
      // `(dříve 17:00–18:00)`, because repeating the date invites the parent to
      // compare two identical halves looking for the difference (§1).
      ...(timeChanged && previousStart && previousEnd
        ? {
            previous: fields.includes('DATE')
              ? whenValue(previousStart, previousEnd, zone)
              : formatTimeRange(previousStart, previousEnd, zone),
          }
        : {}),
    })
  }

  // One row or two. `Kde` carries the whole venue, which is what a parent needs
  // in every message; a hall change gets its own row so the thing that moved is
  // the thing that is highlighted.
  const facilityOnly = event === 'SESSION_FACILITY_CHANGED'
  if (facilityOnly) {
    rows.push({
      label: t.rows.facility,
      value: [facilityValue(session), session.changingRoom].filter(Boolean).join(' · '),
      changed: true,
      ...(previous.facility_name || previous.facility_code
        ? {
            previous: facilityValue({
              facilityName: previous.facility_name,
              facilityCode: previous.facility_code,
            }),
          }
        : {}),
    })
  } else if (event !== 'SESSION_ELIGIBILITY_NARROWED') {
    const placeChanged = fields.includes('LOCATION') || fields.includes('FACILITY')
    rows.push({
      label: t.rows.where,
      value: whereValue(session),
      changed: placeChanged,
      ...(placeChanged
        ? {
            previous: [
              previous.location_name ?? session.locationName,
              facilityValue({
                facilityName: previous.facility_name ?? session.facilityName,
                facilityCode: previous.facility_code ?? session.facilityCode,
              }),
            ]
              .filter(Boolean)
              .join(' · '),
          }
        : {}),
    })
  }

  if (fields.includes('MAIN_COACH') || event === 'SESSION_MAIN_COACH_CHANGED') {
    rows.push({
      label: t.rows.mainCoach,
      value: session.mainCoachName ?? '',
      changed: true,
      ...(previous.main_coach_name ? { previous: previous.main_coach_name } : {}),
    })
  }

  if (event === 'SESSION_ELIGIBILITY_NARROWED') {
    rows.push({
      label: t.rows.years,
      value: yearsValue(session.birthYearFrom, session.birthYearTo),
      changed: true,
      previous: yearsValue(session.previousBirthYearFrom, session.previousBirthYearTo),
    })
  }

  // E07: who to ring, since D-06 makes that the only thing left to do.
  if (event === 'BOOKING_REMOVED_BY_COACH' && session.coachName) {
    rows.push({
      label: t.rows.coach,
      value: [session.coachName, session.coachPhone].filter(Boolean).join(' · '),
    })
  }

  // The deadline, where there is still something to undo (§E02, §E08).
  const deadlineEvents = ['SESSION_SCHEDULE_CHANGED', 'SESSION_CHANGED', 'BOOKING_ADDED_BY_COACH']
  if (start && deadlineEvents.includes(event) && typeof session.deadlineHours === 'number') {
    const at = new Date(start.getTime() - session.deadlineHours * 60 * 60 * 1000)
    rows.push({
      label: t.rows.deadline,
      value: fill(t.deadlineValue, {
        day: shortDay(at, zone),
        time: formatTime(at, zone),
      }),
    })
  }

  const facilityGenitive =
    (session.facilityName && t.facilityGenitive[session.facilityName]) ?? t.facilityGenitiveFallback

  const button =
    event === 'SESSION_CANCELLED'
      ? { label: t.buttons.sessions, path: '/treninky' }
      : event === 'SESSION_ELIGIBILITY_NARROWED'
        ? { label: t.buttons.findAnother, path: '/treninky' }
        : {
            label: t.buttons.booking,
            // One child, one booking, one screen (§G6). Two children share the
            // list, which is the screen that holds both.
            path:
              delivery.bookingIds?.length === 1
                ? `/moje-treninky/${delivery.bookingIds[0]}`
                : '/moje-treninky',
          }

  const helper = t.helpers[event]

  return {
    tone: TONE[event],
    label: table(t.labels),
    subject: fill(table(t.subjects), {
      day,
      time,
      previousDay,
      facility: session.facilityName ?? '',
    }),
    title: fill(table(t.titles), { facility: facilityGenitive }),
    body: fill(table(t.bodies), { coach: session.coachName ?? '' }),
    rows,
    button,
    ...(helper ? { helper } : {}),
  }
}

export function composeNotificationEmail(
  delivery: ClaimedDelivery,
  appUrl: string,
): EmailMessage | null {
  // An unknown event type is not guessed at. The database check constraint
  // already restricts the column, so reaching this means a migration added a
  // type the drain does not know how to describe — and inventing a message for
  // it would send a parent something Trainlio cannot explain.
  if (!isNotificationEventType(delivery.eventType)) return null

  const base = appUrl.replace(/\/$/, '')
  const plan = template(delivery, delivery.eventType)
  const url = `${base}${plan.button.path}`
  const org = delivery.workspaceName ?? ''
  const message = delivery.session.reason?.trim()

  return {
    to: delivery.recipientEmail,
    subject: plan.subject,
    text: renderText(plan, { url, org, message }),
    html: renderHtml(plan, {
      url,
      org,
      message,
      logoUrl: delivery.workspaceLogoUrl ?? null,
    }),
  }
}
