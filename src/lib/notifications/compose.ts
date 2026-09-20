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

  if (delivery.athleteNames.length > 0) {
    // Czech agreement changes the adjective and the noun with the count, so
    // this is a plural set rather than a template.
    lines.push(
      plural(delivery.athleteNames.length, t.athletes).replace(
        '{names}',
        delivery.athleteNames.join(', '),
      ),
      '',
    )
  }

  const reason = delivery.session.reason?.trim()
  if (reason) lines.push(fill(t.reason, { reason }), '')

  if (delivery.eventType === 'SESSION_CANCELLED') lines.push(t.preserved, '')

  lines.push(fill(t.link, { url: appUrl }), '', t.signature)

  const text = lines.join('\n')

  const html = [
    '<!doctype html><html lang="cs"><body style="margin:0;padding:24px;background:#f5f5f5;',
    'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;color:#111">',
    '<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:24px">',
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
