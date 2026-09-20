import 'server-only'

import type { EmailMessage, EmailProvider, SendResult } from '@/lib/email/types'

/**
 * Resend, over its REST API rather than its SDK.
 *
 * The SDK would add a dependency for one POST, and the drain needs explicit
 * control over what counts as retryable — which the SDK expresses as thrown
 * errors that have to be re-classified anyway.
 */
export function resendProvider(apiKey: string, from: string): EmailProvider {
  return {
    name: 'resend',

    async send(message: EmailMessage): Promise<SendResult> {
      let response: Response
      try {
        response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            html: message.html,
          }),
        })
      } catch (cause) {
        // Never reached the provider, so nothing was sent: always retryable.
        return { ok: false, error: `network: ${String(cause)}`, retryable: true }
      }

      if (response.ok) {
        const body = (await response.json().catch(() => ({}))) as { id?: string }
        return { ok: true, providerMessageId: body.id ?? null }
      }

      const detail = await response.text().catch(() => '')

      // 4xx is our request being wrong — a malformed address, an unverified
      // sender, a revoked key. Retrying sends the same broken request again.
      // 429 is the exception: it is a 4xx that says "later".
      const retryable = response.status >= 500 || response.status === 429

      return {
        ok: false,
        error: `${response.status} ${detail.slice(0, 500)}`,
        retryable,
      }
    },
  }
}
