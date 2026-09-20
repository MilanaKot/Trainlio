import { NextResponse } from 'next/server'
import { getServerEnv } from '@/lib/env'
import { drainNotifications } from '@/server/notifications/drain'

/**
 * The notification drain, on a Vercel Cron schedule (vercel.json).
 *
 * Authenticated by a shared secret, not by the route being obscure. The
 * approved review is explicit that possession of a URL is not authorization,
 * and this one reads guardian email addresses with the service role — the most
 * privileged thing in the application.
 *
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`; the same header works
 * for a manual run during an incident, which is the only other intended caller.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function authorized(request: Request, secret: string): boolean {
  const header = request.headers.get('authorization') ?? ''
  const expected = `Bearer ${secret}`

  // Constant-time-ish: compare every byte regardless of where the first
  // difference is, so response timing does not narrow down the secret.
  if (header.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < header.length; i += 1) {
    diff |= header.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return diff === 0
}

export async function GET(request: Request) {
  const { CRON_SECRET } = getServerEnv()

  if (!authorized(request, CRON_SECRET)) {
    // No detail. An unauthenticated caller learns nothing about the queue,
    // including whether this route exists for the reason they suspect.
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const report = await drainNotifications()
    return NextResponse.json(report)
  } catch (cause) {
    // The cron platform retries on a 5xx, which is what we want: the drain is
    // safe to re-run, and everything already sent has been recorded.
    console.error('notification drain failed', cause)
    return NextResponse.json({ error: 'drain failed' }, { status: 500 })
  }
}
