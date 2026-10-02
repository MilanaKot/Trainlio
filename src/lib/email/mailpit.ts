import 'server-only'

import type { EmailMessage, EmailProvider, SendResult } from '@/lib/email/types'

/**
 * Mailpit, for local development and the browser suite.
 *
 * Supabase already delivers its one-time codes here, so a developer reading
 * `http://127.0.0.1:54324` sees the sign-in code. Everything the application
 * sends itself — the guardian notifications and the coach's invitation — went
 * to Resend, which no local stack can reach and no test can read, so those
 * messages were invisible exactly where someone is working on them.
 *
 * Never reachable in production: the transport is chosen by an environment
 * variable that production does not set, and Mailpit's address is a loopback
 * one.
 */
export function mailpitProvider(url: string, from: string): EmailProvider {
  return {
    name: 'mailpit',

    async send(message: EmailMessage): Promise<SendResult> {
      try {
        const response = await fetch(`${url.replace(/\/$/, '')}/api/v1/send`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            From: { Email: from },
            To: [{ Email: message.to }],
            Subject: message.subject,
            Text: message.text,
            HTML: message.html,
          }),
        })

        if (!response.ok) {
          return { ok: false, error: `mailpit: ${response.status}`, retryable: true }
        }

        return { ok: true, providerMessageId: null }
      } catch (cause) {
        return { ok: false, error: `mailpit: ${String(cause)}`, retryable: true }
      }
    },
  }
}
