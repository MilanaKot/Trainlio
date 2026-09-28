import { messages, plural } from '@/lib/i18n'
import { formatDate, formatTimeRange, type Timezone } from '@/lib/time/workspace-time'
import type { EmailMessage } from '@/lib/email/types'

/**
 * Composing the message a guardian receives.
 *
 * Pure: takes a claimed delivery and returns the email. No database, no clock,
 * no provider. That is what makes AC-072 and AC-073 testable without a running
 * stack — one guardian with two booked children produces one message naming
 * both, and the assertion is on the string.
 */

export const NOTIFICATION_EVENT_TYPES = [
  'SESSION_CANCELLED',
  'SESSION_SCHEDULE_CHANGED',
  'SESSION_LOCATION_CHANGED',
  'SESSION_FACILITY_CHANGED',
  'SESSION_MAIN_COACH_CHANGED',
  'SESSION_ELIGIBILITY_NARROWED',
  'BOOKING_REMOVED_BY_COACH',
] as const

export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number]

export function isNotificationEventType(value: string): value is NotificationEventType {
  return (NOTIFICATION_EVENT_TYPES as readonly string[]).includes(value)
}

export type ClaimedDelivery = {
  deliveryId: string
  eventType: string
  recipientEmail: string
  /** Event payload, with the facility and location names already resolved. */
  session: {
    startAt?: string | null
    endAt?: string | null
    facilityCode?: string | null
    locationName?: string | null
    changingRoom?: string | null
    reason?: string | null
  }
  /** This guardian's own affected athletes, in display order. */
  athleteNames: string[]
  workspaceTimezone: Timezone
  workspaceName?: string | null
  /** Public URL of the club's mark, or null when it has none. */
  workspaceLogoUrl?: string | null
}

const t = messages.email

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/**
 * `4. 10. 2026, 09:00–10:00`, in the workspace's zone.
 *
 * The workspace timezone, never the server's and never the recipient's device:
 * a parent in another country must read the time the training actually starts
 * at the rink.
 */
function when(session: ClaimedDelivery['session'], timezone: Timezone): string {
  if (!session.startAt) return ''
  const start = new Date(session.startAt)
  const end = session.endAt ? new Date(session.endAt) : start
  return `${formatDate(start, timezone)}, ${formatTimeRange(start, end, timezone)}`
}

/** `Příbram · MH · Šatna 4` (BR-063). */
function where(session: ClaimedDelivery['session']): string {
  return [session.locationName, session.facilityCode, session.changingRoom]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' · ')
}

function fill(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (acc, [key, value]) => acc.replaceAll(`{${key}}`, value),
    template,
  )
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

  const whenText = when(delivery.session, delivery.workspaceTimezone)
  const whereText = where(delivery.session)

  const subject = fill(t.subjects[delivery.eventType], { when: whenText })
  const body = fill(t.bodies[delivery.eventType], { when: whenText, where: whereText })

  const lines: string[] = [t.greeting, '', body, '']

  const removal = delivery.eventType === 'BOOKING_REMOVED_BY_COACH'

  if (delivery.athleteNames.length > 0) {
    // Czech agreement changes the adjective and the noun with the count, so
    // this is a plural set rather than a template. A removal needs its own
    // set: "Přihlášený sportovec" would name the child as booked in the very
    // message saying they are not.
    lines.push(
      plural(delivery.athleteNames.length, removal ? t.removedAthletes : t.athletes).replace(
        '{names}',
        delivery.athleteNames.join(', '),
      ),
      '',
    )
  }

  const reason = delivery.session.reason?.trim()
  // The same field carries two different things. On a cancelled session it is
  // why the training is off; on a removal the specification calls it a message
  // to this parent, so it is introduced as one.
  if (reason) lines.push(fill(removal ? t.coachMessage : t.reason, { reason }), '')

  if (delivery.eventType === 'SESSION_CANCELLED') lines.push(t.preserved, '')
  // D-06: the parent cannot undo a coach's removal, so the message says what
  // they can do instead of leaving them to find the disabled button.
  if (removal) lines.push(t.contactCoach, '')

  lines.push(fill(t.link, { url: appUrl }), '', t.signature)

  const text = lines.join('\n')

  // The club's mark, when it has one. Most mail clients refuse to load remote
  // images until the reader asks, so it is an <img> with the club's name as
  // its alt text and nothing of the message inside the picture: a parent who
  // never loads it reads exactly the same thing.
  const header = delivery.workspaceName
    ? delivery.workspaceLogoUrl
      ? `<p style="margin:0 0 16px"><img src="${escapeHtml(delivery.workspaceLogoUrl)}" ` +
        `alt="${escapeHtml(delivery.workspaceName)}" width="40" height="40" ` +
        'style="width:40px;height:40px;object-fit:contain;border-radius:8px"></p>'
      : // No mark: the club's name, written out. Not a monogram — two cobalt
        // letters mean something in an interface that explains them and
        // nothing at the top of an e-mail (admin/SPEC.md, open questions).
        `<p style="margin:0 0 16px;font-size:15px;font-weight:700">${escapeHtml(delivery.workspaceName)}</p>`
    : ''

  const html = [
    '<!doctype html><html lang="cs"><body style="margin:0;padding:24px;background:#f5f5f5;',
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111\">",
    '<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:24px">',
    header,
    lines
      .filter((line) => line !== '')
      .map((line) =>
        line === t.signature
          ? `<p style="margin:24px 0 0;font-size:13px;color:#666">${escapeHtml(line)}</p>`
          : `<p style="margin:0 0 12px;font-size:15px;line-height:1.6">${escapeHtml(line)}</p>`,
      )
      .join(''),
    '</div></body></html>',
  ].join('')

  return { to: delivery.recipientEmail, subject, text, html }
}
