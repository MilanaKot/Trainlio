import { messages, plural } from '@/lib/i18n'
import {
  formatDateGroup,
  formatDateShort,
  formatTime,
  formatTimeRange,
  type Timezone,
} from '@/lib/time/workspace-time'
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

/** The three label colours of §3: cancelled, changed, new. */
const PALETTE = {
  red: { bg: '#FBE9E7', fg: '#B42318' },
  orange: { bg: '#FBF0DC', fg: '#8F5200' },
  blue: { bg: '#E5EBFD', fg: '#2B55E0' },
} as const

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

type Row = {
  label: string
  value: string
  /** The value this one replaced, printed struck through beneath it. */
  previous?: string
  /** Highlighted as the thing that moved. */
  changed?: boolean
  /** The whole value no longer applies — a cancelled training's time. */
  struck?: boolean
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function fill(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (acc, [key, value]) => acc.replaceAll(`{${key}}`, value),
    template,
  )
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

type Template = {
  tone: keyof typeof PALETTE
  label: string
  subject: string
  title: string
  body: string
  rows: Row[]
  button: { label: string; path: string }
  helper?: string
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

/**
 * The plain-text part, with the same content in the same order (§1).
 *
 * Not a fallback nobody reads: it is what a watch notification shows, what a
 * text-only client renders, and what survives a forward into a chat.
 */
function renderText(
  plan: Template,
  context: { url: string; org: string; message?: string | undefined },
): string {
  const lines: string[] = [plan.title, '', plan.body, '']

  for (const row of plan.rows) {
    const value = row.previous
      ? `${row.value} ${fill(t.previousText, { value: row.previous })}`
      : row.value
    lines.push(`${row.label}: ${value}`)
  }

  if (context.message) lines.push('', `${t.coachMessage}: ${context.message}`)

  lines.push('', fill(t.linkText, { label: plan.button.label, url: context.url }))
  if (plan.helper) lines.push('', plan.helper)
  lines.push('', fill(t.footer, { org: context.org }), t.poweredBy)

  return lines.join('\n')
}

const INK = '#0E1726'
const MUTED = '#55607A'
const LINE = '#DFE4EE'
const CANVAS = '#F3F5F9'
const FONT = 'Arial, Helvetica, sans-serif'

function renderHtml(
  plan: Template,
  context: {
    url: string
    org: string
    message?: string | undefined
    logoUrl: string | null
  },
): string {
  const tone = PALETTE[plan.tone]

  // The club's mark, when it has one, with the name beside it as text. Mail
  // clients refuse remote images until the reader asks, so nothing of the
  // message is inside the picture.
  const header =
    context.org === ''
      ? ''
      : `<tr><td style="padding:0 0 18px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
        (context.logoUrl
          ? `<td style="padding:0 12px 0 0"><img src="${escapeHtml(context.logoUrl)}" alt="${escapeHtml(context.org)}" width="40" height="40" style="display:block;width:40px;height:40px;border-radius:8px"></td>`
          : '') +
        `<td style="font:700 16px/22px ${FONT};color:${INK}">${escapeHtml(context.org)}</td>` +
        '</tr></table></td></tr>'

  const rows = plan.rows
    .map((row, index) => {
      const value = row.changed
        ? `<span style="background:${PALETTE.orange.bg};color:${PALETTE.orange.fg};font-weight:700;padding:0 4px;border-radius:4px">${escapeHtml(row.value)}</span>`
        : row.struck
          ? `<span style="text-decoration:line-through;color:${MUTED}">${escapeHtml(row.value)}</span>`
          : escapeHtml(row.value)

      const previous = row.previous
        ? `<br><span style="color:${MUTED};text-decoration:line-through">${escapeHtml(row.previous)}</span>`
        : ''

      const border = index === plan.rows.length - 1 ? '' : `border-bottom:1px solid ${LINE};`

      return (
        `<tr><td style="${border}padding:10px 0;font:400 15px/22px ${FONT};color:${MUTED};width:96px;vertical-align:top">${escapeHtml(row.label)}</td>` +
        `<td style="${border}padding:10px 0;font:400 15px/22px ${FONT};color:${INK};vertical-align:top">${value}${previous}</td></tr>`
      )
    })
    .join('')

  const coachMessage = context.message
    ? `<tr><td style="padding:0 0 18px"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>` +
      `<td style="border-left:3px solid ${LINE};padding:2px 0 2px 14px">` +
      `<div style="font:400 13px/20px ${FONT};color:${MUTED};padding-bottom:4px">${escapeHtml(t.coachMessage)}</div>` +
      `<div style="font:400 15px/23px ${FONT};color:${INK}">${escapeHtml(context.message)}</div>` +
      '</td></tr></table></td></tr>'
    : ''

  // The button is a padded table cell with the link filling it, which is as
  // close to "bulletproof" as HTML gets: it survives Outlook, it is never an
  // image, and it is still a real link when the styles are stripped.
  const button =
    `<tr><td style="padding:0 0 18px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td align="center" bgcolor="#2B55E0" style="border-radius:10px"><a href="${escapeHtml(context.url)}" ` +
    `style="display:inline-block;padding:13px 24px;font:700 16px/22px ${FONT};color:#FFFFFF;text-decoration:none">` +
    `${escapeHtml(plan.button.label)}</a></td></tr></table></td></tr>`

  return [
    '<!doctype html><html lang="cs"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${escapeHtml(plan.title)}</title></head>`,
    `<body style="margin:0;padding:0;background:${CANVAS}">`,
    // The preheader: the first sentence, which is what a mail list shows under
    // the subject. Hidden, and not blank — an empty one shows the markup after.
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(plan.body)}</div>`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${CANVAS}">`,
    '<tr><td align="center" style="padding:24px 12px">',
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="520" style="width:520px;max-width:520px;background:#FFFFFF;border:1px solid ${LINE};border-radius:12px">`,
    '<tr><td style="padding:32px">',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">',
    header,
    `<tr><td style="padding:0 0 14px"><span style="display:inline-block;background:${tone.bg};color:${tone.fg};font:700 12px/16px ${FONT};letter-spacing:.6px;text-transform:uppercase;padding:4px 8px;border-radius:6px">${escapeHtml(plan.label)}</span></td></tr>`,
    `<tr><td style="padding:0 0 12px;font:700 26px/32px ${FONT};color:${INK}">${escapeHtml(plan.title)}</td></tr>`,
    `<tr><td style="padding:0 0 18px;font:400 16px/25px ${FONT};color:${INK}">${escapeHtml(plan.body)}</td></tr>`,
    rows === ''
      ? ''
      : `<tr><td style="padding:0 0 18px"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${CANVAS};border-radius:10px"><tr><td style="padding:6px 16px"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${rows}</table></td></tr></table></td></tr>`,
    coachMessage,
    button,
    plan.helper
      ? `<tr><td style="padding:0 0 18px;font:400 13px/20px ${FONT};color:${MUTED}">${escapeHtml(plan.helper)}</td></tr>`
      : '',
    `<tr><td style="border-top:1px solid ${LINE};padding:16px 0 0;font:400 13px/20px ${FONT};color:${MUTED}">${escapeHtml(fill(t.footer, { org: context.org }))}</td></tr>`,
    '</table></td></tr></table>',
    `<div style="padding:12px 0 0;font:400 12px/18px ${FONT};color:${MUTED}">${escapeHtml(t.poweredBy)}</div>`,
    '</td></tr></table></body></html>',
  ].join('')
}
