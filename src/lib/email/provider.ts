import 'server-only'

import { getServerEnv } from '@/lib/env'
import { mailpitProvider } from '@/lib/email/mailpit'
import { resendProvider } from '@/lib/email/resend'
import type { EmailProvider } from '@/lib/email/types'

/**
 * The transport everything the application sends goes through.
 *
 * Resend, unless `EMAIL_TRANSPORT=mailpit` says otherwise — which only a local
 * `.env.local` does. One place to choose, so the drain and the invitation can
 * never disagree about where a message went.
 */
export function emailProvider(): EmailProvider {
  const env = getServerEnv()

  return env.EMAIL_TRANSPORT === 'mailpit'
    ? mailpitProvider(env.MAILPIT_URL, env.AUTH_SENDER_EMAIL)
    : resendProvider(env.RESEND_API_KEY, env.AUTH_SENDER_EMAIL)
}
