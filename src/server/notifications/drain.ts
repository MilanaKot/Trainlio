import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { getServerEnv, publicEnv } from '@/lib/env'
import { logoUrl } from '@/lib/domain/logo'
import { resendProvider } from '@/lib/email/resend'
import {
  composeNotificationEmail,
  type ClaimedDelivery,
  type SignificantChangeRecord,
} from '@/lib/notifications/compose'
import type { EmailProvider } from '@/lib/email/types'
import type { Timezone } from '@/lib/time/workspace-time'

/**
 * The notification drain.
 *
 * Two phases, deliberately separate:
 *
 *   1. expand every undispatched event into one delivery per guardian;
 *   2. claim a batch of deliveries, send them, record each outcome.
 *
 * Splitting them is what makes a crash survivable. Expansion is idempotent
 * (AC-151) and cheap, so re-running it costs nothing; sending is neither, which
 * is why a claim marks the row SENDING inside the claiming transaction and a
 * second concurrent drain skips it.
 *
 * The result of a send is recorded one delivery at a time, not batched at the
 * end. A batch write means a crash halfway through loses the record of
 * everything already sent, and the next run sends those emails again.
 */

export type DrainReport = {
  expandedEvents: number
  createdDeliveries: number
  attempted: number
  sent: number
  failed: number
  /** D-18: addresses cleared from the delivery audit on this run. */
  scrubbed: number
  queue: Record<string, number>
}

type ClaimRow = {
  delivery_id: string
  event_id: string
  event_type: string
  recipient_email: string
  attempt_count: number
  session_payload: Record<string, unknown> | null
  delivery_payload: Record<string, unknown> | null
  workspace_name: string
  workspace_timezone: string
  workspace_logo_path: string | null
}

/** The payload is `jsonb`, so every field is checked rather than asserted. */
function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function count(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

/**
 * The record of what moved (migration 28), as the e-mail reads it.
 *
 * Shaped rather than cast: it comes from a jsonb column, and a template that
 * trusted it would print `undefined` into a parent's inbox.
 */
function changeRecord(value: unknown): SignificantChangeRecord | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as { fields?: unknown; previous?: unknown }
  const fields = strings(record.fields)
  if (fields.length === 0) return null

  const previous = (
    typeof record.previous === 'object' && record.previous !== null ? record.previous : {}
  ) as Record<string, unknown>

  return {
    fields,
    previous: {
      start_at: text(previous.start_at),
      end_at: text(previous.end_at),
      location_name: text(previous.location_name),
      facility_code: text(previous.facility_code),
      facility_name: text(previous.facility_name),
      main_coach_name: text(previous.main_coach_name),
    },
  }
}

function toClaimedDelivery(row: ClaimRow): ClaimedDelivery {
  const session = row.session_payload ?? {}
  const delivery = row.delivery_payload ?? {}

  return {
    deliveryId: row.delivery_id,
    eventType: row.event_type,
    recipientEmail: row.recipient_email,
    session: {
      startAt: text(session.start_at),
      endAt: text(session.end_at),
      facilityCode: text(session.facility_code),
      facilityName: text(session.facility_name),
      locationName: text(session.location_name),
      changingRoom: text(session.changing_room),
      reason: text(session.reason),
      birthYearFrom: count(session.birth_year_from),
      birthYearTo: count(session.birth_year_to),
      previousBirthYearFrom: count(session.previous_birth_year_from),
      previousBirthYearTo: count(session.previous_birth_year_to),
      coachName: text(session.coach_name),
      coachPhone: text(session.coach_phone),
      mainCoachName: text(session.main_coach_name),
      deadlineHours: count(session.deadline_hours),
      change: changeRecord(session.change),
    },
    athleteNames: strings(delivery.athlete_names),
    bookingIds: strings(delivery.booking_ids),
    workspaceTimezone: row.workspace_timezone as Timezone,
    workspaceName: row.workspace_name,
    // Built here rather than read: the drain has no browser storage client,
    // and the URL has to be absolute and public for a mail client to fetch it.
    workspaceLogoUrl: logoUrl(publicEnv.NEXT_PUBLIC_SUPABASE_URL, row.workspace_logo_path),
  }
}

/**
 * `provider` is injectable so the integration suite can drive the whole drain
 * against a recording double without sending real mail. Production passes
 * nothing and gets Resend.
 */
export async function drainNotifications(options?: {
  provider?: EmailProvider
  eventLimit?: number
  deliveryLimit?: number
}): Promise<DrainReport> {
  const env = getServerEnv()
  const supabase = createAdminClient()
  const provider = options?.provider ?? resendProvider(env.RESEND_API_KEY, env.AUTH_SENDER_EMAIL)
  // The site root: each template chooses its own screen (EMAILS.md §2).
  const appUrl = publicEnv.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '')

  let expandedEvents = 0
  let createdDeliveries = 0

  const { data: eventIds } = await supabase.rpc('pending_notification_events', {
    p_limit: options?.eventLimit ?? 50,
  })

  for (const eventId of eventIds ?? []) {
    const { data } = await supabase.rpc('expand_notification_event', { p_event_id: eventId })
    const result = data as { ok?: boolean; data?: { created?: number } } | null
    if (result?.ok) {
      expandedEvents += 1
      createdDeliveries += result.data?.created ?? 0
    }
  }

  const { data: claimed } = await supabase.rpc('claim_notification_deliveries', {
    p_limit: options?.deliveryLimit ?? 20,
  })

  let sent = 0
  let failed = 0

  for (const row of (claimed ?? []) as unknown as ClaimRow[]) {
    const delivery = toClaimedDelivery(row)
    const message = composeNotificationEmail(delivery, appUrl)

    if (message === null) {
      // An event type the composer does not know. Recorded as a failure with
      // the reason rather than silently dropped, so it shows up in the queue
      // depth instead of a parent never hearing about a cancelled training.
      await supabase.rpc('record_notification_delivery', {
        p_delivery_id: row.delivery_id,
        p_ok: false,
        p_error: `unknown event type: ${row.event_type}`,
      })
      failed += 1
      continue
    }

    const result = await provider.send(message)

    await supabase.rpc('record_notification_delivery', {
      p_delivery_id: row.delivery_id,
      p_ok: result.ok,
      ...(result.ok && result.providerMessageId
        ? { p_provider_message_id: result.providerMessageId }
        : {}),
      ...(result.ok
        ? {}
        : { p_error: `${result.retryable ? 'retryable' : 'permanent'}: ${result.error}` }),
    })

    if (result.ok) sent += 1
    else failed += 1
  }

  // D-18 address decay, on the same schedule and deliberately last: a delivery
  // claimed earlier in this run still holds the address it is being sent to,
  // and the scrub skips unsettled rows for exactly that reason.
  //
  // Here rather than on a cron of its own because it is cheap, idempotent, and
  // a retention job that runs on its own schedule is a retention job that
  // quietly stops running.
  const { data: scrub } = await supabase.rpc('scrub_notification_emails')
  const scrubbed = (scrub as { data?: { scrubbed?: number } } | null)?.data?.scrubbed ?? 0

  const { data: depth } = await supabase.rpc('notification_queue_depth')

  return {
    expandedEvents,
    createdDeliveries,
    attempted: (claimed ?? []).length,
    sent,
    failed,
    scrubbed,
    queue: (depth as Record<string, number>) ?? {},
  }
}
