import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { getServerEnv, publicEnv } from '@/lib/env'
import { resendProvider } from '@/lib/email/resend'
import { composeNotificationEmail, type ClaimedDelivery } from '@/lib/notifications/compose'
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
}

function toClaimedDelivery(row: ClaimRow): ClaimedDelivery {
  const session = row.session_payload ?? {}
  const names = (row.delivery_payload ?? {}).athlete_names

  return {
    deliveryId: row.delivery_id,
    eventType: row.event_type,
    recipientEmail: row.recipient_email,
    session: {
      startAt: typeof session.start_at === 'string' ? session.start_at : null,
      endAt: typeof session.end_at === 'string' ? session.end_at : null,
      facilityCode: typeof session.facility_code === 'string' ? session.facility_code : null,
      locationName: typeof session.location_name === 'string' ? session.location_name : null,
      changingRoom: typeof session.changing_room === 'string' ? session.changing_room : null,
      reason: typeof session.reason === 'string' ? session.reason : null,
    },
    athleteNames: Array.isArray(names)
      ? names.filter((n): n is string => typeof n === 'string')
      : [],
    workspaceTimezone: row.workspace_timezone as Timezone,
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
  const appUrl = `${publicEnv.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '')}/moje-treninky`

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
